import { execFile } from "child_process";
import { existsSync } from "fs";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  checkInstallStatus,
  getEnhancedPath,
  runHermesCurator,
  discoverMemoryProviders,
  listMcpServers,
} from "./installer";
import { getHermesCapabilities } from "./hermes";
import {
  getConnectionConfig,
  getCredentialPool,
  getModelConfig,
  readEnv,
} from "./config";
import { listProfiles, type ProfileInfo } from "./profiles";
import { readMemory } from "./memory";
import { getToolsets } from "./tools";
import { listCronJobs, type CronJob } from "./cronjobs";
import { listKanbanBoard } from "./kanban";
import { getTailscaleMobileStatus } from "./tailscale";
import { getCodexRuntimeStatus, runCodexRuntimeAction } from "./codex-runtime";
import { stripAnsi } from "./utils";
import {
  buildSettingsAuditBuckets,
  redactSettingsAuditText,
  summarizeSettingsAuditBuckets,
  type SettingsAuditBuckets,
  type SettingsAuditCard,
} from "./settings-audit-utils";
import { buildSettingsAuditCards } from "./settings-audit-cards";

interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface SettingsAuditActionResult extends CommandResult {
  action: string;
  createdAt: number;
}

export interface SettingsAudit {
  profile: string;
  createdAt: number;
  summary: ReturnType<typeof summarizeSettingsAuditBuckets>;
  buckets: SettingsAuditBuckets;
  cards: SettingsAuditCard[];
  raw: {
    install: ReturnType<typeof checkInstallStatus>;
    connection: ReturnType<typeof getConnectionConfig>;
    model: ReturnType<typeof getModelConfig>;
    env: Record<string, boolean>;
    credentialProviders: Array<{ provider: string; count: number }>;
    capabilities: Awaited<ReturnType<typeof getHermesCapabilities>>;
    updateCheck: CommandResult;
    doctor: CommandResult;
    status: CommandResult;
    profileShow: CommandResult;
    memoryStatus: CommandResult;
    cronStatus: CommandResult;
    toolsSummary: CommandResult;
    curator: Awaited<ReturnType<typeof runHermesCurator>>;
    profiles: ProfileInfo[];
    memoryProviders: ReturnType<typeof discoverMemoryProviders>;
    memoryStats: Awaited<ReturnType<typeof readMemory>>["stats"] | null;
    toolsets: ReturnType<typeof getToolsets>;
    mcpServers: ReturnType<typeof listMcpServers>;
    cronJobs: CronJob[];
    tailscale: Awaited<ReturnType<typeof getTailscaleMobileStatus>>;
    kanban: Awaited<ReturnType<typeof listKanbanBoard>>;
    kanbanDiagnostics: CommandResult;
    codexRuntime: Awaited<ReturnType<typeof getCodexRuntimeStatus>>;
  };
}

function hermesArgs(args: string[], profile?: string): string[] {
  const cliArgs = [HERMES_SCRIPT];
  if (profile && profile !== "default") cliArgs.push("-p", profile);
  cliArgs.push(...args);
  return cliArgs;
}

function runHermesCommand(
  args: string[],
  profile?: string,
  timeout = 45000,
): Promise<CommandResult> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve({
      success: false,
      output: "",
      error: "Hermes is not installed.",
    });
  }

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      hermesArgs(args, profile),
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const output = redactSettingsAuditText(stripAnsi(stdout || ""));
        const cleanError = redactSettingsAuditText(stripAnsi(stderr || ""));
        resolve({
          success: !error,
          output: output || cleanError,
          error: error ? cleanError || error.message : undefined,
        });
      },
    );
  });
}

function envFlags(env: Record<string, string>): Record<string, boolean> {
  return {
    hasApiServerKey: Boolean(env.API_SERVER_KEY?.trim()),
    hasMiniMaxKey: Boolean(env.MINIMAX_API_KEY?.trim()),
    hasMiniMaxCnKey: Boolean(env.MINIMAX_CN_API_KEY?.trim()),
    hasOpenAIKey: Boolean(env.OPENAI_API_KEY?.trim()),
    hasXaiKey: Boolean(env.XAI_API_KEY?.trim()),
    hasDashScopeKey: Boolean(env.DASHSCOPE_API_KEY?.trim()),
    hasOpenRouterKey: Boolean(env.OPENROUTER_API_KEY?.trim()),
    hasGithubToken: Boolean(env.GITHUB_TOKEN?.trim()),
    hasFirecrawlKey: Boolean(env.FIRECRAWL_API_KEY?.trim()),
    hasBrowserUseKey: Boolean(env.BROWSER_USE_API_KEY?.trim()),
    hasFalKey: Boolean(env.FAL_KEY?.trim() || env.FAL_API_KEY?.trim()),
  };
}

