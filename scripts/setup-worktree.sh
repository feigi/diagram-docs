#!/usr/bin/env bash
# One-shot setup for a freshly created git worktree.
#
# Why: husky v9 stores its hook shims in `.husky/_/`, which is gitignored
# and populated by `npm install` (via the `prepare` script). A new worktree
# has no `node_modules/` and no `.husky/_/`, so `git commit` silently
# bypasses the pre-commit hook (format / lint).
# Run this script before the first commit in any new worktree.
#
# Local-only: the `prepare` script in package.json no-ops when `$CI` is
# set, so this script self-skips under CI — pre-commit hooks are a
# developer-machine concern, not CI's job.
#
# Idempotent: re-running on a populated worktree skips the reinstall.
set -euo pipefail

if [ -n "${CI:-}" ]; then
  echo "[setup-worktree] CI detected — skipping (husky 'prepare' is a no-op under \$CI)"
  exit 0
fi

if ! repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "[setup-worktree] FAIL: not inside a git working tree" >&2
  exit 1
fi
cd "$repo_root"

needs_install=0
if [ ! -d node_modules ]; then
  echo "[setup-worktree] node_modules missing"
  needs_install=1
fi
if [ ! -f .husky/_/pre-commit ]; then
  echo "[setup-worktree] .husky/_/pre-commit missing — pre-commit hook would not run"
  needs_install=1
fi

if [ "$needs_install" -eq 1 ]; then
  echo "[setup-worktree] running 'npm install'..."
  if ! npm install; then
    echo "[setup-worktree] FAIL: npm install failed; pre-commit hook NOT activated" >&2
    exit 1
  fi
fi

if [ ! -f .husky/_/pre-commit ]; then
  echo "[setup-worktree] FAIL: .husky/_/pre-commit still missing after npm install" >&2
  echo "[setup-worktree]       (husky v9 layout expected — check husky version in package.json)" >&2
  exit 1
fi

hooks_path="$(git config --get core.hooksPath || true)"
if [ "$hooks_path" != ".husky/_" ]; then
  echo "[setup-worktree] FAIL: git core.hooksPath is '${hooks_path:-<unset>}', expected '.husky/_'" >&2
  echo "[setup-worktree]       run 'npx husky' to reset, or check your git config" >&2
  exit 1
fi

echo "[setup-worktree] ok — pre-commit hook active"
