import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  getEnhancedPath,
} from "./installer-paths";
import { stripAnsi } from "./utils";

export interface CodexRuntimeStatus {
  profile: string;
  profileHome: string;
  openaiRuntime: "auto" | "codex_app_server";
  configPath: string;
  configExists: boolean;
  cliAvailable: boolean;
  codexVersion: string;
  codexVersionOk: boolean;
  loginOk: boolean;
  loginSummary: string;
  authJsonExists: boolean;
  codexConfigPath: string;
  codexConfigExists: boolean;
  hermesToolsMcpRegistered: boolean;
  hermesManagedBlockPresent: boolean;
  codexMcpServerCount: number;
  nativePluginCount: number;
  nativePlugins: string[];
  mcpListSummary: string;
  error?: string;
}

export interface CodexRuntimeActionResult {
  success: boolean;
  output: string;
  error?: string;
  status?: CodexRuntimeStatus;
}

function normalizeProfileName(profile?: string | null): string {
  const name = String(profile || "default").trim();
  if (!name || name.toLowerCase() === "default") return "default";
  return name.toLowerCase();
}

function resolveProfileHome(profile?: string): string {
  const name = normalizeProfileName(profile);
  return name === "default" ? HERMES_HOME : join(HERMES_HOME, "profiles", name);
}

function readModelOpenaiRuntime(
  configText: string,
): "auto" | "codex_app_server" {
  const lines = configText.split(/\r?\n/);
  const modelStart = lines.findIndex((line) =>
    /^model:\s*(?:#.*)?$/.test(line),
  );
  if (modelStart === -1) return "auto";

  for (let i = modelStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+openai_runtime:\s*["']?([^"'\s#]+)["']?/);
    if (!match) continue;
    return match[1] === "codex_app_server" ? "codex_app_server" : "auto";
  }
  return "auto";
}

function parseVersion(raw: string): string {
  return raw.match(/codex-cli\s+([0-9A-Za-z.+-]+)/)?.[1] || "";
}

function versionAtLeast(actual: string, required: string): boolean {
  const parse = (value: string): number[] =>
    value
      .split(/[.+-]/)[0]
      .split(".")
      .map((part) => Number(part) || 0);
  const a = parse(actual);
  const b = parse(required);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

function commandEnv(profileHome?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: HOST_HOME,
    HERMES_HOME: profileHome || HERMES_HOME,
    TERM: "dumb",
  };
}

function runLocalCommand(
  command: string,
  args: string[],
  timeout = 30000,
  profileHome?: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: HERMES_REPO,
        env: commandEnv(profileHome),
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const output = stripAnsi(String(stdout || "")).trim();
        const cleanError = stripAnsi(String(stderr || "")).trim();
        resolve({
          success: !error,
          output: output || cleanError,
          error: error ? cleanError || error.message : undefined,
        });
      },
    );
  });
}

