/**
 * Hermes's non-quiet `chat -q` path echoes the prompt through Rich markup and
 * crashes on a stray closing tag such as `[/first-task]` (MarkupError) before
 * the model runs. Such prompts must go through quiet mode, which never echoes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the adapter-utils server-utils module that execute.ts imports from.
// We intercept runChildProcess so we can inspect its opts without spawning
// a real child process.
vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return {
    ...actual,
    runChildProcess: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
    })),
  };
});

// Mock fs and path resolution to avoid real file reads in execute()
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => ""),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false })),
}));

import { execute, promptBreaksHermesQueryEcho } from "./execute.js";
import * as serverUtils from "@paperclipai/adapter-utils/server-utils";


function ctxWithPrompt(promptTemplate: string, extra: Record<string, unknown> = {}) {
  return {
    runId: "test-run-quiet",
    agent: { id: "agent-1", companyId: "company-1", name: "Hermes", adapterType: "hermes_local", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: { command: "/usr/bin/hermes", timeoutSec: 60, graceSec: 5, promptTemplate, ...extra },
    context: { issueId: "issue-1", wakeReason: "manual", paperclipWake: null },
    onLog: vi.fn(async () => undefined),
    onMeta: vi.fn(async () => undefined),
    onSpawn: vi.fn(async () => undefined),
  };
}

function spawnedArgs(): string[] {
  const call = vi.mocked(serverUtils.runChildProcess).mock.calls.at(-1);
  return (call?.[2] ?? []) as string[];
}

describe("Hermes query echo", () => {
  beforeEach(() => vi.mocked(serverUtils.runChildProcess).mockClear());

  it("detects Rich closing tags", () => {
    expect(promptBreaksHermesQueryEcho("Use [first-task] then [/first-task].")).toBe(true);
    expect(promptBreaksHermesQueryEcho("stray [/] here")).toBe(true);
    expect(promptBreaksHermesQueryEcho("A [link](https://x.test/a/b) and [x] only")).toBe(false);
  });

  it("runs quiet when the prompt would break the echo, passing the prompt unchanged", async () => {
    const prompt = "Start the onboarding [first-task] now [/first-task].";
    await execute(ctxWithPrompt(prompt) as never);
    const args = spawnedArgs();
    expect(args).toContain("-Q");
    expect(args[args.indexOf("-q") + 1]).toContain("[/first-task]");
  });

  it("keeps the default non-quiet mode for ordinary prompts", async () => {
    await execute(ctxWithPrompt("Work on the assigned task.") as never);
    expect(spawnedArgs()).not.toContain("-Q");
  });
});
