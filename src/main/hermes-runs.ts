import { execFile } from "child_process";
import { existsSync } from "fs";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
  getHermesVersion,
} from "./installer";
import { apiJson, getApiUrl } from "./hermes-api-client";
import type {
  HermesDesktopCapabilities,
  HermesRunStartResult,
  HermesRunStatusResult,
} from "./hermes-types";
import { stripAnsi } from "./utils";

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
          HOME: HOST_HOME,
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
      reason: "Status output did not include managed tool gateway.",
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
