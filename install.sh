#!/usr/bin/env bash
# install.sh — install the colab-handbook skills (and optionally the colab CLI)
# for the current user, by symlink. Idempotent and safe to re-run.
#
#   ./install.sh          install the skills into ~/.claude/skills/ (user level —
#                         available in every repo you open).
#   ./install.sh --tools  ALSO symlink tools/colab onto your PATH (~/.local/bin/colab).
#   ./install.sh --dry    print what would happen; change nothing.
#
# Safety: a destination that already exists and is NOT a symlink back to us is
# left untouched (skipped with a warning) — so a repo's own richer skill, or a
# hand-made file, is never clobbered.
set -eo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$DIR/skills"
SKILLS_DEST="$HOME/.claude/skills"
TOOL_SRC="$DIR/tools/colab"
TOOL_DEST="$HOME/.local/bin/colab"

WITH_TOOLS=0; DRY=0
for a in "$@"; do
  case "$a" in
    --tools) WITH_TOOLS=1 ;;
    --dry|--dry-run) DRY=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

# link_dir <src> <dest> — idempotent symlink with clobber protection.
link_dir() {
  local src="$1" dest="$2" name; name="$(basename "$dest")"
  if [ -L "$dest" ]; then
    if [ "$(readlink "$dest")" = "$src" ]; then
      echo "  ✓ link-ok: $name"
      return
    fi
    # a symlink to somewhere else — someone chose that target deliberately.
    # Repointing it silently shadows their version (this bit a machine whose
    # user-level skills pointed at a richer local variant). Never touch it.
    echo "  ⚠ skip: $name is a symlink to $(readlink "$dest") (not ours) → left untouched"
    echo "          to adopt the handbook version: rm '$dest' && re-run install.sh"
    return
  fi
  if [ -e "$dest" ]; then
    # a real dir/file we did not create — never clobber it
    echo "  ⚠ skip: $name already exists and is not our symlink → left untouched ($dest)"
    return
  fi
  [ "$DRY" = 1 ] && { echo "  [dry] link: $name → $src"; return; }
  ln -s "$src" "$dest"; echo "  🔗 link: $name → $src"
}

echo "== colab-handbook install ($([ "$DRY" = 1 ] && echo dry-run || echo apply)) =="

# --- skills → ~/.claude/skills/ ---
[ "$DRY" = 1 ] || mkdir -p "$SKILLS_DEST"
echo "skills → $SKILLS_DEST"
for s in "$SKILLS_SRC"/*/; do
  [ -d "$s" ] || continue
  link_dir "${s%/}" "$SKILLS_DEST/$(basename "$s")"
done
echo "  note: a project's own .claude/skills/<name> takes precedence over this"
echo "        user-level install when both exist — this never shadows a repo skill."

# --- optional: colab CLI → ~/.local/bin/ ---
if [ "$WITH_TOOLS" = 1 ]; then
  echo "tools → $TOOL_DEST"
  [ "$DRY" = 1 ] || mkdir -p "$(dirname "$TOOL_DEST")"
  link_dir "$TOOL_SRC" "$TOOL_DEST"
  echo "  (ensure ~/.local/bin is on your PATH; then: colab --help)"
else
  echo "tools: skipped (pass --tools to symlink colab onto your PATH)"
fi

echo "== done =="
