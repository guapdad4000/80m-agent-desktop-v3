/**
 * Default models seeded on first install.
 *
 * Contributors: add new models here! They'll be available to all users
 * on fresh install. Format:
 *   { name: "Display Name", provider: "provider-key", model: "model-id", baseUrl: "" }
 *
 * Provider keys include: nous, minimax, openai-codex, xai, qwen-oauth,
 * alibaba, openrouter, openai, custom
 */

export interface DefaultModel {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
}

const DEFAULT_MODELS: DefaultModel[] = [
  // ── Recommended Hermes setup paths ───────────────────────────────────
  {
    name: "MiniMax M2.7",
    provider: "nous",
    model: "minimax/minimax-m2.7",
    baseUrl: "",
  },
  {
    name: "OpenAI GPT-5.5",
    provider: "nous",
    model: "openai/gpt-5.5",
    baseUrl: "",
  },
  {
    name: "xAI Grok 4.20 Beta",
    provider: "nous",
    model: "x-ai/grok-4.20-beta",
    baseUrl: "",
  },
  {
    name: "Qwen3.5 Plus",
    provider: "nous",
    model: "qwen/qwen3.5-plus-02-15",
    baseUrl: "",
  },
];

export default DEFAULT_MODELS;
