/**
 * Pre-flight checks for OpenCode agents that run on a local Ollama model.
 *
 * An agent works entirely through tools — reading, editing, running commands —
 * and Ollama refuses tool calls for models that were not built for them
 * ("<model> does not support tools"). Without this check the failure only
 * shows up inside a run, as a failed session. Asking Ollama up front turns it
 * into an environment-test error that names the problem and the fix.
 */

export const OLLAMA_PROVIDER_ID = "ollama";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_SHOW_TIMEOUT_MS = 5_000;

export type OllamaToolSupport =
  | { status: "supported"; capabilities: string[] }
  | { status: "unsupported"; capabilities: string[] }
  /** The server answered but carries no capability list (older Ollama). */
  | { status: "unknown" }
  | { status: "not_found" }
  | { status: "unreachable"; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Ollama model name for an OpenCode `ollama/<name>` model id, else null. */
export function parseOllamaModelName(model: string): string | null {
  const trimmed = model.trim();
  const prefix = `${OLLAMA_PROVIDER_ID}/`;
  if (!trimmed.startsWith(prefix)) return null;
  const name = trimmed.slice(prefix.length).trim();
  return name || null;
}

/** Strip the OpenAI-compatible `/v1` suffix to reach Ollama's native API. */
export function toOllamaNativeBaseUrl(raw: string): string {
  let value = raw.trim() || DEFAULT_OLLAMA_BASE_URL;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/**
 * Where the agent's Ollama lives: the `ollama` provider Paperclip injects via
 * PAPERCLIP_OPENCODE_PROVIDERS, then OLLAMA_HOST, then Ollama's default.
 */
export function resolveOllamaBaseUrl(env: Record<string, string | undefined>): string {
  const providersRaw = env.PAPERCLIP_OPENCODE_PROVIDERS;
  if (providersRaw) {
    try {
      const providers: unknown = JSON.parse(providersRaw);
      const ollama = isPlainObject(providers) ? providers[OLLAMA_PROVIDER_ID] : undefined;
      const options = isPlainObject(ollama) ? ollama.options : undefined;
      const baseURL = isPlainObject(options) ? options.baseURL : undefined;
      if (typeof baseURL === "string" && baseURL.trim()) return toOllamaNativeBaseUrl(baseURL);
    } catch {
      // Malformed provider JSON is reported by the runtime-config step.
    }
  }
  const host = env.OLLAMA_HOST?.trim();
  if (host) return toOllamaNativeBaseUrl(host);
  return DEFAULT_OLLAMA_BASE_URL;
}

/** Ask Ollama whether `model` can take tool calls. Never throws. */
export async function checkOllamaModelToolSupport(input: {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OllamaToolSupport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${toOllamaNativeBaseUrl(input.baseUrl)}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: input.model }),
      signal: AbortSignal.timeout(input.timeoutMs ?? OLLAMA_SHOW_TIMEOUT_MS),
    });
  } catch (err) {
    return { status: "unreachable", error: err instanceof Error ? err.message : String(err) };
  }
  if (response.status === 404) return { status: "not_found" };
  if (!response.ok) {
    return { status: "unreachable", error: `Ollama answered HTTP ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unknown" };
  }
  const capabilities = isPlainObject(body) ? body.capabilities : undefined;
  if (!Array.isArray(capabilities)) return { status: "unknown" };
  const names = capabilities.filter((entry): entry is string => typeof entry === "string");
  return names.includes("tools")
    ? { status: "supported", capabilities: names }
    : { status: "unsupported", capabilities: names };
}
