#!/bin/bash
# Fix "Cannot reconcile Hermes skill … is occupied by another installation".
#
# Paperclip links each of its skills into ~/.hermes/skills/<name>, pointing at
# this checkout's skills/<name>. When another Paperclip install (an older
# clone, a managed release, npx) linked the same names first, or a copy of the
# skill sits there as a plain folder, Hermes agents refuse to start.
#
# For every skill this checkout ships, this script:
#   * leaves ~/.hermes/skills/<name> alone when it already links here,
#   * otherwise moves whatever is there (a link or a folder) into
#     ~/.hermes/skills-backup-<timestamp>/ — nothing is deleted,
#   * and links <name> to this checkout, so the next run starts cleanly.
# Skills with other names (your own Hermes skills) are never touched.
#
# Usage:
#   scripts/fix-hermes-skills.sh            # fix
#   scripts/fix-hermes-skills.sh --dry-run  # only show what would change
#
# Set HERMES_HOME if the agent's Hermes home is not your home directory.

set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  --dry-run|-n) DRY_RUN=1 ;;
  -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "Unknown option: $1 (use --dry-run or --help)" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SKILLS_SOURCE="$REPO_ROOT/skills"
HERMES_SKILLS="${HERMES_HOME:-$HOME}/.hermes/skills"
BACKUP_DIR="${HERMES_HOME:-$HOME}/.hermes/skills-backup-$(date +%Y%m%d-%H%M%S)"

[ -d "$SKILLS_SOURCE" ] || { echo "No skills/ folder in $REPO_ROOT — run this from a Paperclip checkout." >&2; exit 1; }

# The real, fully resolved directory a path leads to, or nothing if it leads nowhere.
real_dir() { (cd -P "$1" 2>/dev/null && pwd -P) || true; }

run() {
  if [ "$DRY_RUN" = 1 ]; then echo "    would run: $*"; else "$@"; fi
}

echo "Paperclip checkout: $REPO_ROOT"
echo "Hermes skills:      $HERMES_SKILLS"
[ "$DRY_RUN" = 1 ] && echo "(dry run — nothing will change)"
echo

run mkdir -p "$HERMES_SKILLS"
fixed=0
kept=0
for source in "$SKILLS_SOURCE"/*/; do
  source="${source%/}"
  [ -f "$source/SKILL.md" ] || continue
  name="$(basename "$source")"
  target="$HERMES_SKILLS/$name"

  if [ -L "$target" ] || [ -e "$target" ]; then
    if [ -L "$target" ] && [ "$(real_dir "$target")" = "$(real_dir "$source")" ]; then
      echo "  ok      $name"
      kept=$((kept + 1))
      continue
    fi
    if [ -L "$target" ]; then
      echo "  moving  $name  (link to $(readlink "$target"))"
    else
      echo "  moving  $name  (a folder, not a Paperclip link)"
    fi
    run mkdir -p "$BACKUP_DIR"
    run mv "$target" "$BACKUP_DIR/$name"
  else
    echo "  adding  $name"
  fi
  run ln -s "$source" "$target"
  fixed=$((fixed + 1))
done

echo
if [ "$fixed" = 0 ]; then
  echo "All $kept Paperclip skills already link to this checkout."
else
  echo "Linked $fixed skill(s) to this checkout ($kept already correct)."
  [ -d "$BACKUP_DIR" ] && echo "Moved the old ones to $BACKUP_DIR (delete it once agents run fine)."
fi

# Another Paperclip install will link the skills back to itself on its next run.
others="$(pgrep -fl 'paperclipai.* run|server/src/index.ts|@paperclipai/server' 2>/dev/null | grep -v "$REPO_ROOT" || true)"
if [ -n "$others" ]; then
  echo
  echo "Warning: another Paperclip may be running and can claim these links again:"
  printf '%s\n' "$others" | while IFS= read -r line; do echo "    $line"; done
  if printf '%s' "$others" | grep -q '/.paperclip/cli/'; then
    echo "That is the published release installed as a service. To run this checkout instead:"
    echo "    scripts/service-from-local.sh      # replaces the service with this folder, same data"
  else
    echo "Stop it (or run 'paperclipai service stop' for the managed service), then re-run this script."
  fi
fi
echo
echo "Now retry the failed run in Paperclip."
