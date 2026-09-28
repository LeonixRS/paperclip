/**
 * List the models a Hermes agent can use when Hermes points at a local Ollama.
 *
 * Hermes keeps a single default model in ~/.hermes/config.yaml, so detection
 * alone offers exactly one choice. When that config's `model.base_url` is an
 * Ollama server, every model Ollama has pulled is equally usable: Hermes sends
 * `-m <name>` to the same OpenAI-compatible endpoint. This asks that server for
 * its models and whether each can take tool calls — an agent works through
 * tools, so models without them are listed last and labelled.
 *
 * Never throws: with no config, no base_url, or a server that is not Ollama,
 * it returns an empty list and the caller falls back to detection.
 */

import type { AdapterModel } from "@paperclipai/adapter-utils";
import { detectModel } from "./detect-model.js";

const OLLAMA_TIMEOUT_MS = 3_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ollama's native API base for an OpenAI-compatible `/v1` URL. */
export function toOllamaNativeBaseUrl(raw: string): string {
  let value = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

async function ollamaToolSupport(
  fetchImpl: typeof fetch,
  baseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<boolean | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const capabilities = isPlainObject(body) ? body.capabilities : undefined;
    if (!Array.isArray(capabilities)) return null;
    return capabilities.includes("tools");
  } catch {
    return null;
  }
}

export async function listHermesOllamaModels(
  input: { configPath?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AdapterModel[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? OLLAMA_TIMEOUT_MS;
  const detected = await detectModel(input.configPath).catch(() => null);
  if (!detected?.baseUrl) return [];
  const baseUrl = toOllamaNativeBaseUrl(detected.baseUrl);

  let names: string[];
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const entries = isPlainObject(body) && Array.isArray(body.models) ? body.models : null;
    // Not an Ollama server: its base_url belongs to some other provider.
    if (!entries) return [];
    names = Array.from(
      new Set(
        entries
          .map((entry) => (isPlainObject(entry) && typeof entry.name === "string" ? entry.name.trim() : ""))
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }

  const options = await Promise.all(
    names.map(async (name) => {
      const tools = await ollamaToolSupport(fetchImpl, baseUrl, name, timeoutMs);
      return {
        id: name,
        label: tools === false ? `${name} (no tool support)` : name,
        rank: tools === true ? 0 : tools === null ? 1 : 2,
      };
    }),
  );
  options.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const models: AdapterModel[] = options.map(({ id, label }) => ({ id, label }));
  // Keep Hermes's own default selectable even if Ollama lists it differently.
  if (detected.model && !models.some((model) => model.id === detected.model)) {
    models.unshift({ id: detected.model, label: `${detected.model} (Hermes default)` });
  }
  return models;
}
