#!/bin/bash
# Keep a Mac responsive while it runs Paperclip's local agents, Ollama, Docker
# and a browser together. Tuned by default for an M3 Pro with 18 GB of memory.
#
# Apple silicon shares one pool of memory between the CPU and the GPU. A local
# model, its context cache, Docker's VM and a browser all draw from it, and
# once they ask for more than exists macOS compresses and swaps until the whole
# machine stalls. This script caps each consumer so the total fits:
#
#   Ollama   one model resident at a time, one request at a time, a bounded
#            context, a quantized KV cache and flash attention; models unload
#            after 5 idle minutes. Applied through a LaunchAgent so the Ollama
#            app picks the settings up at every login.
#   Docker   Docker Desktop's VM capped at 4 GB / 4 CPUs / 1 GB swap.
#   Backups  ~/.ollama (tens of GB of model files) excluded from Time Machine.
#
# Commands:
#   status   memory pressure, swap, the biggest processes, loaded models and
#            the current limits, with advice (default)
#   apply    apply the limits above and restart Ollama (and Docker, if running)
#   unload   free memory now: unload every model Ollama holds
#   revert   undo everything `apply` changed
#
# Options for apply:
#   --context N        Ollama context length in tokens (default 16384)
#   --docker-memory N  Docker VM memory in GB (default 4)
#   --docker-cpus N    Docker VM CPUs (default 4)
#   --keep-alive D     how long an idle model stays loaded (default 5m)
#   --skip-docker      leave Docker Desktop's settings alone
#
# See doc/macos-local-agents.md for the memory budget behind these numbers.

set -u

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS." >&2
  exit 1
fi

COMMAND="${1:-status}"
[ $# -gt 0 ] && shift

CONTEXT_LENGTH=16384
DOCKER_MEMORY_GB=4
DOCKER_CPUS=4
DOCKER_SWAP_MB=1024
KEEP_ALIVE="5m"
SKIP_DOCKER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --context) CONTEXT_LENGTH="$2"; shift 2 ;;
    --docker-memory) DOCKER_MEMORY_GB="$2"; shift 2 ;;
    --docker-cpus) DOCKER_CPUS="$2"; shift 2 ;;
    --keep-alive) KEEP_ALIVE="$2"; shift 2 ;;
    --skip-docker) SKIP_DOCKER=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
for number in "$CONTEXT_LENGTH" "$DOCKER_MEMORY_GB" "$DOCKER_CPUS"; do
  case "$number" in
    ''|*[!0-9]*) echo "Expected a whole number, got: $number" >&2; exit 2 ;;
  esac
done

OLLAMA_URL="${OLLAMA_HOST:-http://localhost:11434}"
case "$OLLAMA_URL" in http://*|https://*) ;; *) OLLAMA_URL="http://$OLLAMA_URL" ;; esac
OLLAMA_URL="${OLLAMA_URL%/}"

LAUNCH_AGENT_LABEL="ai.paperclip.local-agents-env"
LAUNCH_AGENT_PLIST="$HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist"
ENV_FILE="$HOME/.config/paperclip/local-agents.env"
STATE_DIR="$HOME/.config/paperclip/tune-backups"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

# The Ollama settings, as NAME=VALUE lines.
ollama_settings() {
  cat <<EOF
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_NUM_PARALLEL=1
OLLAMA_KEEP_ALIVE=$KEEP_ALIVE
OLLAMA_CONTEXT_LENGTH=$CONTEXT_LENGTH
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
EOF
}
OLLAMA_SETTING_NAMES="OLLAMA_MAX_LOADED_MODELS OLLAMA_NUM_PARALLEL OLLAMA_KEEP_ALIVE OLLAMA_CONTEXT_LENGTH OLLAMA_FLASH_ATTENTION OLLAMA_KV_CACHE_TYPE"

# Evaluate a JavaScript expression over JSON with macOS's own JavaScript
# engine, so nothing extra needs installing. `$1` is the JSON text, `$2` a
# function body that receives it parsed as `data` and returns a string.
json_eval() {
  osascript -l JavaScript -e "function run(argv) { const data = JSON.parse(argv[0] || 'null'); $2 }" "$1" 2>/dev/null
}

ollama_running() { curl -s -m 2 "$OLLAMA_URL/api/version" >/dev/null 2>&1; }

docker_settings_file() {
  local group="$HOME/Library/Group Containers/group.com.docker"
  if [ -f "$group/settings-store.json" ]; then
    echo "$group/settings-store.json"
  elif [ -f "$group/settings.json" ]; then
    echo "$group/settings.json"
  fi
}

mb() { awk -v kb="$1" 'BEGIN { printf "%.0f MB", kb / 1024 }'; }

