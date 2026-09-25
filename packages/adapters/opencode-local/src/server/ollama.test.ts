import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkOllamaModelToolSupport,
  parseOllamaModelName,
  resolveOllamaBaseUrl,
  toOllamaNativeBaseUrl,
} from "./ollama.js";
import { testEnvironment } from "./test.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A stand-in Ollama whose /api/show answers from `models`. */
async function fakeOllama(models: Record<string, string[] | undefined>): Promise<string> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const name = (JSON.parse(body || "{}") as { model?: string }).model ?? "";
      if (req.url !== "/api/show" || !(name in models)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `model '${name}' not found` }));
        return;
      }
      const capabilities = models[name];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(capabilities ? { capabilities } : { details: {} }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("ollama helpers", () => {
  it("parses ollama model ids", () => {
    expect(parseOllamaModelName("ollama/qwen2.5-coder:14b")).toBe("qwen2.5-coder:14b");
    expect(parseOllamaModelName("openai/gpt-5.5")).toBeNull();
    expect(parseOllamaModelName("ollama/")).toBeNull();
  });

  it("resolves the native base URL from the injected provider, OLLAMA_HOST, or the default", () => {
    expect(toOllamaNativeBaseUrl("http://gpu:11434/v1/")).toBe("http://gpu:11434");
    expect(
      resolveOllamaBaseUrl({
        PAPERCLIP_OPENCODE_PROVIDERS: JSON.stringify({ ollama: { options: { baseURL: "http://gpu:11434/v1" } } }),
        OLLAMA_HOST: "other:1",
      }),
    ).toBe("http://gpu:11434");
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: "0.0.0.0:11500" })).toBe("http://0.0.0.0:11500");
    expect(resolveOllamaBaseUrl({ PAPERCLIP_OPENCODE_PROVIDERS: "not json" })).toBe("http://localhost:11434");
  });

  it("reports tool support from /api/show", async () => {
    const baseUrl = await fakeOllama({
      "qwen2.5-coder:14b": ["completion", "tools", "insert"],
      "qwen2.5vl:7b": ["completion", "vision"],
      "old:1b": undefined,
    });
    await expect(checkOllamaModelToolSupport({ baseUrl, model: "qwen2.5-coder:14b" })).resolves.toMatchObject({
      status: "supported",
    });
    await expect(checkOllamaModelToolSupport({ baseUrl, model: "qwen2.5vl:7b" })).resolves.toEqual({
      status: "unsupported",
      capabilities: ["completion", "vision"],
    });
    await expect(checkOllamaModelToolSupport({ baseUrl, model: "old:1b" })).resolves.toEqual({ status: "unknown" });
    await expect(checkOllamaModelToolSupport({ baseUrl, model: "missing:1b" })).resolves.toEqual({
      status: "not_found",
    });
  });

  it("reports an unreachable server without throwing", async () => {
    const result = await checkOllamaModelToolSupport({
      baseUrl: "http://127.0.0.1:9",
      model: "any",
      timeoutMs: 1_000,
    });
    expect(result.status).toBe("unreachable");
  });
});

describe("testEnvironment with an Ollama model", () => {
  async function runTest(model: string, baseUrl: string) {
    return testEnvironment({
      companyId: "company-1",
      adapterType: "opencode_local",
      config: {
        // No OpenCode binary is needed: the Ollama check does not depend on it.
        command: "/nonexistent/opencode",
        cwd: process.cwd(),
        model,
        env: {
          PAPERCLIP_OPENCODE_PROVIDERS: JSON.stringify({ ollama: { options: { baseURL: `${baseUrl}/v1` } } }),
        },
      },
    } as Parameters<typeof testEnvironment>[0]);
  }

  it("fails a model that cannot take tool calls", async () => {
    const baseUrl = await fakeOllama({ "deepseek-coder-v2:16b": ["completion", "insert"] });
    const result = await runTest("ollama/deepseek-coder-v2:16b", baseUrl);
    expect(result.status).toBe("fail");
    const check = result.checks.find((entry) => entry.code === "opencode_ollama_model_tools_unsupported");
    expect(check?.level).toBe("error");
    expect(check?.message).toContain("deepseek-coder-v2:16b does not support tool calling");
  });

  it("fails a model Ollama has not pulled, and passes the check for a tool model", async () => {
    const baseUrl = await fakeOllama({ "qwen2.5-coder:14b": ["completion", "tools"] });
    const missing = await runTest("ollama/qwen3:14b", baseUrl);
    expect(missing.checks.find((entry) => entry.code === "opencode_ollama_model_missing")?.hint).toContain(
      "ollama pull qwen3:14b",
    );
    const ok = await runTest("ollama/qwen2.5-coder:14b", baseUrl);
    expect(ok.checks.some((entry) => entry.code === "opencode_ollama_model_tools_supported")).toBe(true);
  });
});
