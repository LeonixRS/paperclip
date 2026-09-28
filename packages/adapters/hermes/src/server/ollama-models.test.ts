import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listHermesOllamaModels, toOllamaNativeBaseUrl } from "./ollama-models.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function fakeOllama(models: Record<string, string[]>): Promise<string> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/tags") {
        res.end(JSON.stringify({ models: Object.keys(models).map((name) => ({ name })) }));
        return;
      }
      const name = (JSON.parse(body || "{}") as { model?: string }).model ?? "";
      if (req.url === "/api/show" && name in models) {
        res.end(JSON.stringify({ capabilities: models[name] }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function hermesConfig(yaml: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-config-"));
  cleanup.push(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config.yaml");
  await fs.writeFile(file, yaml, "utf8");
  return file;
}

describe("listHermesOllamaModels", () => {
  it("lists every Ollama model behind Hermes's base_url, tool-capable first", async () => {
    const baseUrl = await fakeOllama({
      "qwen2.5vl:7b": ["completion", "vision"],
      "qwen2.5-coder:7b": ["completion", "tools"],
      "llama3.1:8b": ["completion", "tools"],
    });
    const configPath = await hermesConfig(
      `model:\n  default: qwen2.5-coder:7b\n  provider: custom\n  base_url: ${baseUrl}/v1\n`,
    );
    await expect(listHermesOllamaModels({ configPath })).resolves.toEqual([
      { id: "llama3.1:8b", label: "llama3.1:8b" },
      { id: "qwen2.5-coder:7b", label: "qwen2.5-coder:7b" },
      { id: "qwen2.5vl:7b", label: "qwen2.5vl:7b (no tool support)" },
    ]);
  });

  it("keeps Hermes's default selectable when Ollama does not list it", async () => {
    const baseUrl = await fakeOllama({ "llama3.1:8b": ["tools"] });
    const configPath = await hermesConfig(`model:\n  default: my-alias\n  base_url: ${baseUrl}\n`);
    const models = await listHermesOllamaModels({ configPath });
    expect(models[0]).toEqual({ id: "my-alias", label: "my-alias (Hermes default)" });
  });

  it("returns nothing without a base_url, or when it is not an Ollama server", async () => {
    const noBase = await hermesConfig("model:\n  default: anthropic/claude-sonnet-4\n  provider: anthropic\n");
    await expect(listHermesOllamaModels({ configPath: noBase })).resolves.toEqual([]);
    const unreachable = await hermesConfig("model:\n  default: x\n  base_url: http://127.0.0.1:9/v1\n");
    await expect(listHermesOllamaModels({ configPath: unreachable, timeoutMs: 500 })).resolves.toEqual([]);
    await expect(listHermesOllamaModels({ configPath: "/nonexistent/config.yaml" })).resolves.toEqual([]);
  });

  it("normalizes base URLs", () => {
    expect(toOllamaNativeBaseUrl("localhost:11434/v1/")).toBe("http://localhost:11434");
  });
});