cmd_status() {
  bold "Memory"
  local total_gb pressure swap
  total_gb="$(sysctl -n hw.memsize | awk '{ printf "%.0f", $1 / 1073741824 }')"
  pressure="$(memory_pressure -Q 2>/dev/null | awk -F': ' '/percentage/ { print $2 }')"
  swap="$(sysctl -n vm.swapusage 2>/dev/null)"
  info "Installed: ${total_gb} GB ($(sysctl -n machdep.cpu.brand_string 2>/dev/null))"
  info "Free (memory_pressure): ${pressure:-unknown}"
  info "Swap: ${swap:-unknown}"
  local free_pct="${pressure%%%}"
  if [ -n "$free_pct" ] && [ "$free_pct" -lt 20 ] 2>/dev/null; then
    warn "Memory is under pressure — this is what freezes the machine. Run: $0 unload"
  fi

  echo
  bold "Largest processes"
  ps -axo rss=,comm= | sort -rn | head -12 | while read -r rss comm; do
    printf '    %8s  %s\n' "$(mb "$rss")" "$(basename "$comm")"
  done
  local safari_kb
  safari_kb="$(ps -axo rss=,comm= | awk '/Safari|com.apple.WebKit.WebContent/ { sum += $1 } END { print sum + 0 }')"
  info "Safari and its tabs in total: $(mb "$safari_kb")"
  if [ "$safari_kb" -gt 3145728 ]; then
    warn "Safari is using over 3 GB. Close tabs you are not using; each tab is its own process."
  fi

  echo
  bold "Agent runs"
  local runs
  runs="$(pgrep -f 'opencode run|pi-coding-agent| pi .*--mode json' 2>/dev/null | wc -l | tr -d ' ')"
  info "OpenCode/Pi agent processes running now: $runs"
  if [ "$runs" -gt 2 ]; then
    warn "Several agent runs share one model. Set each local agent's \"Max concurrent runs\" to 1."
  fi

  echo
  bold "Ollama ($OLLAMA_URL)"
  if ollama_running; then
    local ps_json
    ps_json="$(curl -s -m 5 "$OLLAMA_URL/api/ps")"
    json_eval "$ps_json" '
      const models = (data && data.models) || [];
      if (!models.length) return "    No model loaded.";
      return models.map(m => "    Loaded: " + m.name + " — " + (m.size_vram / 1073741824).toFixed(1) + " GB, context " + (m.context_length || "?")).join("\n");
    '
  else
    warn "Ollama is not running."
  fi
  local name value
  for name in $OLLAMA_SETTING_NAMES; do
    value="$(launchctl getenv "$name" 2>/dev/null)"
    info "$name=${value:-(default)}"
  done
  if [ ! -f "$LAUNCH_AGENT_PLIST" ]; then
    warn "Ollama limits are not applied. Run: $0 apply"
  fi

  echo
  bold "Docker Desktop"
  local settings
  settings="$(docker_settings_file)"
  if [ -n "$settings" ]; then
    json_eval "$(cat "$settings")" '
      const mem = data.MemoryMiB ?? data.memoryMiB, cpus = data.Cpus ?? data.cpus, swap = data.SwapMiB ?? data.swapMiB;
      return "    VM memory " + (mem / 1024).toFixed(1) + " GB, " + cpus + " CPUs, swap " + swap + " MB";
    '
  else
    info "Docker Desktop settings not found (not installed, or never started)."
  fi
}

write_launch_agent() {
  mkdir -p "$(dirname "$LAUNCH_AGENT_PLIST")"
  local script="" line
  while IFS= read -r line; do
    script="$script/bin/launchctl setenv ${line%%=*} ${line#*=}; "
  done <<EOF
$(ollama_settings)
EOF
  cat >"$LAUNCH_AGENT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$script</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF
  plutil -lint "$LAUNCH_AGENT_PLIST" >/dev/null
}

restart_ollama() {
  if pgrep -x Ollama >/dev/null 2>&1; then
    osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
    sleep 3
    open -a Ollama && ok "Restarted the Ollama app with the new limits."
  elif command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q '^ollama .*started'; then
    brew services restart ollama >/dev/null && ok "Restarted the Homebrew Ollama service."
  elif pgrep -x ollama >/dev/null 2>&1; then
    warn "Ollama is running from a terminal (ollama serve). Stop it and start it again after:"
    info "set -a; source $ENV_FILE; set +a; ollama serve"
  else
    info "Ollama is not running; it will use the limits when it starts."
  fi
}

