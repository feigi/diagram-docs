# Per-Submodule `diagram-docs.yaml` Stub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During `generate`, scaffold a fully-commented `diagram-docs.yaml` at each submodule root (`{appPath}/diagram-docs.yaml`), giving users a discoverable entry point for per-app overrides via the existing cascading-config resolver.

**Architecture:** All changes live in `src/generator/d2/submodule-scaffold.ts`. A new helper `buildSubmoduleConfigStub()` reuses `buildDefaultConfig()` from the config loader to generate the stub body, keeping the key set in lockstep with `init`. The stub is written inside the existing `generateSubmoduleDocs` loop, gated on `config.levels.component` and a file-exists guard so it's create-once and never overwrites user edits.

**Tech Stack:** TypeScript (ES modules, Node16 resolution), vitest for tests, `yaml` package for serialization. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-14-per-submodule-config-stub-design.md`

---

## File Structure

**Modify:**

- `src/generator/d2/submodule-scaffold.ts` — add `buildSubmoduleConfigStub()` helper; call it inside the `generateSubmoduleDocs` per-container loop.
- `tests/integration/submodule.test.ts` — extend with new test cases for stub scaffolding, create-once semantics, `override.exclude` skip, and `levels.component = false` skip.

**No new files.** All logic fits in the existing scaffold module.

---

## Task 1: Stub scaffolding — core TDD cycle

**Files:**

- Modify: `tests/integration/submodule.test.ts` (append new test)
- Modify: `src/generator/d2/submodule-scaffold.ts`

### Step 1: Add the failing test

Append this test to the existing `describe("Integration: Submodule per-folder docs", ...)` block in `tests/integration/submodule.test.ts`. It exercises the new behavior end-to-end using the existing `model.yaml` fixture and a throwaway `tmpRoot`.

Add this import at the top if not already present:

```typescript
import { parse as parseYaml } from "yaml";
```

Then add the test at the bottom of the `describe` block (before the closing brace):

```typescript
it("scaffolds a commented-out diagram-docs.yaml at each submodule root", () => {
  const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
  const model = loadModel(MODEL_PATH);

  const tmpRoot = path.join(MONOREPO, "test-submodule-stub");
  trackDir(tmpRoot);

  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { context: true, container: true, component: true },
  });

  const subResults = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);
  expect(subResults.length).toBeGreaterThan(0);

  for (const sub of subResults) {
    const stubPath = path.join(
      tmpRoot,
      sub.applicationPath,
      "diagram-docs.yaml",
    );
    expect(fs.existsSync(stubPath)).toBe(true);

    const content = fs.readFileSync(stubPath, "utf-8");

    // Header references the humanized submodule name
    const expectedName = sub.applicationPath
      .split("/")
      .pop()!
      .replace(/[-_]/g, " ")
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    expect(content).toMatch(
      new RegExp(`^# diagram-docs\\.yaml for ${expectedName}`),
    );

    // Every body line must be a comment — parsing yields null (inert stub)
    const parsed = parseYaml(content);
    expect(parsed).toBeNull();

    // The stub must mention the top-level keys so users can find them
    for (const key of [
      "system:",
      "scan:",
      "levels:",
      "abstraction:",
      "output:",
      "llm:",
    ]) {
      expect(content).toContain(`# ${key}`);
    }
  }
});
```

### Step 2: Run the test to confirm it fails

Run: `npx vitest run tests/integration/submodule.test.ts -t "scaffolds a commented-out"`

Expected: FAIL. Assertion `expect(fs.existsSync(stubPath)).toBe(true)` fails because no code writes the stub yet.

### Step 3: Add the stub builder helper

Edit `src/generator/d2/submodule-scaffold.ts`.

First, add a new import for `buildDefaultConfig` at the top (next to the other config imports). The top of the file should look like this:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import { buildDefaultConfig } from "../../config/loader.js";
import { generateComponentDiagram } from "./component.js";
import { STYLES_D2 } from "./styles.js";
import { extractFragment } from "../../core/model-fragment.js";
import { stringify as stringifyYaml } from "yaml";
```

Then add this helper function at the bottom of the file (after the existing `writeIfChanged` helper):