function readCodexConfig(): {
  path: string;
  exists: boolean;
  text: string;
  nativePlugins: string[];
  mcpServerCount: number;
  hermesToolsMcpRegistered: boolean;
  hermesManagedBlockPresent: boolean;
} {
  const path = join(homedir(), ".codex", "config.toml");
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      text: "",
      nativePlugins: [],
      mcpServerCount: 0,
      hermesToolsMcpRegistered: false,
      hermesManagedBlockPresent: false,
    };
  }

  const text = readFileSync(path, "utf-8");
  const nativePlugins = Array.from(
    text.matchAll(/^\[plugins\."([^"]+)"\]\s*$/gm),
  ).map((match) => match[1]);
  const mcpServerCount = Array.from(
    text.matchAll(/^\[mcp_servers\.(?:"[^"]+"|[A-Za-z0-9_-]+)\]\s*$/gm),
  ).length;

  return {
    path,
    exists: true,
    text,
    nativePlugins,
    mcpServerCount,
    hermesToolsMcpRegistered:
      /^\[mcp_servers\.(?:"hermes-tools"|hermes-tools)\]\s*$/m.test(text),
    hermesManagedBlockPresent: text.includes("managed by hermes-agent"),
  };
}

export async function getCodexRuntimeStatus(
  profile?: string,
): Promise<CodexRuntimeStatus> {
  const normalizedProfile = normalizeProfileName(profile);
  const profileHome = resolveProfileHome(profile);
  const configPath = join(profileHome, "config.yaml");
  const configExists = existsSync(configPath);
  const configText = configExists ? readFileSync(configPath, "utf-8") : "";
  const codexConfig = readCodexConfig();

  const [versionResult, loginResult, mcpListResult] = await Promise.all([
    runLocalCommand("codex", ["--version"], 15000, profileHome),
    runLocalCommand("codex", ["login", "status"], 15000, profileHome),
    runLocalCommand("codex", ["mcp", "list"], 15000, profileHome),
  ]);

  const codexVersion = parseVersion(versionResult.output);
  const loginSummary =
    loginResult.output.split(/\r?\n/).find(Boolean) ||
    loginResult.error ||
    "Not logged in";

  return {
    profile: normalizedProfile,
    profileHome,
    openaiRuntime: readModelOpenaiRuntime(configText),
    configPath,
    configExists,
    cliAvailable: versionResult.success,
    codexVersion,
    codexVersionOk: Boolean(
      codexVersion && versionAtLeast(codexVersion, "0.130.0"),
    ),
    loginOk: loginResult.success && /logged in/i.test(loginSummary),
    loginSummary,
    authJsonExists: existsSync(join(homedir(), ".codex", "auth.json")),
    codexConfigPath: codexConfig.path,
    codexConfigExists: codexConfig.exists,
    hermesToolsMcpRegistered: codexConfig.hermesToolsMcpRegistered,
    hermesManagedBlockPresent: codexConfig.hermesManagedBlockPresent,
    codexMcpServerCount: codexConfig.mcpServerCount,
    nativePluginCount: codexConfig.nativePlugins.length,
    nativePlugins: codexConfig.nativePlugins,
    mcpListSummary:
      mcpListResult.output.split(/\r?\n/).slice(0, 4).join("\n") ||
      mcpListResult.error ||
      "",
    error: versionResult.success ? undefined : versionResult.error,
  };
}

function codexRuntimeScript(): string {
  return `
import json
import sys
from hermes_cli.config import load_config, save_config
from hermes_cli.codex_runtime_switch import apply
from hermes_cli.codex_runtime_plugin_migration import migrate

mode = sys.argv[1]
cfg = load_config()
new_value = "codex_app_server" if mode == "enable" else "auto"
result = apply(cfg, new_value, persist_callback=save_config)
extra = []

if (
    mode == "enable"
    and result.success
    and result.old_value == "codex_app_server"
    and result.new_value == "codex_app_server"
):
    report = migrate(cfg)
    extra.append(report.summary())

message = result.message
if extra:
    message = message + "\\n" + "\\n".join(x for x in extra if x)

print(json.dumps({
    "success": bool(result.success),
    "output": message,
    "error": "" if result.success else result.message,
}, ensure_ascii=True))
sys.exit(0 if result.success else 1)
`;
}

export async function runCodexRuntimeAction(
  action: "enable" | "disable",
  profile?: string,
): Promise<CodexRuntimeActionResult> {
  const profileHome = resolveProfileHome(profile);
  if (!existsSync(HERMES_PYTHON)) {
    return {
      success: false,
      output: "",
      error: "Hermes Python runtime is not installed.",
    };
  }

  const result = await runLocalCommand(
    HERMES_PYTHON,
    ["-c", codexRuntimeScript(), action],
    120000,
    profileHome,
  );

  let output = result.output;
  let success = result.success;
  let error = result.error;
  try {
    const jsonLine = result.output
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith("{"));
    const parsed = JSON.parse(jsonLine || result.output) as {
      success?: boolean;
      output?: string;
      error?: string;
    };
    success = parsed.success !== false && result.success;
    output = parsed.output || result.output;
    error = parsed.error || result.error;
  } catch {
    /* keep raw command output */
  }

  const status = await getCodexRuntimeStatus(profile);
  return { success, output, error, status };
}
