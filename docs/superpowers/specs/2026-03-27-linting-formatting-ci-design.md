# Linting, Formatting & CI Design

**Date:** 2026-03-27
**Status:** Approved

## Overview

Add ESLint, Prettier, a husky pre-commit hook, and a GitHub Actions CI workflow to diagram-docs — mirroring the setup used in the sister repo agent-brain for consistency.

## New Dependencies

devDependencies to add:

- `@eslint/js` — ESLint core JS rules
- `typescript-eslint` — TypeScript-aware lint rules
- `eslint-config-prettier` — disables ESLint rules that conflict with Prettier
- `prettier` — code formatter
- `husky` — git hook manager

## Files to Create

### `eslint.config.mjs`

Flat config using ESLint 9 format:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  { ignores: ["node_modules/", "dist/", ".worktrees/"] },
);
```

### `.prettierrc`

```json
{
  "trailingComma": "all",
  "tabWidth": 2,
  "useTabs": false
}
```

### `.husky/pre-commit`

```sh
set -e

npm run format
npm run lint -- --fix
git add -u
```

### `.github/workflows/ci.yml`

Triggers: push to `main` and all pull requests.

Steps:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` — Node 22, npm cache
3. `npm install -g npm@latest`
4. `npm ci`
5. Typecheck: `npm run typecheck`
6. Lint: `npm run lint`
7. Format check: `npm run format:check`
8. Tests: `npm test`

## `package.json` Changes

Add scripts:

- `"format": "prettier --write ."`
- `"format:check": "prettier --check ."`
- `"prepare": "test -z \"$CI\" && husky || true"`

## Decisions

- **No lint-staged**: repo is small enough that formatting the whole project on commit is fast and simpler
- **Mirrors agent-brain**: deliberate consistency choice across the two repos
- **Node 22 in CI**: matches agent-brain and satisfies the `engines.node >= 20` constraint