```typescript
function buildSubmoduleConfigStub(repoRoot: string, appPath: string): string {
  const { defaults } = buildDefaultConfig(path.join(repoRoot, appPath));
  const humanName = (defaults.system as { name: string }).name;

  const body = stringifyYaml(defaults, { lineWidth: 120 });
  const commentedBody = body
    .split("\n")
    .map((line) => (line.length === 0 ? "#" : `# ${line}`))
    .join("\n");

  return [
    `# diagram-docs.yaml for ${humanName}`,
    "#",
    "# Per-application config. Values here override the repo-root config",
    "# (cascading, closest parent wins). Uncomment any line below to override",
    "# the inherited default.",
    "",
    commentedBody,
  ].join("\n");
}
```

### Step 4: Wire the stub into the per-container loop

In `generateSubmoduleDocs`, the existing loop starts with `for (const container of model.containers)`. Inside that loop, between the existing `let changed = false;` line and the `if (config.levels.component)` block that generates the component diagram, insert the stub write.

The relevant existing block is:

```typescript
    const d2Files: string[] = [];
    let changed = false;

    // Generate component diagram (only when enabled)
    if (config.levels.component) {
      const d2 = generateComponentDiagram(model, container.id);
```

Change it to:

```typescript
    const d2Files: string[] = [];
    let changed = false;

    // Scaffold per-submodule config stub (create-once, gated on component-level diagrams)
    if (config.levels.component) {
      const stubPath = path.join(repoRoot, appPath, "diagram-docs.yaml");
      if (!fs.existsSync(stubPath)) {
        fs.mkdirSync(path.dirname(stubPath), { recursive: true });
        fs.writeFileSync(
          stubPath,
          buildSubmoduleConfigStub(repoRoot, appPath),
          "utf-8",
        );
        changed = true;
      }
    }

    // Generate component diagram (only when enabled)
    if (config.levels.component) {
      const d2 = generateComponentDiagram(model, container.id);
```

### Step 5: Run the test to confirm it passes

Run: `npx vitest run tests/integration/submodule.test.ts -t "scaffolds a commented-out"`

Expected: PASS.

### Step 6: Run the full submodule test file to confirm no regressions

Run: `npx vitest run tests/integration/submodule.test.ts`

Expected: all tests PASS.

### Step 7: Commit

```bash
git add src/generator/d2/submodule-scaffold.ts tests/integration/submodule.test.ts
git commit -m "feat: scaffold diagram-docs.yaml stub at each submodule root"
```

---

## Task 2: Edge-case regression tests

The primary implementation already respects `override.exclude` (existing `continue`), the `levels.component` gate (added in Task 1), and the file-exists guard (added in Task 1). This task adds explicit regression tests so those properties don't silently regress.

**Files:**

- Modify: `tests/integration/submodule.test.ts`

### Step 1: Add the "create-once" test

Append this test to the same `describe` block:

```typescript
it("preserves an existing diagram-docs.yaml at a submodule root", () => {
  const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
  const model = loadModel(MODEL_PATH);

  const tmpRoot = path.join(MONOREPO, "test-submodule-stub-preserve");
  trackDir(tmpRoot);

  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { context: true, container: true, component: true },
  });

  // Pre-create a populated stub for one submodule
  const appPath = "services/user/api";
  const stubPath = path.join(tmpRoot, appPath, "diagram-docs.yaml");
  fs.mkdirSync(path.dirname(stubPath), { recursive: true });
  const userContent = "system:\n  name: My Custom Name\n";
  fs.writeFileSync(stubPath, userContent, "utf-8");

  generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

  expect(fs.readFileSync(stubPath, "utf-8")).toBe(userContent);
});
```

### Step 2: Add the `levels.component = false` test

```typescript
it("does not scaffold submodule stubs when component diagrams are disabled", () => {
  const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
  const model = loadModel(MODEL_PATH);

  const tmpRoot = path.join(MONOREPO, "test-submodule-stub-nocomponent");
  trackDir(tmpRoot);

  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { context: true, container: true, component: false },
  });

  generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

  for (const container of model.containers) {
    const appPath =
      container.path ?? container.applicationId.replace(/-/g, "/");
    const stubPath = path.join(tmpRoot, appPath, "diagram-docs.yaml");
    expect(fs.existsSync(stubPath)).toBe(false);
  }
});
```

### Step 3: Add the `override.exclude` test

```typescript
it("does not scaffold a stub for a submodule excluded via override", () => {
  const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
  const model = loadModel(MODEL_PATH);

  const tmpRoot = path.join(MONOREPO, "test-submodule-stub-exclude");
  trackDir(tmpRoot);

  const config = configSchema.parse({
    submodules: {
      enabled: true,
      overrides: {
        "services-order-service": { exclude: true },
      },
    },
    levels: { context: true, container: true, component: true },
  });

  generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

  // order-service's inferred appPath should have no stub
  const excludedAppPath = "services/order/service";
  const excludedStub = path.join(tmpRoot, excludedAppPath, "diagram-docs.yaml");
  expect(fs.existsSync(excludedStub)).toBe(false);

  // user-api should have one
  const includedStub = path.join(
    tmpRoot,
    "services/user/api",
    "diagram-docs.yaml",
  );
  expect(fs.existsSync(includedStub)).toBe(true);
});
```

### Step 4: Run the full submodule test file

Run: `npx vitest run tests/integration/submodule.test.ts`

Expected: all tests (including the three new ones) PASS.

### Step 5: Commit

```bash
git add tests/integration/submodule.test.ts
git commit -m "test: regression tests for submodule config stub edge cases"
```

---

## Task 3: Full verification

Before declaring done, run the full quality gates.

### Step 1: Typecheck

Run: `npm run typecheck`

Expected: no errors.

### Step 2: Lint

Run: `npm run lint`

Expected: no errors.

### Step 3: Full test suite

Run: `npm test`

Expected: all tests PASS. No regressions elsewhere in the suite.

### Step 4: Manual smoke test against the fixture monorepo

Run: `npx tsx src/cli/index.ts generate --config tests/fixtures/monorepo/diagram-docs.yaml`

Then inspect:

```bash
ls tests/fixtures/monorepo/services/*/diagram-docs.yaml
```

Expected: `services/api-gateway/diagram-docs.yaml` still contains its pre-existing override content (not overwritten). Any other service folder that received component diagrams now has a commented-out stub.

Clean up any new stubs that appear in the fixture tree if you don't want to commit them:

```bash
git status tests/fixtures/monorepo/
```

Inspect any new `diagram-docs.yaml` files, confirm they're commented-out stubs, then decide whether to commit them as part of the fixture update or revert them.

### Step 5: Commit final verification artifacts (if any)

If the smoke test revealed fixture changes worth keeping (e.g., expected stubs at well-known fixture paths), commit them:

```bash
git add tests/fixtures/monorepo/services/*/diagram-docs.yaml
git commit -m "test: update monorepo fixture with submodule config stubs"
```

Otherwise, revert untracked stubs in the fixture:

```bash
git clean -fn tests/fixtures/monorepo/
# Review the list, then:
git clean -f tests/fixtures/monorepo/
```
