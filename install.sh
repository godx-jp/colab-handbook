#!/usr/bin/env bash
# install.sh — set up this machine to use the colab-handbook: skills, the colab
# CLI, the pre-commit hook, and the fleet list. All by symlink or copy.
# Idempotent and safe to re-run.
#
#   ./install.sh          install the skills into ~/.claude/skills/ (user level —
#                         available in every repo you open).
#   ./install.sh --tools  ALSO symlink tools/colab onto your PATH (~/.local/bin/colab).
#   ./install.sh --hooks  ALSO enable this clone's gitleaks pre-commit hook
#                         (runs scripts/install-hooks.sh; per-machine, not synced).
#   ./install.sh --fleet  ALSO seed ~/.colab/repos.txt from audit/repos.txt —
#                         only when absent; an existing fleet list is never touched.
#   ./install.sh --all    = --tools --hooks --fleet (the recommended first run).
#   ./install.sh --dry    print what would happen; change nothing. Combines with
#                         any of the above.
#
# A preflight runs on every invocation. It only reports (✓ / ⚠) and never aborts:
# a tool you have not installed must not block the parts that do not need it.
#
# Safety: a destination that already exists and is NOT a symlink back to us is
# left untouched (skipped with a warning) — so a repo's own richer skill, or a
# hand-made file, is never clobbered.
#
# KNOW WHAT A SYMLINK INSTALL MEANS: every link points into THIS WORKING TREE, not
# at a copied snapshot. Checking this repo out onto a branch therefore changes the
# skills — and, with --tools, the CLI — for every session on the machine, instantly
# and invisibly. That is the point (edit and it is live) and the hazard (a half-
# finished branch left checked out is a half-finished toolchain for everyone). Work
# on this repo in a WORKTREE and leave the main checkout on trunk, which is what the
# handbook asks of every other repo for the same reason.
set -eo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$DIR/skills"
SKILLS_DEST="$HOME/.claude/skills"
TOOL_SRC="$DIR/tools/colab"
TOOL_DEST="$HOME/.local/bin/colab"
COLAB_DIR="${COLAB_HOME:-$HOME/.colab}"
FLEET_SRC="$DIR/audit/repos.txt"
FLEET_DEST="$COLAB_DIR/repos.txt"

WITH_TOOLS=0; WITH_HOOKS=0; WITH_FLEET=0; DRY=0
for a in "$@"; do
  case "$a" in
    --tools) WITH_TOOLS=1 ;;
    --hooks) WITH_HOOKS=1 ;;
    --fleet) WITH_FLEET=1 ;;
    --all)   WITH_TOOLS=1; WITH_HOOKS=1; WITH_FLEET=1 ;;
    --dry|--dry-run) DRY=1 ;;
    # Print the header block itself: every comment line after the shebang, up to the
    # first line of code. A hardcoded line range silently truncates the moment the
    # header grows — and it grows exactly when someone documents something new,
    # which is the paragraph you would least want --help to drop.
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }

WARNED=0
warn() { echo "  ⚠ $1"; WARNED=1; }

