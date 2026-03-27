# Linting, Formatting & CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ESLint, Prettier, a husky pre-commit hook, and a GitHub Actions CI workflow to diagram-docs, mirroring the agent-brain sister repo setup.

**Architecture:** Install tooling dependencies, wire up flat ESLint config + Prettier config, configure husky to auto-format and lint on commit, add a GitHub Actions workflow that typechecks/lints/format-checks/tests on push to main and all PRs.

**Tech Stack:** ESLint 9 (flat config), typescript-eslint, eslint-config-prettier, Prettier, husky 9, GitHub Actions

---

### Task 1: Install dependencies and add scripts

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install new devDependencies**

```bash
npm install --save-dev @eslint/js typescript-eslint eslint-config-prettier prettier husky
```

Expected: packages added to `node_modules/` and `package-lock.json` updated.

- [ ] **Step 2: Add scripts and prepare hook to package.json**

Open `package.json` and update the `"scripts"` object to add three entries:

```json
"format": "prettier --write .",
"format:check": "prettier --check .",
"prepare": "test -z \"$CI\" && husky || true"
```

The full scripts section should look like:

```json
"scripts": {
  "prepare": "test -z \"$CI\" && husky || true",
  "dev": "tsx src/cli/index.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:quality": "vitest run tests/quality/",
  "test:correctness": "vitest run tests/quality/correctness.test.ts",
  "test:drift": "vitest run tests/quality/drift.test.ts",
  "test:tokens": "vitest run tests/quality/token-efficiency.test.ts",
  "bench": "vitest bench",
  "lint": "eslint src/",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc --noEmit"
},
```

- [ ] **Step 3: Initialize husky**

```bash
npm run prepare
```

Expected: `.husky/` directory created with a `_/` subdirectory inside.

- [ ] **Step 4: Verify husky initialized**

```bash
ls .husky/
```

Expected: output includes `_`

---

### Task 2: Create ESLint flat config

**Files:**

- Create: `eslint.config.mjs`

- [ ] **Step 1: Create `eslint.config.mjs`**

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

- [ ] **Step 2: Run lint to verify config loads and reports results**

```bash
npm run lint
```

Expected: exits 0 or reports lint errors (but does NOT crash with "no config found" or similar). If there are errors, that is expected — they'll be fixed in Task 4.

---

### Task 3: Create Prettier config

**Files:**

- Create: `.prettierrc`

- [ ] **Step 1: Create `.prettierrc`**

```json
{
  "trailingComma": "all",
  "tabWidth": 2,
  "useTabs": false
}
```

- [ ] **Step 2: Verify Prettier can read config and check files**

```bash
npm run format:check 2>&1 | head -20
```

Expected: Prettier runs (may report files need formatting — that's fine and will be fixed in Task 4). It should NOT exit with "No parser could be inferred" or config errors.

---

### Task 4: Format and lint-fix existing source code

**Files:**

- Modify: various `src/**/*.ts` files (Prettier + ESLint --fix will modify them)

- [ ] **Step 1: Auto-format all files with Prettier**

```bash
npm run format
```

Expected: Prettier rewrites any files that don't match config. Output lists changed files.

- [ ] **Step 2: Auto-fix ESLint issues**

```bash
npm run lint -- --fix
```

Expected: exits 0 or reports only unfixable errors. If unfixable errors remain, fix them manually one by one. Common ones in TypeScript:

- `@typescript-eslint/no-explicit-any` — replace `any` with a proper type or `unknown`
- `@typescript-eslint/no-unused-vars` — remove unused variables

- [ ] **Step 3: Verify clean state**

```bash
npm run lint && npm run format:check && npm run typecheck
```

Expected: all three exit 0.

- [ ] **Step 4: Run tests to ensure nothing broke**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add eslint, prettier, and format existing code"
```

---

### Task 5: Add husky pre-commit hook

**Files:**

- Create: `.husky/pre-commit`

- [ ] **Step 1: Create `.husky/pre-commit`**

```bash
cat > .husky/pre-commit << 'EOF'
set -e

npm run format
npm run lint -- --fix
git add -u
EOF
chmod +x .husky/pre-commit
```

- [ ] **Step 2: Verify the hook file looks correct**

```bash
cat .husky/pre-commit
```

Expected output:

```
set -e

npm run format
npm run lint -- --fix
git add -u
```

- [ ] **Step 3: Test the hook fires on commit**

Make a trivial whitespace change to any `src/` file, stage it, and commit:

```bash
echo "" >> src/cli/index.ts
git add src/cli/index.ts
git commit -m "test: verify pre-commit hook fires"
```

Expected: hook runs (you'll see Prettier and ESLint output), commit succeeds.

- [ ] **Step 4: Revert the trivial change**

```bash
git revert HEAD --no-edit
```

Expected: revert commit created, file back to original.

---

### Task 6: Create GitHub Actions CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/` directory structure**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm install -g npm@latest
      - run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Tests
        run: npm test
```

- [ ] **Step 3: Validate the YAML is well-formed**

```bash
node -e "require('fs').readFileSync('.github/workflows/ci.yml', 'utf8'); console.log('valid utf8')"
```

Expected: `valid utf8`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .husky/pre-commit
git commit -m "chore: add husky pre-commit hook and GitHub Actions CI workflow"
```

---

## Verification

After all tasks complete, run the full suite locally to confirm what CI will see:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test
```

Expected: all four commands exit 0.
