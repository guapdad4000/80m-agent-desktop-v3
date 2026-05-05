import { ChildProcess, execFile, spawn } from "child_process";
import {
  existsSync,
  readFileSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import http from "http";
import https from "https";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  getEnhancedPath,
  getHermesVersion,
} from "./installer";
import {
  getModelConfig,
  readEnv,
  setEnvValue,
  getConnectionConfig,
  getPlatformEnabled,
} from "./config";
import { profileHome, safeWriteFile, stripAnsi } from "./utils";

const LOCAL_API_URL = "http://127.0.0.1:8642";

function getApiUrl(): string {
  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.remoteUrl) {
    return conn.remoteUrl.replace(/\/+$/, "");
  }
  return LOCAL_API_URL;
}

export function isRemoteMode(): boolean {
  return getConnectionConfig().mode === "remote";
}

function getRemoteAuthHeader(): Record<string, string> {
  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.apiKey) {
    return { Authorization: `Bearer ${conn.apiKey}` };
  }
  return {};
}

function getApiServerAuthHeader(profile?: string): Record<string, string> {
  const remoteHeader = getRemoteAuthHeader();
  if (remoteHeader.Authorization) return remoteHeader;

  const conn = getConnectionConfig();
  if (conn.mode === "local") {
    const key = readEnv(profile).API_SERVER_KEY || process.env.API_SERVER_KEY;
    if (key) return { Authorization: `Bearer ${key}` };
  }

  return {};
}

function ensureApiServerKey(profile?: string): string {
  const existing =
    readEnv(profile).API_SERVER_KEY || process.env.API_SERVER_KEY;
  if (existing?.trim()) return existing.trim();

  const key = `hsk_${randomBytes(24).toString("hex")}`;
  setEnvValue("API_SERVER_KEY", key, profile);
  return key;
}

const PLATFORM_ENV_KEYS: Record<string, string[]> = {
  discord: [
    "DISCORD_BOT_TOKEN",
    "DISCORD_HOME_CHANNEL",
    "DISCORD_HOME_CHANNEL_NAME",
  ],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_HOME_CHANNEL"],
  slack: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"],
  whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
  signal: ["SIGNAL_PHONE_NUMBER"],
};

function ensureGatewayEnvShim(): string {
  const shimDir = join(HERMES_HOME, "desktop-runtime");
  const shimPath = join(shimDir, "sitecustomize.py");
  if (!existsSync(shimDir)) {
    mkdirSync(shimDir, { recursive: true });
  }

  writeFileSync(
    shimPath,
    [
      '"""80m desktop gateway environment shim."""',
      "import os",
      "try:",
      "    import dotenv",
      "    _original_load_dotenv = dotenv.load_dotenv",
      "    def _load_dotenv_without_disabled_platforms(*args, **kwargs):",
      "        result = _original_load_dotenv(*args, **kwargs)",
      "        disabled = os.getenv('HERMES_DESKTOP_DISABLED_ENV_KEYS', '')",
      "        for key in disabled.split(','):",
      "            key = key.strip()",
      "            if key:",
      "                os.environ.pop(key, None)",
      "        return result",
      "    dotenv.load_dotenv = _load_dotenv_without_disabled_platforms",
      "except Exception:",
      "    pass",
      "",
    ].join("\n"),
    "utf-8",
  );

  return shimDir;
}

const LOCAL_PROVIDERS = new Set([
  "custom",
  "lmstudio",
  "ollama",
  "vllm",
  "llamacpp",
]);

// Map base-URL patterns to the API key env var they need
const URL_KEY_MAP: Array<{ pattern: RegExp; envKey: string }> = [
  { pattern: /openrouter\.ai/i, envKey: "OPENROUTER_API_KEY" },
  { pattern: /anthropic\.com/i, envKey: "ANTHROPIC_API_KEY" },
  { pattern: /openai\.com/i, envKey: "OPENAI_API_KEY" },
  { pattern: /huggingface\.co/i, envKey: "HF_TOKEN" },
];

interface ChatHandle {
  abort: () => void;
}

interface ApiRequestResult<T = unknown> {
  ok: boolean;
  status: number | null;
  data: T | null;
  error?: string;
}

interface HermesRunEvent {
  event?: string;
  run_id?: string;
  runId?: string;
  delta?: string;
  output?: string;
  error?: string;
  tool?: string;
  preview?: string;
  text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface HermesRunStatusPayload {
  run_id?: string;
  status?: string;
  session_id?: string;
  output?: string;
  error?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  last_event?: string;
}

export interface HermesDesktopCapabilities {
  version: string | null;
  semver: string | null;
  isAtLeastV12: boolean;
  updateAvailable: boolean;
  api: {
    ok: boolean;
    status: number | null;
    url: string;
    error?: string;
    features: Record<string, boolean>;
    endpoints: Record<string, { method?: string; path?: string }>;
    models: string[];
  };
  toolGateway: {
    present: boolean;
    available: boolean;
    reason: string;
    managedTools: string[];
  };
  supports: {
    chatCompletions: boolean;
    responses: boolean;
    runs: boolean;
    runEvents: boolean;
    runStop: boolean;
    toolProgress: boolean;
    sessionContinuity: boolean;
    curator: boolean;
  };
}

export interface HermesRunStartResult {
  success: boolean;
  runId?: string;
  status?: string;
  sessionId?: string;
  error?: string;
  raw?: unknown;
}

export interface HermesRunStatusResult {
  success: boolean;
  runId?: string;
  status?: string;
  sessionId?: string;
  output?: string;
  usage?: unknown;
  error?: string;
  raw?: unknown;
}

function parseHermesSemver(version: string | null): string | null {
  return version?.match(/v(\d+\.\d+\.\d+)/)?.[1] || null;
}

function semverAtLeast(value: string | null, minimum: string): boolean {
  if (!value) return false;
  const current = value.split(".").map((part) => Number(part));
  const target = minimum.split(".").map((part) => Number(part));
  for (let i = 0; i < target.length; i += 1) {
    const a = current[i] || 0;
    const b = target[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function runHermesText(args: string[], timeout = 45000): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, ...args],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
          TERM: "dumb",
        },
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (_error, stdout, stderr) => {
        resolve(stripAnsi(stdout || stderr || ""));
      },
    );
  });
}

