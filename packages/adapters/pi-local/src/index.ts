export const type = "pi_local";
export const label = "Pi";

export const SANDBOX_INSTALL_COMMAND = "npm install -g @earendil-works/pi-coding-agent@0.74.0";

export const models: Array<{ id: string; label: string }> = [];

/** Every Pi tool: read, create, edit and delete files, and run shell commands. */
export const PI_FULL_ACCESS_TOOLS = "read,bash,edit,write,grep,find,ls";
/** Pi tools that only inspect the workspace. */
export const PI_READ_ONLY_TOOLS = "read,grep,find,ls";

/**
 * The `--tools` value for a run. Unset keeps the full tool set, which is what
 * every existing pi_local agent has always run with.
 */
export function resolvePiTools(value: unknown): string {
  if (typeof value !== "string") return PI_FULL_ACCESS_TOOLS;
  const tools = value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return tools.length > 0 ? Array.from(new Set(tools)).join(",") : PI_FULL_ACCESS_TOOLS;
}

export const agentConfigurationDoc = `# pi_local agent configuration

Adapter: pi_local

Use when:
- You want Paperclip to run Pi (the AI coding agent) locally as the agent runtime
- You want provider/model routing in Pi format (--provider <name> --model <id>)
- You want Pi session resume across heartbeats via --session
- You need Pi's tool set (read, bash, edit, write, grep, find, ls)

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- Pi CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file appended to system prompt via --append-system-prompt
- promptTemplate (string, optional): user prompt template passed via -p flag
- model (string, required): Pi model id in provider/model format (for example xai/grok-4)
- thinking (string, optional): thinking level (off, minimal, low, medium, high, xhigh)
- tools (string, optional): comma-separated Pi tools passed via --tools; defaults to "read,bash,edit,write,grep,find,ls" (full access). Use "read,grep,find,ls" for a read-only agent
- command (string, optional): defaults to "pi"
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Pi supports multiple providers and models. Use \`pi --list-models\` to list available options.
- Paperclip requires an explicit \`model\` value for \`pi_local\` agents.
- Sessions are stored in ~/.pi/paperclips/ and resumed with --session.
- All tools (read, bash, edit, write, grep, find, ls) are enabled by default; narrow them with \`tools\`.
- Agent instructions are appended to Pi's system prompt via --append-system-prompt, while the user task is sent via -p.
`;
