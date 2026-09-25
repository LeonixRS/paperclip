import { describe, expect, it } from "vitest";
import {
  buildOllamaOpenCodeProviders,
  isLocalModelSourceReady,
  localModelSourceEnv,
  normalizeOllamaBaseUrl,
  rankLocalModelSuggestions,
  resolveLocalModelId,
} from "./onboarding-local-models";

describe("onboarding local models", () => {
  it("normalizes Ollama addresses to the OpenAI-compatible /v1 base", () => {
    expect(normalizeOllamaBaseUrl("")).toBe("http://localhost:11434/v1");
    expect(normalizeOllamaBaseUrl("localhost:11434")).toBe("http://localhost:11434/v1");
    expect(normalizeOllamaBaseUrl("http://gpu-box:11434/")).toBe("http://gpu-box:11434/v1");
    expect(normalizeOllamaBaseUrl("https://ollama.example/v1/")).toBe("https://ollama.example/v1");
  });

  it("resolves model ids per source", () => {
    expect(resolveLocalModelId("ollama", { model: "", ollamaModel: " qwen2.5-coder:14b " })).toBe(
      "ollama/qwen2.5-coder:14b",
    );
    expect(resolveLocalModelId("ollama", { model: "", ollamaModel: "ollama/llama3.1" })).toBe("ollama/llama3.1");
    expect(resolveLocalModelId("ollama", { model: "", ollamaModel: "" })).toBe("");
    expect(resolveLocalModelId("pi", { model: " ollama/llama3.1 ", ollamaModel: "" })).toBe("ollama/llama3.1");
  });

  it("requires provider/model ids before a local source can hire", () => {
    expect(isLocalModelSourceReady("opencode", { model: "llama3.1", ollamaModel: "" })).toBe(false);
    expect(isLocalModelSourceReady("opencode", { model: "lmstudio/qwen", ollamaModel: "" })).toBe(true);
    expect(isLocalModelSourceReady("ollama", { model: "", ollamaModel: "llama3.1" })).toBe(true);
    expect(isLocalModelSourceReady("ollama", { model: "", ollamaModel: "  " })).toBe(false);
  });

  it("injects an Ollama provider with a tool-calling model for OpenCode", () => {
    expect(buildOllamaOpenCodeProviders("localhost:11434", "llama3.1")).toEqual({
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local)",
        options: { baseURL: "http://localhost:11434/v1" },
        models: { "llama3.1": { name: "llama3.1", tool_call: true } },
      },
    });
    const env = localModelSourceEnv("ollama", { ollamaBaseUrl: "", ollamaModel: "llama3.1" });
    expect(env.PAPERCLIP_OPENCODE_PROVIDERS?.type).toBe("plain");
    expect(JSON.parse(env.PAPERCLIP_OPENCODE_PROVIDERS!.value).ollama.options.baseURL).toBe(
      "http://localhost:11434/v1",
    );
    expect(localModelSourceEnv("pi", { ollamaBaseUrl: "" })).toEqual({});
  });

  it("suggests locally served models first", () => {
    expect(
      rankLocalModelSuggestions(["openai/gpt-5.5", "ollama/llama3.1", "lmstudio/qwen", "openai/gpt-5.5"]),
    ).toEqual(["ollama/llama3.1", "lmstudio/qwen", "openai/gpt-5.5"]);
  });
});