export async function getSettingsAudit(
  profile?: string,
): Promise<SettingsAudit> {
  const targetProfile = profile || "default";
  const install = checkInstallStatus();
  const connection = getConnectionConfig();
  const model = getModelConfig(targetProfile);
  const envValues = readEnv(targetProfile);
  const credentials = getCredentialPool();
  const credentialProviders = Object.entries(credentials)
    .filter(([, entries]) => entries.length > 0)
    .map(([provider, entries]) => ({ provider, count: entries.length }));

  const [
    capabilities,
    updateCheck,
    doctor,
    status,
    profileShow,
    memoryStatus,
    cronStatus,
    toolsSummary,
    curator,
    profiles,
    memoryProviders,
    memoryData,
    toolsets,
    mcpServers,
    cronJobs,
    tailscale,
    kanban,
    kanbanDiagnostics,
    codexRuntime,
  ] = await Promise.all([
    getHermesCapabilities(targetProfile),
    runHermesCommand(["update", "--check"], undefined, 60000),
    runHermesCommand(["doctor"], targetProfile, 60000),
    runHermesCommand(["status", "--all"], targetProfile, 60000),
    runHermesCommand(["profile", "show", targetProfile], undefined, 30000),
    runHermesCommand(["memory", "status"], targetProfile, 30000),
    runHermesCommand(["cron", "status"], targetProfile, 30000),
    runHermesCommand(["tools", "--summary"], targetProfile, 30000),
    runHermesCurator("status", undefined, targetProfile),
    listProfiles().catch(() => []),
    Promise.resolve(discoverMemoryProviders(targetProfile)),
    Promise.resolve()
      .then(() => readMemory(targetProfile))
      .catch(() => null),
    Promise.resolve(getToolsets(targetProfile)),
    Promise.resolve(listMcpServers(targetProfile)),
    listCronJobs(true, targetProfile).catch(() => []),
    getTailscaleMobileStatus().catch(() => ({
      installed: false,
      daemonRunning: false,
      backendState: "unknown",
      online: false,
      dnsName: "",
      tailnetUrl: "",
      pairUrl: "",
      tailscaleIps: [],
      serveEnabled: false,
      serveTarget: "",
      mobileServerRunning: false,
      mobileServerPort: 8780,
      pairingToken: "",
      version: "",
      error: "Tailscale status failed.",
      serveStatus: "",
      noFunnel: true as const,
    })),
    listKanbanBoard().catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })),
    runHermesCommand(["kanban", "diagnostics", "--json"], targetProfile, 30000),
    getCodexRuntimeStatus(targetProfile),
  ]);

  const cards = buildSettingsAuditCards({
    profile: targetProfile,
    capabilities,
    updateCheck,
    doctor,
    status,
    profileShow,
    memoryProviders,
    memoryStatus,
    cronStatus,
    cronJobs,
    mcpServers,
    toolsets,
    curator,
    profiles,
    kanban,
    kanbanDiagnostics,
    codexRuntime,
    tailscale,
    credentialProviders,
    env: envFlags(envValues),
  });
  const buckets = buildSettingsAuditBuckets(cards);

  return {
    profile: targetProfile,
    createdAt: Date.now(),
    summary: summarizeSettingsAuditBuckets(buckets),
    buckets,
    cards,
    raw: {
      install,
      connection,
      model,
      env: envFlags(envValues),
      credentialProviders,
      capabilities,
      updateCheck,
      doctor,
      status,
      profileShow,
      memoryStatus,
      cronStatus,
      toolsSummary,
      curator,
      profiles,
      memoryProviders,
      memoryStats: memoryData?.stats || null,
      toolsets,
      mcpServers,
      cronJobs,
      tailscale,
      kanban,
      kanbanDiagnostics,
      codexRuntime,
    },
  };
}

export async function runSettingsAuditAction(
  action: string,
  profile?: string,
): Promise<SettingsAuditActionResult> {
  const targetProfile = profile || "default";
  if (action === "codex-runtime-enable" || action === "codex-runtime-disable") {
    const result = await runCodexRuntimeAction(
      action === "codex-runtime-enable" ? "enable" : "disable",
      targetProfile,
    );
    return {
      action,
      createdAt: Date.now(),
      success: result.success,
      output: result.output,
      error: result.error,
    };
  }

  const command =
    action === "doctor"
      ? ["doctor"]
      : action === "doctor-fix"
        ? ["doctor", "--fix"]
        : action === "update-check"
          ? ["update", "--check"]
          : action === "restart-gateway"
            ? ["gateway", "restart"]
            : action === "tools-summary"
              ? ["tools", "--summary"]
              : action === "memory-status"
                ? ["memory", "status"]
                : action === "cron-status"
                  ? ["cron", "status"]
                  : action === "curator-list-archived"
                    ? ["curator", "list-archived"]
                    : action === "kanban-diagnostics"
                      ? ["kanban", "diagnostics", "--json"]
                      : action === "kanban-boards"
                        ? ["kanban", "boards", "list", "--json"]
                        : null;

  if (!command) {
    return {
      action,
      createdAt: Date.now(),
      success: false,
      output: "",
      error: `Unknown settings action: ${action}`,
    };
  }

  const result = await runHermesCommand(
    command,
    action === "update-check" ? undefined : targetProfile,
    action === "doctor-fix" || action === "restart-gateway" ? 120000 : 45000,
  );
  return { ...result, action, createdAt: Date.now() };
}
