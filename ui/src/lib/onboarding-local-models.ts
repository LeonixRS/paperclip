/**
 * Local model sources for the onboarding connect step.
 *
 * The connect step's main row offers hosted subscriptions and API keys. These
 * are the sources that run on the operator's own machine instead: a local
 * OpenCode or Pi install using whatever providers it is already configured
 * with, or an Ollama daemon reached through OpenCode.
 *
 * Ollama has no adapter of its own. OpenCode already speaks to any
 * OpenAI-compatible endpoint, and the OpenCode adapter merges extra providers
 * from `PAPERCLIP_OPENCODE_PROVIDERS` into its runtime config (see
 * `prepareOpenCodeRuntimeConfig`), registering the configured model on that
 * provider. So an Ollama agent is an `opencode_local` agent with an `ollama`
 * provider injected and a model id of `ollama/<name>`.
 */

export type LocalModelSourceId = "opencode" | "pi" | "ollama";

export interface LocalModelSource {
  id: LocalModelSourceId;
  label: string;
  /** The adapter the agent is hired on. */
  adapterType: "opencode_local" | "pi_local";
  description: string;
  /** Placeholder for the model field. */
  modelPlaceholder: string;
}

export const LOCAL_MODEL_SOURCES: readonly LocalModelSource[] = [
  {
    id: "ollama",
    label: "Ollama",
    adapterType: "opencode_local",
    description: "Run a model from your local Ollama server (via OpenCode).",
    modelPlaceholder: "llama3.1",
  },
  {
    id: "opencode",
    label: "OpenCode",
    adapterType: "opencode_local",
    description: "Use the providers already configured in your OpenCode install.",
    modelPlaceholder: "provider/model",
  },
  {
    id: "pi",
    label: "Pi",
    adapterType: "pi_local",
    description: "Use the providers already configured in your Pi install.",
    modelPlaceholder: "provider/model",
  },
];

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.1";
export const OLLAMA_PROVIDER_ID = "ollama";
export const OPENCODE_PROVIDERS_ENV_KEY = "PAPERCLIP_OPENCODE_PROVIDERS";

export function getLocalModelSource(id: LocalModelSourceId): LocalModelSource {
  return LOCAL_MODEL_SOURCES.find((source) => source.id === id)!;
}

/**
 * The OpenAI-compatible endpoint for an Ollama server address.
 *
 * Accepts the address the way people usually type it — with or without a
 * scheme, with or without `/v1`, with a trailing slash — and returns the
 * `/v1` base OpenCode's OpenAI-compatible provider expects.
 */
export function normalizeOllamaBaseUrl(raw: string): string {
  let value = raw.trim() || DEFAULT_OLLAMA_BASE_URL;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  value = value.replace(/\/+$/, "");
  if (!/\/v1$/i.test(value)) value = `${value}/v1`;
  return value;
}

/** Ollama model names never carry the provider prefix; strip one if pasted. */
export function normalizeOllamaModelName(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith(`${OLLAMA_PROVIDER_ID}/`)
    ? trimmed.slice(OLLAMA_PROVIDER_ID.length + 1).trim()
    : trimmed;
}

/**
 * The OpenCode `provider` block that points OpenCode at an Ollama server.
 *
 * The model is declared with `tool_call: true` so OpenCode hands it tools at
 * all — a custom model OpenCode knows nothing about otherwise gets none, and
 * an agent without tools cannot read its workspace, let alone work a task.
 * Which tools it may use is decided separately, by the adapter's permission
 * config (see the wizard's full-access switch).
 */
export function buildOllamaOpenCodeProviders(
  baseUrl: string,
  modelName?: string,
): Record<string, unknown> {
  const name = modelName ? normalizeOllamaModelName(modelName) : "";
  return {
    [OLLAMA_PROVIDER_ID]: {
      npm: "@ai-sdk/openai-compatible",
      name: "Ollama (local)",
      options: { baseURL: normalizeOllamaBaseUrl(baseUrl) },
      ...(name ? { models: { [name]: { name, tool_call: true } } } : {}),
    },
  };
}

/** The model id the adapter is configured with for a local source. */
export function resolveLocalModelId(
  source: LocalModelSourceId,
  input: { model: string; ollamaModel: string },
): string {
  if (source === "ollama") {
    const name = normalizeOllamaModelName(input.ollamaModel);
    return name ? `${OLLAMA_PROVIDER_ID}/${name}` : "";
  }
  return input.model.trim();
}

/** OpenCode and Pi both take `provider/model` ids. */
export function isProviderModelId(value: string): boolean {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  return slash > 0 && slash < trimmed.length - 1;
}

/** Whether the local source's fields are complete enough to test and hire. */
export function isLocalModelSourceReady(
  source: LocalModelSourceId,
  input: { model: string; ollamaModel: string },
): boolean {
  return isProviderModelId(resolveLocalModelId(source, input));
}

/**
 * Environment additions for the hired agent's adapter config.
 *
 * Plain bindings: the provider block holds an address, not a credential.
 */
export function localModelSourceEnv(
  source: LocalModelSourceId,
  input: { ollamaBaseUrl: string; ollamaModel?: string },
): Record<string, { type: "plain"; value: string }> {
  if (source !== "ollama") return {};
  return {
    [OPENCODE_PROVIDERS_ENV_KEY]: {
      type: "plain",
      value: JSON.stringify(buildOllamaOpenCodeProviders(input.ollamaBaseUrl, input.ollamaModel)),
    },
  };
}

/**
 * Discovered models worth suggesting first for a local source: ones served by
 * a local runtime (Ollama, LM Studio, llama.cpp…) ahead of hosted ones.
 */
export function rankLocalModelSuggestions(ids: string[], limit = 8): string[] {
  const local = /^(ollama|lmstudio|lm-studio|llama\.?cpp|llamacpp|local|vllm|localai)[/-]/i;
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const preferred = unique.filter((id) => local.test(id));
  const rest = unique.filter((id) => !local.test(id));
  return [...preferred, ...rest].slice(0, limit);
}