function runHermesStatusText(): Promise<string> {
  return runHermesText(["status"]);
}

function parseToolGateway(
  statusText: string,
): HermesDesktopCapabilities["toolGateway"] {
  const section = statusText.match(
    /◆ Nous Tool Gateway([\s\S]*?)(?:\n◆ |\n─|$)/,
  )?.[1];
  if (!section) {
    return {
      present: false,
      available: false,
      reason: "Status output did not include Nous Tool Gateway.",
      managedTools: [],
    };
  }

  const unavailable =
    /does not include|upgrade|free-tier|not included|not available/i.test(
      section,
    );
  const managedTools = ["web", "image_gen", "tts", "browser"];
  return {
    present: true,
    available: !unavailable,
    reason: section
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" "),
    managedTools: unavailable ? [] : managedTools,
  };
}

function apiJson<T = unknown>(
  path: string,
  profile?: string,
  method = "GET",
  body?: unknown,
): Promise<ApiRequestResult<T>> {
  return new Promise((resolveResult) => {
    try {
      const target = new URL(path, getApiUrl());
      const mod = target.protocol === "https:" ? https : http;
      const payload =
        body == null ? undefined : Buffer.from(JSON.stringify(body), "utf-8");
      const headers: Record<string, string | number> = {
        ...getApiServerAuthHeader(profile),
        Accept: "application/json",
      };
      if (payload) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = payload.byteLength;
      }

      const req = mod.request(
        target,
        {
          method,
          timeout: 8000,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            try {
              resolveResult({
                ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
                status: res.statusCode || null,
                data: text ? (JSON.parse(text) as T) : null,
              });
            } catch {
              resolveResult({
                ok: false,
                status: res.statusCode || null,
                data: null,
                error: text.slice(0, 500) || "Invalid JSON response.",
              });
            }
          });
        },
      );
      req.on("error", (error) =>
        resolveResult({
          ok: false,
          status: null,
          data: null,
          error: error.message,
        }),
      );
      req.on("timeout", () => {
        req.destroy();
        resolveResult({
          ok: false,
          status: null,
          data: null,
          error: "timeout",
        });
      });
      if (payload) req.write(payload);
      req.end();
    } catch (error) {
      resolveResult({
        ok: false,
        status: null,
        data: null,
        error: error instanceof Error ? error.message : "invalid request",
      });
    }
  });
}

export async function getHermesCapabilities(
  profile?: string,
): Promise<HermesDesktopCapabilities> {
  const [version, statusText, curatorText, capabilities, models] =
    await Promise.all([
      getHermesVersion(),
      runHermesStatusText(),
      runHermesText(["curator", "status"], 30000),
      apiJson<{
        features?: Record<string, boolean>;
        endpoints?: Record<string, { method?: string; path?: string }>;
      }>("/v1/capabilities", profile),
      apiJson<{ data?: Array<{ id?: string }> }>("/v1/models", profile),
    ]);

  const features = capabilities.data?.features || {};
  const endpoints = capabilities.data?.endpoints || {};
  const semver = parseHermesSemver(version);
  const apiOk = capabilities.ok;

  return {
    version,
    semver,
    isAtLeastV12: semverAtLeast(semver, "0.12.0"),
    updateAvailable:
      /update available|commits behind|run 'hermes update'/i.test(
        `${version || ""}\n${statusText}`,
      ),
    api: {
      ok: apiOk,
      status: capabilities.status,
      url: getApiUrl(),
      error: capabilities.error,
      features,
      endpoints,
      models: (models.data?.data || [])
        .map((entry) => entry.id)
        .filter((id): id is string => Boolean(id)),
    },
    toolGateway: parseToolGateway(statusText),
    supports: {
      chatCompletions: Boolean(features.chat_completions),
      responses: Boolean(features.responses_api),
      runs: Boolean(features.run_submission && features.run_status),
      runEvents: Boolean(features.run_events_sse),
      runStop: Boolean(features.run_stop),
      toolProgress: Boolean(features.tool_progress_events),
      sessionContinuity: Boolean(features.session_continuity_header),
      curator:
        /curator:\s*enabled|agent-created skills|least recently used/i.test(
          curatorText,
        ),
    },
  };
}

export async function startHermesRun(
  input: string,
  profile?: string,
  options: {
    sessionId?: string;
    instructions?: string;
    previousResponseId?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  } = {},
): Promise<HermesRunStartResult> {
  const result = await apiJson<{
    run_id?: string;
    status?: string;
    session_id?: string;
  }>("/v1/runs", profile, "POST", {
    input,
    session_id: options.sessionId,
    instructions: options.instructions,
    previous_response_id: options.previousResponseId,
    conversation_history: options.conversationHistory,
  });

  if (!result.ok) {
    return {
      success: false,
      error: result.error || `HTTP ${result.status || "error"}`,
      raw: result.data,
    };
  }
  return {
    success: true,
    runId: result.data?.run_id,
    status: result.data?.status,
    sessionId: result.data?.session_id,
    raw: result.data,
  };
}

