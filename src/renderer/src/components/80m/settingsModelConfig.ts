import type React from "react";
import type { CredentialPool, ModelPreset } from "./settingsTypes";

const NOUS_MODEL_PRESETS: Record<string, ModelPreset> = {
  minimax: {
    id: "nous-minimax",
    name: "MiniMax · Portal",
    provider: "nous",
    model: "minimax/minimax-m2.7",
    baseUrl: "",
  },
  openai: {
    id: "nous-openai",
    name: "OpenAI · Portal",
    provider: "nous",
    model: "openai/gpt-5.5",
    baseUrl: "",
  },
  xai: {
    id: "nous-xai",
    name: "xAI · Portal",
    provider: "nous",
    model: "x-ai/grok-4.20-beta",
    baseUrl: "",
  },
  qwen: {
    id: "nous-qwen",
    name: "Qwen · Portal",
    provider: "nous",
    model: "qwen/qwen3.5-plus-02-15",
    baseUrl: "",
  },
};

export const PROVIDER_CHOICES = [
  "minimax-oauth",
  "minimax",
  "minimax-cn",
  "openai-codex",
  "openai",
  "xai",
  "qwen-oauth",
  "alibaba",
  "nous",
  "openrouter",
  "custom",
];

export function settingsChoiceButtonStyle(
  active: boolean,
): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "8px 16px",
    borderRadius: "8px",
    border: `1px solid ${active ? "#4ade80" : "rgba(229, 255, 237, 0.18)"}`,
    background: active ? "rgba(74, 222, 128, 0.16)" : "rgba(40, 48, 44, 0.92)",
    color: active ? "#4ade80" : "#f4fff7",
    boxShadow: active ? "0 0 0 1px rgba(74, 222, 128, 0.18)" : "none",
    fontFamily: "monospace",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    textTransform: "uppercase",
  };
}

function hasEnv(env: Record<string, string>, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function hasCredential(pool: CredentialPool, provider: string): boolean {
  return (pool[provider] || []).length > 0;
}

export function modelConfigIssue(
  provider: string,
  model: string,
  baseUrl: string,
  env: Record<string, string>,
  pool: CredentialPool,
): string | null {
  if (!model.trim()) return "Choose a model before saving.";
  if (provider === "custom" && !baseUrl.trim()) {
    return "Custom providers need a base URL.";
  }
  if (provider === "minimax" && !hasEnv(env, "MINIMAX_API_KEY")) {
    return "MiniMax API mode needs MINIMAX_API_KEY saved in 80M.";
  }
  if (provider === "minimax-cn" && !hasEnv(env, "MINIMAX_CN_API_KEY")) {
    return "MiniMax CN mode needs MINIMAX_CN_API_KEY saved in 80M.";
  }
  if (provider === "minimax-oauth" && !hasCredential(pool, "minimax-oauth")) {
    return "MiniMax OAuth mode needs a saved MiniMax OAuth credential from hermes model.";
  }
  if (provider === "nous" && !hasCredential(pool, "nous")) {
    return "Portal mode needs a saved credential from the local runtime.";
  }
  if (provider === "openai-codex" && !hasCredential(pool, "openai-codex")) {
    return "OpenAI Codex mode needs a saved Codex OAuth credential from hermes model.";
  }
  if (provider === "alibaba" && !hasEnv(env, "DASHSCOPE_API_KEY")) {
    return "Qwen DashScope mode needs DASHSCOPE_API_KEY saved in 80M.";
  }
  return null;
}

export function buildActiveModelPresets(
  env: Record<string, string>,
  credentialPool: CredentialPool,
): ModelPreset[] {
  const miniMaxPreset =
    hasEnv(env, "MINIMAX_API_KEY") || hasCredential(credentialPool, "minimax")
      ? {
          id: "minimax-api",
          name: "MiniMax · API Key",
          provider: "minimax",
          model: "MiniMax-M2.7",
          baseUrl: "",
        }
      : hasEnv(env, "MINIMAX_CN_API_KEY") ||
          hasCredential(credentialPool, "minimax-cn")
        ? {
            id: "minimax-cn-api",
            name: "MiniMax · CN Key",
            provider: "minimax-cn",
            model: "MiniMax-M2.7",
            baseUrl: "",
          }
        : hasCredential(credentialPool, "minimax-oauth")
          ? {
              id: "minimax-oauth-auth",
              name: "MiniMax · OAuth",
              provider: "minimax-oauth",
              model: "MiniMax-M2.7",
              baseUrl: "https://api.minimax.io/anthropic",
            }
          : NOUS_MODEL_PRESETS.minimax;

  return [
    miniMaxPreset,
    hasCredential(credentialPool, "openai-codex")
      ? {
          id: "openai-codex-auth",
          name: "OpenAI · Codex",
          provider: "openai-codex",
          model: "gpt-5.4",
          baseUrl: "",
        }
      : hasEnv(env, "OPENAI_API_KEY") || hasCredential(credentialPool, "openai")
        ? {
            id: "openai-api",
            name: "OpenAI · API Key",
            provider: "openai",
            model: "gpt-5.4",
            baseUrl: "",
          }
        : NOUS_MODEL_PRESETS.openai,
    hasEnv(env, "XAI_API_KEY") || hasCredential(credentialPool, "xai")
      ? {
          id: "xai-api",
          name: "xAI · API Key",
          provider: "xai",
          model: "grok-4-1-fast-reasoning",
          baseUrl: "",
        }
      : NOUS_MODEL_PRESETS.xai,
    hasCredential(credentialPool, "qwen-oauth")
      ? {
          id: "qwen-oauth-auth",
          name: "Qwen · Portal",
          provider: "qwen-oauth",
          model: "qwen3-coder-plus",
          baseUrl: "",
        }
      : hasEnv(env, "DASHSCOPE_API_KEY") ||
          hasCredential(credentialPool, "alibaba")
        ? {
            id: "qwen-dashscope",
            name: "Qwen · DashScope",
            provider: "alibaba",
            model: "qwen3.5-plus",
            baseUrl: "",
          }
        : NOUS_MODEL_PRESETS.qwen,
  ];
}
