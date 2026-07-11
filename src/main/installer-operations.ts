import { execFile } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer-paths";
import {
  runHermesCommand,
  type HermesCommandResult,
} from "./installer-command";
import { profileHome, stripAnsi } from "./utils";

export async function runHermesBackup(
  profile?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { success: false, error: "80M is not installed." };
  }
  const args = [HERMES_SCRIPT, "backup"];
  if (profile && profile !== "default") args.push("-p", profile);

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: 120000,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: stripAnsi(stderr || error.message).slice(0, 500),
          });
          return;
        }
        const output = stripAnsi(stdout);
        const pathMatch = output.match(
          /(?:Backup saved|Written|Created).*?(\S+\.(?:tar\.gz|zip|tgz))/i,
        );
        resolve({
          success: true,
          path: pathMatch?.[1] || output.trim().split("\n").pop()?.trim(),
        });
      },
    );
  });
}

export function validateHermesImportArchive(
  archivePath: string,
): string | null {
  const archive = archivePath?.trim();
  if (!archive) return "Choose a Hermes backup archive first.";
  if (!existsSync(archive)) return `Backup archive not found: ${archive}`;
  return null;
}

export async function runHermesImport(
  archivePath: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { success: false, error: "80M is not installed." };
  }
  const archive = archivePath?.trim();
  const validationError = validateHermesImportArchive(archive);
  if (validationError) return { success: false, error: validationError };
  const args = [HERMES_SCRIPT, "import", archive];
  if (profile && profile !== "default") args.push("-p", profile);

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      args,
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: 120000,
      },
      (error, _stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: stripAnsi(stderr || error.message).slice(0, 500),
          });
          return;
        }
        resolve({ success: true });
      },
    );
  });
}

export function runHermesDump(): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve("80M is not installed.");
  }
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "dump"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: HOST_HOME,
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout: 30000,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(stripAnsi(stderr || error.message));
        } else {
          resolve(stripAnsi(stdout));
        }
      },
    );
  });
}

export interface CuratorReport {
  reportPath: string | null;
  report: string;
  runJsonPath: string | null;
  runJson: unknown | null;
}

export interface CuratorCommandResult extends HermesCommandResult {
  supported: boolean;
  pinned: string[];
  report: CuratorReport;
}