export async function getHermesRun(
  runId: string,
  profile?: string,
): Promise<HermesRunStatusResult> {
  const result = await apiJson<{
    run_id?: string;
    status?: string;
    session_id?: string;
    output?: string;
    usage?: unknown;
  }>(`/v1/runs/${encodeURIComponent(runId)}`, profile);

  if (!result.ok) {
    return {
      success: false,
      error: result.error || `HTTP ${result.status || "error"}`,
      raw: result.data,
    };
  }
  return {
    success: true,
    runId: result.data?.run_id,
    status: result.data?.status,
    sessionId: result.data?.session_id,
    output: result.data?.output,
    usage: result.data?.usage,
    raw: result.data,
  };
}

export async function stopHermesRun(
  runId: string,
  profile?: string,
): Promise<HermesRunStatusResult> {
  const result = await apiJson<{ status?: string }>(
    `/v1/runs/${encodeURIComponent(runId)}/stop`,
    profile,
    "POST",
    {},
  );

  if (!result.ok) {
    return {
      success: false,
      error: result.error || `HTTP ${result.status || "error"}`,
      raw: result.data,
    };
  }
  return {
    success: true,
    runId,
    status: result.data?.status,
    raw: result.data,
  };
}

const LONG_HAUL_ENV_MINIMUMS: Record<string, number> = {
  HERMES_MAX_ITERATIONS: 300,
  HERMES_API_TIMEOUT: 7200,
  HERMES_API_CALL_STALE_TIMEOUT: 7200,
  HERMES_STREAM_READ_TIMEOUT: 7200,
  HERMES_STREAM_STALE_TIMEOUT: 7200,
  TERMINAL_TIMEOUT: 3600,
  TERMINAL_LIFETIME_SECONDS: 86400,
  BROWSER_INACTIVITY_TIMEOUT: 1800,
  BROWSER_COMMAND_TIMEOUT: 600,
  BROWSER_DIALOG_TIMEOUT_S: 1800,
  HERMES_RESTART_DRAIN_TIMEOUT: 3600,
  HERMES_AUTO_CONTINUE_FRESHNESS: 86400,
};

const LONG_HAUL_ENV_EXACT: Record<string, string> = {
  HERMES_AGENT_TIMEOUT: "0",
  HERMES_CRON_TIMEOUT: "0",
};

const LONG_HAUL_CONFIG_MINIMUMS = [
  ["agent", "max_turns", 300],
  ["agent", "restart_drain_timeout", 3600],
  ["agent", "gateway_timeout_warning", 1800],
  ["agent", "gateway_notify_interval", 600],
  ["agent", "gateway_auto_continue_freshness", 86400],
  ["terminal", "timeout", 3600],
  ["terminal", "lifetime_seconds", 86400],
  ["browser", "inactivity_timeout", 1800],
  ["browser", "command_timeout", 600],
  ["browser", "dialog_timeout_s", 1800],
  ["file_read_max_chars", "", 300000],
  ["tool_output", "max_bytes", 200000],
  ["tool_output", "max_lines", 5000],
] as const;

const LONG_HAUL_CONFIG_EXACT = [["agent", "gateway_timeout", 0]] as const;

function parsePositiveNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureEnvNumberAtLeast(
  key: string,
  minimum: number,
  profile?: string,
): boolean {
  const existing = readEnv(profile)[key] || process.env[key];
  const parsed = parsePositiveNumber(existing);
  if (parsed == null || parsed < minimum) {
    setEnvValue(key, String(minimum), profile);
    return true;
  }
  return false;
}

function ensureEnvExact(key: string, value: string, profile?: string): boolean {
  const existing = readEnv(profile)[key] || process.env[key];
  if (existing !== value) {
    setEnvValue(key, value, profile);
    return true;
  }
  return false;
}

