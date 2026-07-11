import { spawn } from "child_process";
import {
  HOST_HOME,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer";
import { buildAgentIdentityInstructions } from "./agent-personas";
import { getModelConfig, readEnv } from "./config";
import { applyLongHaulEnv, ensureLongHaulConfig } from "./hermes-long-haul";
import { stripAnsi } from "./utils";
import type { ChatCallbacks, ChatHandle } from "./hermes-types";

const LOCAL_PROVIDERS = new Set([
  "custom",
  "lmstudio",
  "ollama",
  "vllm",
  "llamacpp",
]);

const URL_KEY_MAP: Array<{ pattern: RegExp; envKey: string }> = [
  { pattern: /openrouter\.ai/i, envKey: "OPENROUTER_API_KEY" },
  { pattern: /anthropic\.com/i, envKey: "ANTHROPIC_API_KEY" },
  { pattern: /openai\.com/i, envKey: "OPENAI_API_KEY" },
  { pattern: /huggingface\.co/i, envKey: "HF_TOKEN" },
];

const NOISE_PATTERNS = [/^[╭╰│╮╯─┌┐└┘┤├┬┴┼]/, /⚕\s*Hermes/];

export function sendMessageViaCli(
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

  const systemLines = [
    buildAgentIdentityInstructions(profile),
    activeProject
      ? `The user has set the workspace directory to: ${activeProject}. All terminal and file commands should operate in or relative to this directory.`
      : "",
  ].filter(Boolean);

  let finalMessage = message;
  if (systemLines.length > 0 && !resumeSessionId) {
    finalMessage = `[System: ${systemLines.join("\n\n")}]\n\n${message}`;
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
    HOME: HOST_HOME,
    HERMES_HOME: HERMES_HOME,
    PYTHONUNBUFFERED: "1",
  });

  const knownApiKeys = [
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
  for (const key of knownApiKeys) {
    if (profileEnv[key] && !env[key]) {
      env[key] = profileEnv[key];
    }
  }

  const isCustomEndpoint = LOCAL_PROVIDERS.has(mc.provider);
  if (isCustomEndpoint && mc.baseUrl) {
    env.HERMES_INFERENCE_PROVIDER = "custom";
    env.OPENAI_BASE_URL = mc.baseUrl.replace(/\/+$/, "");

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
    if (
      /❌|⚠️|Error|Traceback|error|failed|denied|unauthorized|invalid/i.test(
        text,
      )
    ) {
      hasOutput = true;
      cb.onChunk(text);
    } else {
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
          ? `80M runtime exited with code ${code}: ${detail}`
          : `80M runtime exited with code ${code}. Check your model configuration and API key.`,
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