function readPinnedSkills(profile?: string): string[] {
  const usagePath = join(profileHome(profile), "skills", ".usage.json");
  if (!existsSync(usagePath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(usagePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => {
        return (
          value &&
          typeof value === "object" &&
          Boolean((value as { pinned?: boolean }).pinned)
        );
      })
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function newestCuratorReportDir(profile?: string): string | null {
  const root = join(profileHome(profile), "logs", "curator");
  if (!existsSync(root)) return null;

  const candidates = [root];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(join(root, entry.name));
    }
  } catch {
    return root;
  }

  return (
    candidates
      .filter((candidate) => existsSync(join(candidate, "REPORT.md")))
      .sort((a, b) => {
        try {
          return (
            statSync(join(b, "REPORT.md")).mtimeMs -
            statSync(join(a, "REPORT.md")).mtimeMs
          );
        } catch {
          return 0;
        }
      })[0] ?? root
  );
}

export function readCuratorReport(profile?: string): CuratorReport {
  const dir = newestCuratorReportDir(profile);
  const reportPath = dir ? join(dir, "REPORT.md") : null;
  const runJsonPath = dir ? join(dir, "run.json") : null;
  let report = "";
  let runJson: unknown | null = null;

  try {
    if (reportPath && existsSync(reportPath)) {
      report = readFileSync(reportPath, "utf-8");
    }
  } catch {
    report = "";
  }

  try {
    if (runJsonPath && existsSync(runJsonPath)) {
      runJson = JSON.parse(readFileSync(runJsonPath, "utf-8"));
    }
  } catch {
    runJson = null;
  }

  return {
    reportPath: reportPath && existsSync(reportPath) ? reportPath : null,
    report,
    runJsonPath: runJsonPath && existsSync(runJsonPath) ? runJsonPath : null,
    runJson,
  };
}

function curatorSupported(result: HermesCommandResult): boolean {
  const text = `${result.output}\n${result.error || ""}`;
  return !/no such command|unknown command|invalid choice|usage:.*hermes/i.test(
    text,
  );
}

export async function runHermesCurator(
  action: string,
  skill?: string,
  profile?: string,
): Promise<CuratorCommandResult> {
  let args: string[];
  switch (action) {
    case "status":
      args = ["curator", "status"];
      break;
    case "dry-run":
      args = ["curator", "run", "--dry-run"];
      break;
    case "run":
      args = ["curator", "run"];
      break;
    case "run-sync":
      args = ["curator", "run", "--sync"];
      break;
    case "backup":
      args = ["curator", "backup"];
      break;
    case "rollback":
      args = ["curator", "rollback", "-y"];
      break;
    case "pause":
      args = ["curator", "pause"];
      break;
    case "resume":
      args = ["curator", "resume"];
      break;
    case "list-archived":
      args = ["curator", "list-archived"];
      break;
    case "prune":
      args = ["curator", "prune", "--dry-run"];
      break;
    case "pin":
    case "unpin":
    case "archive":
    case "restore":
      if (!skill?.trim()) {
        return {
          success: false,
          supported: true,
          output: "",
          error: "A skill name is required.",
          pinned: readPinnedSkills(profile),
          report: readCuratorReport(profile),
        };
      }
      args = ["curator", action, skill.trim()];
      break;
    default:
      return {
        success: false,
        supported: true,
        output: "",
        error: `Unknown curator action: ${action}`,
        pinned: readPinnedSkills(profile),
        report: readCuratorReport(profile),
      };
  }

  const timeout = action === "run-sync" ? 900000 : 180000;
  const result = await runHermesCommand(args, profile, timeout);
  return {
    ...result,
    supported: curatorSupported(result),
    pinned: readPinnedSkills(profile),
    report: readCuratorReport(profile),
  };
}

export interface MemoryProviderInfo {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
}

export function discoverMemoryProviders(
  profile?: string,
): MemoryProviderInfo[] {
  const pluginsDir = join(HERMES_REPO, "plugins", "memory");
  if (!existsSync(pluginsDir)) return [];

  const activeProvider = getActiveMemoryProvider(profile);

  const knownProviders: Record<
    string,
    { description: string; envVars: string[]; pip?: string }
  > = {
    honcho: {
      description: "memory.providers.honcho",
      envVars: ["HONCHO_API_KEY"],
      pip: "honcho-ai",
    },
    hindsight: {
      description: "memory.providers.hindsight",
      envVars: ["HINDSIGHT_API_KEY", "HINDSIGHT_API_URL", "HINDSIGHT_BANK_ID"],
      pip: "hindsight-client",
    },
    mem0: {
      description: "memory.providers.mem0",
      envVars: ["MEM0_API_KEY"],
      pip: "mem0ai",
    },
    retaindb: {
      description: "memory.providers.retaindb",
      envVars: ["RETAINDB_API_KEY"],
    },
    supermemory: {
      description: "memory.providers.supermemory",
      envVars: ["SUPERMEMORY_API_KEY"],
      pip: "supermemory",
    },
    holographic: {
      description: "memory.providers.holographic",
      envVars: [],
    },
    openviking: {
      description: "memory.providers.openviking",
      envVars: ["OPENVIKING_ENDPOINT", "OPENVIKING_API_KEY"],
    },
    byterover: {
      description: "memory.providers.byterover",
      envVars: ["BRV_API_KEY"],
    },
  };

  const results: MemoryProviderInfo[] = [];

  try {
    const dirs = readdirSync(pluginsDir, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith("_")) continue;
      const name = d.name;
      const known = knownProviders[name];
      const initFile = join(pluginsDir, name, "__init__.py");
      const installed = existsSync(initFile);

      results.push({
        name,
        description: known?.description || name,
        installed,
        active: name === activeProvider,
        envVars: known?.envVars || [],
      });
    }
  } catch {
    /* non-fatal */
  }

  results.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

export function getActiveMemoryProvider(profile?: string): string {
  try {
    const configDir =
      profile && profile !== "default"
        ? join(HERMES_HOME, "profiles", profile)
        : HERMES_HOME;
    const configPath = join(configDir, "config.yaml");
    if (!existsSync(configPath)) return "";
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^\s*provider:\s*["']?(\w+)["']?\s*$/m);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

export function listMcpServers(
  profile?: string,
): Array<{ name: string; type: string; enabled: boolean; detail: string }> {
  try {
    const configPath = join(
      profile && profile !== "default"
        ? join(HERMES_HOME, "profiles", profile)
        : HERMES_HOME,
      "config.yaml",
    );
    if (!existsSync(configPath)) return [];
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^mcp_servers:\s*\n((?:[ \t]+.+\n)*)/m);
    if (!match) return [];

    const servers: Array<{
      name: string;
      type: string;
      enabled: boolean;
      detail: string;
    }> = [];
    const block = match[1];
    const nameRe = /^[ ]{2}(\w[\w-]*):\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(block)) !== null) {
      const name = m[1];
      const start = m.index + m[0].length;
      const nextMatch = /\n {2}\w/g;
      nextMatch.lastIndex = start;
      const next = nextMatch.exec(block);
      const serverBlock = block.slice(start, next ? next.index : undefined);
      const hasUrl = /url:/.test(serverBlock);
      const hasCommand = /command:/.test(serverBlock);
      const enabledMatch = serverBlock.match(/enabled:\s*(true|false)/i);
      const enabled =
        enabledMatch === null || enabledMatch[1].toLowerCase() === "true";

      let detail = "";
      if (hasUrl) {
        const urlMatch = serverBlock.match(/url:\s*["']?([^\s"']+)/);
        detail = urlMatch?.[1] || "HTTP";
      } else if (hasCommand) {
        const cmdMatch = serverBlock.match(/command:\s*["']?([^\s"']+)/);
        detail = cmdMatch?.[1] || "stdio";
      }

      servers.push({
        name,
        type: hasUrl ? "http" : "stdio",
        enabled,
        detail,
      });
    }
    return servers;
  } catch {
    return [];
  }
}

export function readLogs(
  logFile = "agent.log",
  lines = 200,
): { content: string; path: string } {
  const logsDir = join(HERMES_HOME, "logs");
  const allowed = ["agent.log", "errors.log", "gateway.log"];
  const file = allowed.includes(logFile) ? logFile : "agent.log";
  const fullPath = join(logsDir, file);

  if (!existsSync(fullPath)) {
    return { content: "", path: fullPath };
  }
  try {
    const content = readFileSync(fullPath, "utf-8");
    const allLines = content.split("\n");
    const tail = allLines.slice(-lines).join("\n");
    return { content: tail, path: fullPath };
  } catch {
    return { content: "", path: fullPath };
  }
}