function applyLongHaulEnv(env: Record<string, string>): Record<string, string> {
  for (const [key, minimum] of Object.entries(LONG_HAUL_ENV_MINIMUMS)) {
    const parsed = parsePositiveNumber(env[key] || process.env[key]);
    env[key] = String(parsed != null && parsed >= minimum ? parsed : minimum);
  }
  for (const [key, value] of Object.entries(LONG_HAUL_ENV_EXACT)) {
    env[key] = value;
  }
  return env;
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function splitLineValue(line: string): { value: string; comment: string } {
  const hash = line.indexOf("#");
  const body = hash >= 0 ? line.slice(0, hash) : line;
  return {
    value: body.split(":").slice(1).join(":").trim(),
    comment: hash >= 0 ? ` ${line.slice(hash).trim()}` : "",
  };
}

function ensureYamlNumber(
  content: string,
  section: string,
  key: string,
  value: number,
  mode: "minimum" | "exact",
): string {
  const lines = content.split(/\r?\n/);
  const sectionRe = key
    ? new RegExp(`^${section}:\\s*(?:#.*)?$`)
    : new RegExp(`^${section}:\\s*.*$`);
  const sectionIndex = lines.findIndex((line) =>
    sectionRe.test(line.trimEnd()),
  );

  if (sectionIndex === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    if (key) {
      lines.push(`${section}:`, `  ${key}: ${value}`);
    } else {
      lines.push(`${section}: ${value}`);
    }
    return lines.join("\n");
  }

  if (!key) {
    const { value: raw, comment } = splitLineValue(lines[sectionIndex]);
    const current = Number(raw.replace(/^["']|["']$/g, ""));
    if (mode === "minimum" && Number.isFinite(current) && current >= value) {
      return content;
    }
    lines[sectionIndex] = `${section}: ${value}${comment}`;
    return lines.join("\n");
  }

  const sectionIndent = leadingSpaces(lines[sectionIndex]);
  let insertAt = lines.length;
  let keyIndex = -1;
  const keyRe = new RegExp(`^\\s*${key}:`);

  for (let i = sectionIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = leadingSpaces(line);
    if (indent <= sectionIndent && !trimmed.startsWith("#")) {
      insertAt = i;
      break;
    }

    if (indent > sectionIndent && keyRe.test(trimmed)) {
      keyIndex = i;
      break;
    }
  }

  const rendered = `${" ".repeat(sectionIndent + 2)}${key}: ${value}`;
  if (keyIndex === -1) {
    lines.splice(insertAt, 0, rendered);
    return lines.join("\n");
  }

  const { value: raw, comment } = splitLineValue(lines[keyIndex]);
  const current = Number(raw.replace(/^["']|["']$/g, ""));
  if (mode === "minimum" && Number.isFinite(current) && current >= value) {
    return content;
  }

  lines[keyIndex] = `${rendered}${comment}`;
  return lines.join("\n");
}

function ensureLongHaulConfig(profile?: string): boolean {
  let changed = false;
  for (const [key, minimum] of Object.entries(LONG_HAUL_ENV_MINIMUMS)) {
    changed = ensureEnvNumberAtLeast(key, minimum, profile) || changed;
  }
  for (const [key, value] of Object.entries(LONG_HAUL_ENV_EXACT)) {
    changed = ensureEnvExact(key, value, profile) || changed;
  }

  const configPath = join(profileHome(profile), "config.yaml");
  let content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const originalContent = content;
  for (const [section, key, value] of LONG_HAUL_CONFIG_MINIMUMS) {
    content = ensureYamlNumber(content, section, key, value, "minimum");
  }
  for (const [section, key, value] of LONG_HAUL_CONFIG_EXACT) {
    content = ensureYamlNumber(content, section, key, value, "exact");
  }
  if (content !== originalContent || !existsSync(configPath)) {
    safeWriteFile(
      configPath,
      content.endsWith("\n") ? content : `${content}\n`,
    );
    changed = true;
  }
  return changed;
}

// ────────────────────────────────────────────────────
//  API Server health check
// ────────────────────────────────────────────────────

function isApiServerReady(profile?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `${getApiUrl()}/health`;
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        timeout: 1500,
        headers: getApiServerAuthHeader(profile),
      },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// ────────────────────────────────────────────────────
//  Ensure API server is enabled in config
// ────────────────────────────────────────────────────

function ensureApiServerConfig(): void {
  try {
    const configPath = join(HERMES_HOME, "config.yaml");
    if (!existsSync(configPath)) return;
    const content = readFileSync(configPath, "utf-8");
    // If api_server is already configured, skip
    if (/api_server/i.test(content)) return;
    const addition = `
# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: 8642
      host: "127.0.0.1"
`;
    appendFileSync(configPath, addition, "utf-8");
  } catch {
    /* non-fatal */
  }
}

// ────────────────────────────────────────────────────
//  HTTP API streaming (fast path — no process spawn)
// ────────────────────────────────────────────────────

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
  }) => void;
}

function normalizeConversationHistory(
  history?: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  return (history || [])
    .filter(
      (msg) =>
        msg.content &&
        (msg.role === "user" ||
          msg.role === "assistant" ||
          msg.role === "agent"),
    )
    .map((msg) => ({
      role: msg.role === "agent" ? "assistant" : msg.role,
      content: msg.content,
    }));
}

function mapRunsUsage(usage?: HermesRunEvent["usage"]): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  return {
    promptTokens: usage?.input_tokens || 0,
    completionTokens: usage?.output_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
  };
}

function sendMessageViaRunsApi(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  _resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  activeProject?: string | null,
): ChatHandle {
  const mc = getModelConfig(profile);
  const controller = new AbortController();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getApiServerAuthHeader(profile),
  };
  let runId = "";
  let sessionId = _resumeSessionId || "";
  let fullResponse = "";
  let finished = false;

  function finish(error?: string): void {
    if (finished) return;
    finished = true;
    if (error) {
      cb.onError(error);
    } else {
      cb.onDone(sessionId || runId || undefined);
    }
  }

  async function stopRun(): Promise<void> {
    if (!runId) return;
    try {
      await apiJson(
        `/v1/runs/${encodeURIComponent(runId)}/stop`,
        profile,
        "POST",
        {},
      );
    } catch {
      // stopping is best-effort; the abort signal still closes our stream
    }
  }

  async function pollFinalStatus(): Promise<void> {
    if (!runId || finished) return;
    for (let i = 0; i < 90; i += 1) {
      const result = await apiJson<HermesRunStatusPayload>(
        `/v1/runs/${encodeURIComponent(runId)}`,
        profile,
      );
      const status = result.data?.status;
      if (result.data?.session_id) sessionId = result.data.session_id;
      if (status === "completed") {
        const output = result.data?.output || "";
        if (output && output !== fullResponse) {
          const delta = output.startsWith(fullResponse)
            ? output.slice(fullResponse.length)
            : output;
          fullResponse = output;
          cb.onChunk(delta);
        }
        if (result.data?.usage && cb.onUsage) {
          cb.onUsage(mapRunsUsage(result.data.usage));
        }
        finish();
        return;
      }
      if (status === "failed" || status === "cancelled") {
        finish(result.data?.error || `Run ${status}.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    finish("Run timed out before completion.");
  }

  function handleRunEvent(event: HermesRunEvent): void {
    if (!event.event || finished) return;
    if (event.event === "message.delta" && event.delta) {
      fullResponse += event.delta;
      cb.onChunk(event.delta);
      return;
    }
    if (event.event === "tool.started" && cb.onToolProgress) {
      cb.onToolProgress(event.preview || event.tool || "Tool started");
      return;
    }
    if (event.event === "tool.completed" && cb.onToolProgress) {
      cb.onToolProgress(
        event.tool ? `${event.tool} complete` : "Tool complete",
      );
      return;
    }
    if (
      event.event === "reasoning.available" &&
      event.text &&
      cb.onToolProgress
    ) {
      cb.onToolProgress("Reasoning update");
      return;
    }
    if (event.event === "run.completed") {
      if (event.output && event.output !== fullResponse) {
        const delta = event.output.startsWith(fullResponse)
          ? event.output.slice(fullResponse.length)
          : event.output;
        fullResponse = event.output;
        cb.onChunk(delta);
      }
      if (event.usage && cb.onUsage) cb.onUsage(mapRunsUsage(event.usage));
      finish();
      return;
    }
    if (event.event === "run.failed" || event.event === "run.cancelled") {
      finish(event.error || event.event.replace(".", " "));
    }
  }

  async function readEvents(): Promise<void> {
    const eventsUrl = new URL(
      `/v1/runs/${encodeURIComponent(runId)}/events`,
      getApiUrl(),
    );
    const response = await fetch(eventsUrl, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      await pollFinalStatus();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        try {
          handleRunEvent(JSON.parse(dataLine.slice(6)) as HermesRunEvent);
        } catch {
          // malformed event frames are ignored
        }
      }
    }
    if (!finished) await pollFinalStatus();
  }

  void (async () => {
    try {
      const instructions = activeProject
        ? `The user has set the workspace directory to: ${activeProject}. All terminal and file commands should operate in or relative to this directory.`
        : undefined;
      const body = {
        model: mc.model || "hermes-agent",
        input: message,
        session_id: sessionId || undefined,
        instructions,
        conversation_history: normalizeConversationHistory(history),
      };
      const startUrl = new URL("/v1/runs", getApiUrl());
      const response = await fetch(startUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: {
        run_id?: string;
        session_id?: string;
        error?: { message?: string };
      } = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        // keep parsed empty and surface text below
      }
      if (response.status !== 202 || !parsed.run_id) {
        finish(
          parsed.error?.message ||
            `Runs API returned ${response.status}: ${text.slice(0, 200)}`,
        );
        return;
      }
      runId = parsed.run_id;
      if (parsed.session_id) sessionId = parsed.session_id;
      await readEvents();
    } catch (error) {
      if (controller.signal.aborted) {
        await stopRun();
        finish("Run cancelled.");
        return;
      }
      finish(
        error instanceof Error ? error.message : "Runs API request failed.",
      );
    }
  })();

  return {
    abort: () => {
      controller.abort();
      void stopRun();
    },
  };
}

function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  _resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  activeProject?: string | null,
): ChatHandle {
  const mc = getModelConfig(profile);
  const controller = new AbortController();

  // Build full conversation from history + current message (standard OpenAI format)
  const messages: Array<{ role: string; content: string }> = [];

  if (activeProject) {
    messages.push({
      role: "system",
      content: `The user has set the workspace directory to: ${activeProject}. All terminal and file commands should operate in or relative to this directory.`,
    });
  }

  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push({
        role: msg.role === "agent" ? "assistant" : msg.role,
        content: msg.content,
      });
    }
  }
  messages.push({ role: "user", content: message });

  const body = JSON.stringify({
    model: mc.model || "hermes-agent",
    messages,
    stream: true,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getApiServerAuthHeader(profile),
  };

  // Include resume session ID only when the API server is authenticated.
  // Hermes rejects continuation headers on unauthenticated local gateways.
  let sessionId = _resumeSessionId || "";
  if (sessionId && headers.Authorization) {
    headers["X-Hermes-Session-ID"] = sessionId;
  } else if (sessionId) {
    sessionId = "";
  }
  const sentSessionHeader = Boolean(headers["X-Hermes-Session-ID"]);
  let hasContent = false;
  let finished = false; // guard against double callbacks
  let lastError = ""; // capture embedded error messages
  // Tool progress pattern: `emoji tool_name` or `emoji description`
  const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

  function finish(error?: string): void {
    if (finished) return;
    finished = true;
    if (error) {
      cb.onError(error);
    } else {
      cb.onDone(sessionId || undefined);
    }
  }

  function probeRealError(): void {
    // When streaming returns empty, make a non-streaming request to surface the real error
    const probeBody = JSON.stringify({
      model: mc.model || "hermes-agent",
      messages: [{ role: "user", content: message }],
      stream: false,
    });
    const probeUrl = `${getApiUrl()}/v1/chat/completions`;
    const probeMod = probeUrl.startsWith("https") ? https : http;
    const probeReq = probeMod.request(
      probeUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getApiServerAuthHeader(profile),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (d) => {
          raw += d.toString();
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.message?.content || "";
            const errMsg = parsed.error?.message || "";
            finish(
              content ||
                errMsg ||
                "No response received from the model. Check your model configuration and API key.",
            );
          } catch {
            finish(
              "No response received from the model. Check your model configuration and API key.",
            );
          }
        });
      },
    );
    probeReq.on("error", () => {
      finish(
        "No response received from the model. Check your model configuration and API key.",
      );
    });
    probeReq.write(probeBody);
    probeReq.end();
  }

  /** Handle a custom SSE event (non-data lines with `event:` prefix). */
  function processCustomEvent(eventType: string, data: string): void {
    if (eventType === "hermes.tool.progress" && cb.onToolProgress) {
      try {
        const payload = JSON.parse(data);
        const label = payload.label || payload.tool || "";
        const emoji = payload.emoji || "";
        cb.onToolProgress(emoji ? `${emoji} ${label}` : label);
      } catch {
        /* malformed — skip */
      }
    }
  }

  function processSseData(data: string): boolean {
    if (data === "[DONE]") {
      if (hasContent) {
        finish();
      } else if (lastError) {
        finish(lastError);
      } else {
        // Streaming returned empty — probe non-streaming to get the real error
        probeRealError();
      }
      return true; // signals done
    }
    try {
      const parsed = JSON.parse(data);

      // Capture error responses forwarded through SSE
      if (parsed.error) {
        lastError = parsed.error.message || JSON.stringify(parsed.error);
        return false;
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      // Extract usage from final chunk (with optional cost + rate limit info)
      if (parsed.usage && cb.onUsage) {
        cb.onUsage({
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
          cost: parsed.usage.cost,
          rateLimitRemaining: parsed.usage.rate_limit_remaining,
          rateLimitReset: parsed.usage.rate_limit_reset,
        });
      }

      if (delta?.content) {
        const content = delta.content.trim();
        // Legacy: Detect tool progress lines injected into content: `🔍 search_web`
        const match = toolProgressRe.exec(content);
        if (match && cb.onToolProgress) {
          cb.onToolProgress(`${match[1]} ${match[2]}`);
        } else {
          hasContent = true;
          cb.onChunk(delta.content);
        }
      }
    } catch {
      /* malformed chunk — skip */
    }
    return false;
  }

  const chatUrl = `${getApiUrl()}/v1/chat/completions`;
  const requester = chatUrl.startsWith("https") ? https.request : http.request;
  const req = requester(
    chatUrl,
    {
      method: "POST",
      headers,
      signal: controller.signal,
    },
    (res) => {
      const sid = res.headers["x-hermes-session-id"];
      if (sid && typeof sid === "string") sessionId = sid;

      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", (d) => {
          errBody += d.toString();
        });
        res.on("end", () => {
          if (
            sentSessionHeader &&
            (res.statusCode === 401 || res.statusCode === 403) &&
            /session continuation|X-Hermes-Session|API key authentication/i.test(
              errBody,
            )
          ) {
            sendMessageViaApi(
              message,
              cb,
              profile,
              undefined,
              history,
              activeProject,
            );
            return;
          }

          try {
            const err = JSON.parse(errBody);
            finish(err.error?.message || `API error ${res.statusCode}`);
          } catch {
            finish(
              `API server returned ${res.statusCode}: ${errBody.slice(0, 200)}`,
            );
          }
        });
        return;
      }

      let buffer = "";

      /** Parse an SSE block which may contain `event:` and `data:` lines. */
      function processSseBlock(block: string): boolean {
        let eventType = "";
        let dataLine = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }
        if (!dataLine) return false;
        if (eventType) {
          // Custom event (e.g. hermes.tool.progress) — never signals [DONE]
          processCustomEvent(eventType, dataLine);
          return false;
        }
        return processSseData(dataLine);
      }

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (processSseBlock(part)) return;
        }
      });

      res.on("end", () => {
        if (buffer.trim()) {
          for (const part of buffer.split("\n\n")) {
            if (processSseBlock(part)) return;
          }
        }
        // Signal completion — even when no content was received
        if (!hasContent && !lastError) {
          probeRealError();
          return;
        }
        finish(hasContent ? undefined : lastError);
      });

      res.on("error", (err) => finish(`Stream error: ${err.message}`));
    },
  );

  req.on("error", (err) => {
    if (err.name === "AbortError") return;
    finish(`API request failed: ${err.message}`);
  });

  req.write(body);
  req.end();

  return {
    abort: () => {
      controller.abort();
    },
  };
}

// ────────────────────────────────────────────────────
//  CLI fallback (slow path — spawns process)
// ────────────────────────────────────────────────────

const NOISE_PATTERNS = [/^[╭╰│╮╯─┌┐└┘┤├┬┴┼]/, /⚕\s*Hermes/];

function sendMessageViaCli(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  activeProject?: string | null,
): ChatHandle {
  ensureLongHaulConfig(profile);
  const mc = getModelConfig(profile);
  const profileEnv = readEnv(profile);

  const args = [HERMES_SCRIPT];
  if (profile && profile !== "default") {
    args.push("-p", profile);
  }

  let finalMessage = message;
  if (activeProject && !resumeSessionId) {
    // Inject system context as part of the first message
    finalMessage = `[System: The user has set the workspace directory to: ${activeProject}]\n\n${message}`;
  }

  args.push("chat", "-q", finalMessage, "-Q", "--source", "desktop");

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  if (mc.model) {
    args.push("-m", mc.model);
  }

  const env: Record<string, string> = applyLongHaulEnv({
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    PYTHONUNBUFFERED: "1",
  });

  // Inject all API keys from the profile .env so the CLI can access them
  const KNOWN_API_KEYS = [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
    "GLM_API_KEY",
    "KIMI_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_CN_API_KEY",
    "HF_TOKEN",
    "EXA_API_KEY",
    "PARALLEL_API_KEY",
    "TAVILY_API_KEY",
    "FIRECRAWL_API_KEY",
    "FAL_KEY",
    "HONCHO_API_KEY",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "VOICE_TOOLS_OPENAI_KEY",
    "TINKER_API_KEY",
    "WANDB_API_KEY",
  ];
  for (const key of KNOWN_API_KEYS) {
    if (profileEnv[key] && !env[key]) {
      env[key] = profileEnv[key];
    }
  }

  const isCustomEndpoint = LOCAL_PROVIDERS.has(mc.provider);
  if (isCustomEndpoint && mc.baseUrl) {
    env.HERMES_INFERENCE_PROVIDER = "custom";
    env.OPENAI_BASE_URL = mc.baseUrl.replace(/\/+$/, "");

    // Resolve the right API key: check URL-specific key first, then OPENAI_API_KEY
    let resolvedKey = "";
    for (const { pattern, envKey } of URL_KEY_MAP) {
      if (pattern.test(mc.baseUrl)) {
        resolvedKey = profileEnv[envKey] || env[envKey] || "";
        break;
      }
    }
    if (!resolvedKey) {
      resolvedKey = profileEnv.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
    }
    // Local servers (localhost/127.0.0.1) don't need a real key
    if (!resolvedKey && /localhost|127\.0\.0\.1/i.test(mc.baseUrl)) {
      resolvedKey = "no-key-required";
    }
    env.OPENAI_API_KEY = resolvedKey || "no-key-required";

    delete env.OPENROUTER_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_TOKEN;
    delete env.OPENROUTER_BASE_URL;
  }

  const proc = spawn(HERMES_PYTHON, args, {
    cwd: HERMES_REPO,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let hasOutput = false;
  let capturedSessionId = "";
  let outputBuffer = "";

  function processOutput(raw: Buffer): void {
    const text = stripAnsi(raw.toString());
    outputBuffer += text;

    const sidMatch = outputBuffer.match(/session_id:\s*(\S+)/);
    if (sidMatch) capturedSessionId = sidMatch[1];

    const cleaned = text.replace(/session_id:\s*\S+\n?/g, "");
    const lines = cleaned.split("\n");
    const result: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (t && NOISE_PATTERNS.some((p) => p.test(t))) continue;
      result.push(line);
    }

    const output = result.join("\n");
    if (output) {
      hasOutput = true;
      cb.onChunk(output);
    }
  }

  proc.stdout?.on("data", processOutput);

  let stderrBuffer = "";
  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    if (
      !text.trim() ||
      text.includes("UserWarning") ||
      text.includes("FutureWarning")
    ) {
      return;
    }
    // Forward errors visibly to the chat
    if (
      /❌|⚠️|Error|Traceback|error|failed|denied|unauthorized|invalid/i.test(
        text,
      )
    ) {
      hasOutput = true;
      cb.onChunk(text);
    } else {
      // Buffer other stderr for reporting on non-zero exit
      stderrBuffer += text;
    }
  });

  proc.on("close", (code) => {
    if (code === 0 || hasOutput) {
      cb.onDone(capturedSessionId || undefined);
    } else {
      const detail = stderrBuffer.trim();
      cb.onError(
        detail
          ? `Hermes exited with code ${code}: ${detail}`
          : `Hermes exited with code ${code}. Check your model configuration and API key.`,
      );
    }
  });

  proc.on("error", (err) => {
    cb.onError(err.message);
  });

  return {
    abort: () => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 3000);
    },
  };
}

// ────────────────────────────────────────────────────
//  Public API: auto-routes to HTTP API or CLI fallback
// ────────────────────────────────────────────────────

let apiServerAvailable: boolean | null = null; // cached after first check
let runsApiAvailable: boolean | null = null; // cached after first capabilities check

async function isRunsApiReady(profile?: string): Promise<boolean> {
  const result = await apiJson<{ features?: Record<string, boolean> }>(
    "/v1/capabilities",
    profile,
  );
  const features = result.data?.features || {};
  return Boolean(
    result.ok &&
    features.run_submission &&
    features.run_status &&
    features.run_events_sse,
  );
}

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  activeProject?: string | null,
): Promise<ChatHandle> {
  ensureInitialized();
  const longHaulChanged = ensureLongHaulConfig(profile);
  if (!isRemoteMode() && longHaulChanged && isGatewayRunning()) {
    stopGateway(true);
    startGateway(profile);
    apiServerAvailable = false;
  }

  // Remote mode: always use API, no CLI fallback
  if (isRemoteMode()) {
    return sendMessageViaApi(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
      activeProject,
    );
  }

  // Check API server availability (cache the result, re-check periodically)
  if (apiServerAvailable === null || apiServerAvailable === false) {
    apiServerAvailable = await isApiServerReady(profile);
    if (!apiServerAvailable) runsApiAvailable = false;
  }

  if (apiServerAvailable) {
    if (runsApiAvailable === null) {
      runsApiAvailable = await isRunsApiReady(profile);
    }
    if (runsApiAvailable) {
      return sendMessageViaRunsApi(
        message,
        cb,
        profile,
        resumeSessionId,
        history,
        activeProject,
      );
    }
    return sendMessageViaApi(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
      activeProject,
    );
  }

  // Fallback to CLI
  return sendMessageViaCli(
    message,
    cb,
    profile,
    resumeSessionId,
    activeProject,
  );
}

// Lazy init — called on first sendMessage or gateway start
let _initialized = false;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function ensureInitialized(): void {
  if (_initialized) return;
  _initialized = true;
  if (!isRemoteMode()) {
    ensureApiServerConfig();
  }
  startHealthPolling();
}

function startHealthPolling(): void {
  if (_healthCheckInterval) return;
  _healthCheckInterval = setInterval(async () => {
    apiServerAvailable = await isApiServerReady();
    // Stop polling once API is confirmed available — only re-check on demand
    if (apiServerAvailable && _healthCheckInterval) {
      clearInterval(_healthCheckInterval);
      _healthCheckInterval = null;
    }
  }, 15000);
}

export function stopHealthPolling(): void {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

// ────────────────────────────────────────────────────
//  Gateway management
// ────────────────────────────────────────────────────

let gatewayProcess: ChildProcess | null = null;
let gatewayStartedByApp = false;

export function startGateway(profile?: string): boolean {
  ensureInitialized();
  ensureLongHaulConfig(profile);
  if (isGatewayRunning()) return false;

  const apiServerKey = ensureApiServerKey(profile);

  // Build gateway env with profile API keys
  const gatewayEnv: Record<string, string> = applyLongHaulEnv({
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    API_SERVER_ENABLED: "true", // Ensure API server starts with gateway
    API_SERVER_KEY: apiServerKey,
  });

  // Inject ALL profile API keys so the gateway can authenticate with any provider.
  const profileEnv = readEnv(profile);
  const platformEnabled = getPlatformEnabled(profile);
  const disabledPlatformKeys = new Set(
    Object.entries(PLATFORM_ENV_KEYS)
      .filter(([platform]) => !platformEnabled[platform])
      .flatMap(([, keys]) => keys),
  );
  for (const key of disabledPlatformKeys) {
    gatewayEnv[key] = "";
  }
  if (disabledPlatformKeys.size > 0) {
    const shimDir = ensureGatewayEnvShim();
    gatewayEnv.HERMES_DESKTOP_DISABLED_ENV_KEYS =
      Array.from(disabledPlatformKeys).join(",");
    gatewayEnv.PYTHONPATH = gatewayEnv.PYTHONPATH
      ? `${shimDir}:${gatewayEnv.PYTHONPATH}`
      : shimDir;
  }
  for (const [key, value] of Object.entries(profileEnv)) {
    if (disabledPlatformKeys.has(key)) continue;
    if (value) {
      gatewayEnv[key] = value;
    }
  }

  gatewayProcess = spawn(HERMES_PYTHON, [HERMES_SCRIPT, "gateway"], {
    cwd: HERMES_REPO,
    env: gatewayEnv,
    stdio: "ignore",
    detached: true,
  });

  gatewayProcess.unref();

  gatewayProcess.on("close", () => {
    gatewayProcess = null;
    gatewayStartedByApp = false;
    apiServerAvailable = false;
    // Restart health polling to detect if gateway comes back
    startHealthPolling();
  });

  gatewayStartedByApp = true;

  // Wait a bit then check if API server came up
  setTimeout(async () => {
    apiServerAvailable = await isApiServerReady(profile);
  }, 3000);

  return true;
}

function readPidFile(): number | null {
  const pidFile = join(HERMES_HOME, "gateway.pid");
  if (!existsSync(pidFile)) return null;
  try {
    const raw = readFileSync(pidFile, "utf-8").trim();
    // PID file can be JSON ({"pid": 1234, ...}) or plain integer
    const parsed = raw.startsWith("{")
      ? JSON.parse(raw).pid
      : parseInt(raw, 10);
    return typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function stopGateway(force = false): void {
  if (!force && !gatewayStartedByApp) return;

  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill("SIGTERM");
    gatewayProcess = null;
  }
  const pid = readPidFile();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  // Always clear the PID file once we've signalled it. Leaving a stale PID
  // around means the next isGatewayRunning() / stopGateway() call can hit
  // an unrelated process that the OS has since assigned the same PID.
  const pidFile = join(HERMES_HOME, "gateway.pid");
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // best-effort; will be overwritten on next gateway start
    }
  }
  gatewayStartedByApp = false;
  apiServerAvailable = false;
}

export function isGatewayRunning(): boolean {
  if (gatewayProcess && !gatewayProcess.killed) return true;
  const pid = readPidFile();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isApiReady(): boolean {
  return apiServerAvailable === true;
}

export function testRemoteConnection(
  url: string,
  apiKey?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const target = `${url.replace(/\/+$/, "")}/health`;
    const mod = target.startsWith("https") ? https : http;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = mod.request(
      target,
      { method: "GET", timeout: 5000, headers },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

export function restartGateway(profile?: string): void {
  if (!gatewayStartedByApp && !isGatewayRunning()) return;
  stopGateway(true);
  setTimeout(() => {
    startGateway(profile);
  }, 500);
}
