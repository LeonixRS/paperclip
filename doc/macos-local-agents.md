# Local agents on macOS

This guide covers running Paperclip agents on local models (Ollama through
OpenCode, or Pi) on an Apple silicon Mac, next to Docker and a browser. The
numbers are for an M3 Pro with 18 GB of memory; scale them for other machines.

## Why the machine freezes

Apple silicon has one pool of memory shared by the CPU and the GPU. Everything
below draws from the same 18 GB:

| Consumer | Typical use | With the limits below |
| --- | --- | --- |
| macOS, apps, window server | 3–4 GB | 3–4 GB |
| Ollama model weights | 5 GB (7–8B) to 9 GB (14B), per loaded model | one model: ~5 GB |
| Ollama context (KV) cache | grows with context × parallel requests | 16k tokens, q8: ~1 GB |
| OpenCode/Pi agent runs | 200–400 MB each; 20 per agent by default | 1 per agent |
| Docker Desktop VM | up to half of memory by default | 4 GB |
| Safari | 200 MB–1 GB per busy tab | keep it under ~3 GB |

Without limits, Ollama keeps several models loaded, serves several requests at
once, and each agent can start 20 runs. Once the total passes physical memory,
macOS compresses and swaps until everything stalls.

## 1. Pick a model that fits

Agents work through tools. Pick a model whose `ollama show <model>` lists
`tools` under **Capabilities**. The environment test and onboarding refuse
models without tool support.

| Memory free for the model | Model |
| --- | --- |
| ~6 GB (Docker and Safari open) | `qwen2.5-coder:7b`, `qwen3:8b` |
| ~10 GB (Docker closed) | `qwen2.5-coder:14b`, `qwen3:14b` |

On 18 GB, prefer a 7–8B model with a 16k context. A 14B model only fits when
Docker is stopped.

## 2. Apply the limits

```sh
scripts/macos/tune-local-agents.sh apply      # Ollama + Docker limits, Time Machine exclusion
scripts/macos/tune-local-agents.sh status     # memory pressure, swap, biggest processes, loaded models
scripts/macos/tune-local-agents.sh unload     # free memory now: unload Ollama's models
scripts/macos/tune-local-agents.sh revert     # undo apply
```

`apply` does the following:

- **Ollama:** sets `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`,
  `OLLAMA_KEEP_ALIVE=5m`, `OLLAMA_CONTEXT_LENGTH=16384`,
  `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0`. A LaunchAgent
  (`ai.paperclip.local-agents-env`) sets them at every login, and the script
  restarts the Ollama app. If Ollama starts before the LaunchAgent at login,
  quit and reopen Ollama once. If you run `ollama serve` in a terminal, run
  `set -a; source ~/.config/paperclip/local-agents.env; set +a` before it.
- **Docker Desktop:** limits the VM to 4 GB of memory, 4 CPUs and 1 GB of swap.
  The script backs up the settings, quits Docker, edits the settings and
  restarts Docker. It skips this step with `--skip-docker`. Also consider
  **Settings → Resources → Resource Saver**.
- **Time Machine:** excludes `~/.ollama` (the model files) from backups.

Options: `--context N`, `--docker-memory GB`, `--docker-cpus N`,
`--keep-alive 10m`.

## 3. One run at a time per local agent

Paperclip lets each agent run 20 heartbeats at once by default. Local-model
agents created from onboarding or the new-agent page now start with **Max
concurrent runs = 1**. For older agents, set it in the agent's configuration
under **Run policy**. Several agents still work in parallel, but each one
completes its tasks in turn, and Ollama queues their requests.

## 4. Full Disk Access

Agents with full access edit files anywhere their tasks point them to. Some
folders are privacy-protected, for example Desktop, Documents, Downloads,
iCloud Drive and external disks. For those, macOS needs Full Disk Access. No
script can grant it, because macOS only allows that in System Settings. The
helper script does the rest:

```sh
scripts/macos/grant-full-disk-access.sh          # finds the programs, opens System Settings, reveals them in Finder
scripts/macos/grant-full-disk-access.sh --check  # verifies the grant for this terminal
```

macOS attributes a process to the app that launched it. If you start Paperclip
from Terminal, grant Terminal (or iTerm, VS Code, and so on), and node,
OpenCode and Pi inherit the grant. Grant node and the CLIs as well if Paperclip
starts from a LaunchAgent. Quit and reopen the terminal after the grant.

The script also registers the terminal as a **Developer Tool**. macOS then
skips the Gatekeeper scan for each process the terminal starts. An agent run
starts many short processes, so runs start faster.

## 5. Safari

Safari runs each tab as its own process (`com.apple.WebKit.WebContent`).
`tune-local-agents.sh status` reports their total. Keep few tabs open while
agents run, and close heavy web apps you do not use.