# ---------------------------------------------------------------- preflight --
# Reports only. Nothing here mutates anything, and nothing here exits non-zero:
# "gitleaks is missing" is a fact about a machine that may not want --hooks, not
# a failure of the run the user actually asked for.
preflight() {
  echo "preflight (checks only — nothing is changed here)"

  if have git; then
    echo "  ✓ git      $(git --version 2>/dev/null | awk '{print $3}')"
  else
    warn "git      not found — required. Install it first (macOS: xcode-select --install)."
  fi

  if have node; then
    node_v="$(node -v 2>/dev/null)"            # v22.14.0
    node_major="${node_v#v}"; node_major="${node_major%%.*}"
    echo "  ✓ node     $node_v"

    # .nvmrc is the version this repo's own CI uses; a mismatch is usually
    # harmless for the CLI (zero dependencies) but is worth knowing about.
    if [ -f "$DIR/.nvmrc" ]; then
      pinned="$(tr -d ' \t\r\n' < "$DIR/.nvmrc")"; pinned="${pinned#v}"
      if [ -n "$pinned" ] && [ "$node_major" != "${pinned%%.*}" ]; then
        warn "node major $node_major differs from .nvmrc ($pinned) — fine for the CLI,"
        echo "            but CI here runs $pinned. 'nvm use' in this clone if you hack on it."
      fi
    fi

    # engines is the real floor: below it, the CLI is not supported at all.
    engines_min="$(sed -n 's/.*"node"[[:space:]]*:[[:space:]]*">=\([0-9][0-9]*\).*/\1/p' \
      "$DIR/tools/package.json" 2>/dev/null | head -1)"
    if [ -n "$engines_min" ] && [ "$node_major" -lt "$engines_min" ] 2>/dev/null; then
      warn "node $node_v is below the colab CLI's floor (engines: >=$engines_min) — it may not run."
    fi
  else
    warn "node     not found — required by the colab CLI and the audit tool."
  fi

  if have gh; then
    if gh auth status >/dev/null 2>&1; then
      echo "  ✓ gh       authenticated"
    else
      warn "gh       installed but NOT authenticated — run: gh auth login"
      echo "            Claims, the skills and the audit's remote targets all need it,"
      echo "            and without it they fail much later, with a confusing error."
    fi
  else
    warn "gh       not found — needed to claim issues and to audit remote repos."
    echo "            Install it, then: gh auth login"
  fi

  if have gitleaks; then
    echo "  ✓ gitleaks $(gitleaks version 2>/dev/null | head -1)"
  else
    echo "  ⚠ gitleaks not found — optional, only used by --hooks. Without it the"
    echo "            pre-commit hook installs but skips the scan (macOS: brew install gitleaks)."
  fi

  # The skills are symlinks INTO this working tree, so this clone is permanent
  # infrastructure: delete it and every session on the machine loses its skills.
  case "$DIR/" in
    /tmp/*|/private/tmp/*|/var/folders/*|"$HOME"/Downloads/*|"$HOME"/Desktop/*)
      warn "clone location looks temporary: $DIR"
      echo "            install.sh symlinks the skills INTO this working tree, so the"
      echo "            clone is permanent — move it somewhere you keep code, then re-run."
      ;;
    *)
      echo "  ✓ location $DIR"
      ;;
  esac
  echo
}

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

preflight

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
  # Printing "make sure it is on your PATH" unconditionally taught people to
  # ignore the line. Check, and only speak up when there is something to do.
  case ":$PATH:" in
    *":$HOME/.local/bin:"*)
      echo "  ✓ ~/.local/bin is on your PATH"
      ;;
    *)
      case "$(basename "${SHELL:-}")" in
        fish) rc="$HOME/.config/fish/config.fish"
              line='fish_add_path "$HOME/.local/bin"' ;;
        bash) rc="$HOME/.bashrc"
              line='export PATH="$HOME/.local/bin:$PATH"' ;;
        *)    rc="$HOME/.zshrc"
              line='export PATH="$HOME/.local/bin:$PATH"' ;;
      esac
      warn "~/.local/bin is NOT on your PATH — 'colab' will not resolve until it is."
      echo "            Add this to $rc, then open a new shell:"
      echo
      echo "              $line"
      echo
      ;;
  esac
else
  echo "tools: skipped (pass --tools to symlink colab onto your PATH)"
fi

# --- optional: git hooks in THIS clone ---
if [ "$WITH_HOOKS" = 1 ]; then
  echo "hooks → $DIR/.githooks"
  if [ "$DRY" = 1 ]; then
    echo "  [dry] run: scripts/install-hooks.sh (git config core.hooksPath .githooks)"
  elif [ -x "$DIR/scripts/install-hooks.sh" ] || [ -f "$DIR/scripts/install-hooks.sh" ]; then
    ( cd "$DIR" && sh scripts/install-hooks.sh 2>&1 | sed 's/^/  /' ) || \
      warn "install-hooks.sh failed — see above; nothing else was affected."
  else
    warn "scripts/install-hooks.sh not found — skipped."
  fi
  echo "  note: core.hooksPath lives in .git/config, so this is per-clone and"
  echo "        per-machine. Every clone you make needs it again."
else
  echo "hooks: skipped (pass --hooks to enable the gitleaks pre-commit hook here)"
fi

# --- optional: fleet list → ~/.colab/repos.txt ---
if [ "$WITH_FLEET" = 1 ]; then
  echo "fleet → $FLEET_DEST"
  if [ -e "$FLEET_DEST" ]; then
    # Your fleet list is hand-maintained and machine-local. Overwriting it with
    # the committed example would silently drop every repo you added.
    echo "  ✓ exists already → left untouched (never overwritten)"
  elif [ "$DRY" = 1 ]; then
    echo "  [dry] mkdir -p $COLAB_DIR"
    echo "  [dry] seed:  $FLEET_SRC → $FLEET_DEST"
  else
    mkdir -p "$COLAB_DIR"
    cp "$FLEET_SRC" "$FLEET_DEST"
    echo "  📄 seeded from audit/repos.txt (example entries — replace them)"
  fi
  echo "  edit it: $FLEET_DEST"
  echo "  one line per repo: an absolute path, or owner/name for a remote-only audit."
else
  echo "fleet: skipped (pass --fleet to seed the audit's machine-local repo list)"
fi

# ----------------------------------------------------------------- verify ---
echo
echo "verify"
if [ "$DRY" = 1 ]; then
  echo "  [dry] nothing was changed, so there is nothing to verify."
else
  probe="$(ls "$SKILLS_SRC" 2>/dev/null | head -1)"
  if [ -n "$probe" ] && [ -e "$SKILLS_DEST/$probe" ]; then
    echo "  ✓ skill '$probe' resolves at $SKILLS_DEST/$probe"
  else
    warn "no skill resolved under $SKILLS_DEST — see the skips above."
  fi
  if [ "$WITH_TOOLS" = 1 ]; then
    if have colab; then
      echo "  ✓ colab resolves at $(command -v colab)"
    elif [ -e "$TOOL_DEST" ]; then
      warn "colab is installed at $TOOL_DEST but not on your PATH yet (see above)."
    fi
  fi
fi

echo
echo "next"
echo "  colab --help                    # what the CLI can do (needs --tools)"
echo "  node audit/audit.mjs            # conformance report for your fleet"
echo "  open CONVENTIONS.md             # the rules — ~15 minutes, the only normative file"
[ "$WARNED" = 1 ] && echo
[ "$WARNED" = 1 ] && echo "  (some checks warned above — the install still ran; fix them when convenient)"

echo "== done =="
