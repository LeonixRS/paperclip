#!/bin/bash
# Prepare macOS Full Disk Access (and Developer Tools) for Paperclip's local agents.
#
# macOS keeps these grants in its privacy database (TCC), which no script can
# write to while System Integrity Protection is on — and it should stay on. What
# a script *can* do is everything around the one switch you flip yourself:
#   * check whether the process that will run Paperclip already has access,
#   * find every program that needs it (the terminal or app that launches
#     Paperclip, node, opencode, pi, ollama),
#   * open System Settings on the right page and reveal each program in Finder
#     so it can be dragged into the list,
#   * register the terminal as a Developer Tool, which skips the per-launch
#     Gatekeeper scan for the many short processes an agent run spawns.
#
# How the grant is inherited: macOS attributes a child process to the app that
# launched it. `pnpm dev` started from Terminal runs node, and node spawns
# opencode/pi — so granting Terminal (or iTerm, VS Code, …) covers them all.
# Grant node and the CLIs too if Paperclip runs from a LaunchAgent or another
# non-terminal launcher.
#
# Usage:
#   scripts/macos/grant-full-disk-access.sh           # check, then walk through granting
#   scripts/macos/grant-full-disk-access.sh --check   # only report; exit 0 if granted
#
# See doc/macos-local-agents.md.

set -u

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS." >&2
  exit 1
fi

MODE="grant"
case "${1:-}" in
  --check) MODE="check" ;;
  -h|--help)
    sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "") ;;
  *)
    echo "Unknown option: $1 (use --check or --help)" >&2
    exit 2
    ;;
esac

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# Reading the user's privacy database itself requires Full Disk Access, so a
# successful read is a direct test of the grant for this process tree.
has_full_disk_access() {
  local db="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
  [ -e "$db" ] && head -c 1 "$db" >/dev/null 2>&1
}

resolve_path() {
  # readlink -f exists on macOS 12.3+; fall back to the unresolved path.
  readlink -f "$1" 2>/dev/null || printf '%s\n' "$1"
}

# The app hosting this shell. It is what macOS asks about for everything the
# shell starts.
terminal_app() {
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal) echo "/System/Applications/Utilities/Terminal.app" ;;
    iTerm.app) echo "/Applications/iTerm.app" ;;
    vscode)
      if [ -d "/Applications/Visual Studio Code.app" ]; then
        echo "/Applications/Visual Studio Code.app"
      elif [ -d "/Applications/Cursor.app" ]; then
        echo "/Applications/Cursor.app"
      fi
      ;;
    WarpTerminal) echo "/Applications/Warp.app" ;;
    ghostty) echo "/Applications/Ghostty.app" ;;
    WezTerm) echo "/Applications/WezTerm.app" ;;
    *) ;;
  esac
}

TARGETS=()
add_target() {
  local path="$1"
  [ -n "$path" ] && [ -e "$path" ] || return 0
  local existing
  for existing in "${TARGETS[@]+"${TARGETS[@]}"}"; do
    [ "$existing" = "$path" ] && return 0
  done
  TARGETS+=("$path")
}

add_target "$(terminal_app)"
for cli in node opencode pi ollama; do
  found="$(command -v "$cli" 2>/dev/null || true)"
  [ -n "$found" ] && add_target "$(resolve_path "$found")"
done
# The OpenCode installer puts the binary here even when it is not on PATH yet.
add_target "$HOME/.opencode/bin/opencode"
add_target "/Applications/Ollama.app"

bold "Full Disk Access for Paperclip local agents"
if has_full_disk_access; then
  ok "This terminal session already has Full Disk Access."
  ok "Paperclip started from here (pnpm dev) passes it to node, opencode and pi."
  if [ "$MODE" = "check" ]; then exit 0; fi
else
  warn "This terminal session does NOT have Full Disk Access."
  if [ "$MODE" = "check" ]; then exit 1; fi
fi

echo
bold "Programs to add under Privacy & Security → Full Disk Access"
if [ "${#TARGETS[@]}" -eq 0 ]; then
  warn "None found. Install OpenCode/Pi/Ollama first, or run this from the terminal you start Paperclip in."
else
  for target in "${TARGETS[@]}"; do
    echo "  • $target"
  done
fi
if [ -z "$(terminal_app)" ]; then
  warn "Could not tell which app hosts this shell (TERM_PROGRAM=${TERM_PROGRAM:-unset}). Add it yourself."
fi

echo
bold "Step 1: grant Full Disk Access"
echo "  System Settings opens on Full Disk Access, and Finder shows each program."
echo "  Click +, or drag each program into the list, then switch it on."
echo "  Programs in hidden folders (like ~/.opencode/bin): press ⌘⇧G in the + dialog and paste the path."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
for target in "${TARGETS[@]+"${TARGETS[@]}"}"; do
  open -R "$target" 2>/dev/null || true
done
if [ "${#TARGETS[@]}" -gt 0 ]; then
  printf '%s\n' "${TARGETS[@]}" | pbcopy 2>/dev/null && echo "  (The paths are on your clipboard too.)"
fi

echo
bold "Step 2: register the terminal as a Developer Tool (recommended)"
echo "  Every agent run starts many short processes. For a Developer Tool, macOS"
echo "  skips the Gatekeeper scan on each launch, which makes runs start faster."
if spctl developer-mode enable-terminal >/dev/null 2>&1; then
  ok "Terminal added to the Developer Tools list."
else
  warn "Could not add it automatically; add your terminal app under Developer Tools."
fi
open "x-apple.systempreferences:com.apple.preference.security?Privacy_DevTools" 2>/dev/null || true
echo "  Switch your terminal on under Privacy & Security → Developer Tools."

echo
bold "Step 3: restart and verify"
echo "  Quit the terminal completely (⌘Q) and reopen it — a running app does not"
echo "  pick up a new grant. Then run:"
echo "    scripts/macos/grant-full-disk-access.sh --check"
echo "  and restart Paperclip (pnpm dev) from that terminal."
