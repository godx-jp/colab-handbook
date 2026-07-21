#!/bin/sh
# install-hooks.sh — point git at .githooks/ (idempotent; once per clone, per machine).
# core.hooksPath lives in .git/config, so it is machine-local and never synced.
set -e

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "❌ Not a git repo. Run 'git init' first."
  exit 1
}
cd "$repo_root"

chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks

echo "✅ core.hooksPath = .githooks (the gitleaks pre-commit hook is now active)."