apply_docker() {
  local settings
  settings="$(docker_settings_file)"
  if [ -z "$settings" ]; then
    info "Docker Desktop settings not found; skipping."
    return
  fi
  mkdir -p "$STATE_DIR"
  [ -f "$STATE_DIR/docker-settings.json" ] || cp "$settings" "$STATE_DIR/docker-settings.json"
  local was_running=0
  if pgrep -x "Docker Desktop" >/dev/null 2>&1 || pgrep -x Docker >/dev/null 2>&1; then
    was_running=1
    osascript -e 'quit app "Docker"' >/dev/null 2>&1 || osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
    sleep 5
  fi
  local updated
  updated="$(json_eval "$(cat "$settings")" "
    const set = (modern, legacy, value) => {
      if (modern in data || !(legacy in data)) data[modern] = value; else data[legacy] = value;
    };
    set('MemoryMiB', 'memoryMiB', $((DOCKER_MEMORY_GB * 1024)));
    set('Cpus', 'cpus', $DOCKER_CPUS);
    set('SwapMiB', 'swapMiB', $DOCKER_SWAP_MB);
    return JSON.stringify(data, null, 2);
  ")"
  if [ -z "$updated" ]; then
    warn "Could not update Docker's settings; left them unchanged."
  else
    printf '%s\n' "$updated" >"$settings"
    ok "Docker VM limited to ${DOCKER_MEMORY_GB} GB, ${DOCKER_CPUS} CPUs, ${DOCKER_SWAP_MB} MB swap."
  fi
  if [ "$was_running" = 1 ]; then
    open -a Docker && ok "Restarted Docker Desktop."
  fi
  info "Also consider Docker Desktop → Settings → Resources → Resource Saver (pauses the VM when idle)."
}

cmd_apply() {
  bold "Ollama limits"
  mkdir -p "$(dirname "$ENV_FILE")"
  ollama_settings >"$ENV_FILE"
  local line
  while IFS= read -r line; do
    launchctl setenv "${line%%=*}" "${line#*=}"
  done <"$ENV_FILE"
  write_launch_agent
  launchctl unload "$LAUNCH_AGENT_PLIST" >/dev/null 2>&1 || true
  launchctl load "$LAUNCH_AGENT_PLIST" >/dev/null 2>&1 || true
  ok "Set for this login and every future one (LaunchAgent $LAUNCH_AGENT_LABEL):"
  sed 's/^/      /' "$ENV_FILE"
  restart_ollama

  echo
  bold "Docker Desktop"
  if [ "$SKIP_DOCKER" = 1 ]; then info "Skipped (--skip-docker)."; else apply_docker; fi

  echo
  bold "Backups"
  if [ -d "$HOME/.ollama" ] && tmutil addexclusion "$HOME/.ollama" 2>/dev/null; then
    ok "Excluded ~/.ollama (model files) from Time Machine."
  else
    info "Nothing to exclude."
  fi

  echo
  bold "Next"
  info "Use a model that fits beside Docker and Safari: qwen2.5-coder:7b or qwen3:8b (about 5 GB)."
  info "Give each local agent \"Max concurrent runs\" = 1 (new local agents get this automatically)."
  info "Check the result any time with: $0 status"
}

cmd_unload() {
  if ! ollama_running; then
    warn "Ollama is not running; nothing to unload."
    return
  fi
  local names name
  names="$(json_eval "$(curl -s -m 5 "$OLLAMA_URL/api/ps")" 'return ((data && data.models) || []).map(m => m.name).join("\n");')"
  if [ -z "$names" ]; then
    ok "No model is loaded."
    return
  fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    curl -s -m 30 "$OLLAMA_URL/api/generate" -d "{\"model\": \"$name\", \"keep_alive\": 0}" >/dev/null \
      && ok "Unloaded $name"
  done <<EOF
$names
EOF
}

cmd_revert() {
  bold "Reverting"
  launchctl unload "$LAUNCH_AGENT_PLIST" >/dev/null 2>&1 || true
  rm -f "$LAUNCH_AGENT_PLIST" "$ENV_FILE"
  local name
  for name in $OLLAMA_SETTING_NAMES; do launchctl unsetenv "$name" 2>/dev/null || true; done
  ok "Removed the Ollama limits."
  restart_ollama
  local settings
  settings="$(docker_settings_file)"
  if [ -n "$settings" ] && [ -f "$STATE_DIR/docker-settings.json" ]; then
    cp "$STATE_DIR/docker-settings.json" "$settings" && rm -f "$STATE_DIR/docker-settings.json"
    ok "Restored Docker Desktop's previous settings (restart Docker to use them)."
  fi
  if [ -d "$HOME/.ollama" ]; then
    tmutil removeexclusion "$HOME/.ollama" 2>/dev/null && ok "Time Machine backs up ~/.ollama again."
  fi
}

case "$COMMAND" in
  status) cmd_status ;;
  apply) cmd_apply ;;
  unload) cmd_unload ;;
  revert) cmd_revert ;;
  -h|--help|help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "Unknown command: $COMMAND (status, apply, unload, revert)" >&2; exit 2 ;;
esac
