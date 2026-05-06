#!/usr/bin/env bash
# One-shot setup for a freshly created git worktree.
#
# Why: husky v9 stores its hook shims in `.husky/_/`, which is gitignored
# and populated by `npm install` (via the `prepare` script). A new worktree
# has no `node_modules/` and no `.husky/_/`, so `git commit` silently
# bypasses the pre-commit hook (format / lint).
# Run this script before the first commit in any new worktree.
#
# Idempotent: re-running on a populated worktree is a no-op.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

needs_install=0
if [ ! -d node_modules ]; then
  echo "[setup-worktree] node_modules missing"
  needs_install=1
fi
if [ ! -d .husky/_ ]; then
  echo "[setup-worktree] .husky/_/ missing — pre-commit hook would not run"
  needs_install=1
fi

if [ "$needs_install" -eq 1 ]; then
  echo "[setup-worktree] running 'npm install'…"
  npm install
fi

if [ ! -d .husky/_ ]; then
  echo "[setup-worktree] FAIL: .husky/_/ still missing after npm install" >&2
  exit 1
fi

echo "[setup-worktree] ok"
