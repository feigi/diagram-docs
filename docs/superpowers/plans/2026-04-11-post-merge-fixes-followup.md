# Post-Merge Worktree-Exclude Review Follow-Up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the review findings for the three post-merge worktree-exclude commits (25990cb, 8136fdc, 063e17f): add the missing schema-default assertion, remove the duplicated `effectiveConfig` construction via a shared helper, tighten the `runScanAll`/`resolveModel` boundary so it receives the effective config, and add an end-to-end test proving worktree projects are actually excluded from discovery.

**Architecture:** Three independent tasks. Task 1 is a one-line test-only change. Task 2 refactors the `effectiveConfig` construction into a reusable `buildEffectiveConfig(config)` helper in `src/config/loader.ts` and updates all four call sites (`src/core/scan.ts` × 2, `src/cli/commands/scan.ts`, `src/cli/commands/generate.ts`) — at the same time fixing the `runScanAll` call sites that currently receive raw `config`. Task 3 adds a new integration test under `tests/integration/` with a fixture that places a buildable project inside a `.worktrees/` directory and asserts it is excluded by `discoverApplications`.

**Tech Stack:** TypeScript (Node16 ES modules), Zod, vitest, Commander.js.

**Parallelism:** Tasks 1 and 3 are independent of each other and of Task 2. Task 2 touches source files only; Tasks 1 and 3 touch test files only, so all three can be dispatched in parallel in separate worktrees.

---

## Pre-Flight (one-time, before any task)

- [ ] **Create a worktree for the follow-up work**

```bash
cd /Users/chris/dev/diagram-docs
git worktree add .worktrees/review-followup -b review-followup-post-merge origin/main
cd .worktrees/review-followup
```

Expected: a new worktree at `.worktrees/review-followup` on a fresh branch rebased to `origin/main`.

- [ ] **Verify baseline is green**

```bash
npm test
```

Expected: all tests pass. If anything is broken before we start, stop and investigate.

---

## Task 1: Add Missing `**/*.worktrees/**` Schema-Default Assertion

**Why:** The review found that `src/config/schema.ts` adds three worktree exclude patterns but the test at `tests/config/effective-excludes.test.ts:129-143` only asserts two of them (`**/*.worktree/**` and `**/.worktrees/**`). The plural-dotted form `**/*.worktrees/**` — precisely the pattern that motivated commit 063e17f — is unguarded against regression.

**Files:**

- Modify: `tests/config/effective-excludes.test.ts:129-143`

- [ ] **Step 1: Read the current test block**

```bash
sed -n '129,143p' tests/config/effective-excludes.test.ts
```

Expected output:

```
  it("full registry effective excludes includes all language patterns", () => {
    const config: Config = configSchema.parse({});
    const result = computeEffectiveExcludes(config, registry);

    // Universal
    expect(result).toContain("**/*test*/**");
    expect(result).toContain("**/*.worktree/**");
    expect(result).toContain("**/.worktrees/**");
    // Python
    ...
```

- [ ] **Step 2: Add the missing assertion**

Insert one line between the existing `**/*.worktree/**` and `**/.worktrees/**` assertions so the test file block becomes:

```typescript
// Universal
expect(result).toContain("**/*test*/**");
expect(result).toContain("**/*.worktree/**");
expect(result).toContain("**/*.worktrees/**");
expect(result).toContain("**/.worktrees/**");
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
npx vitest run tests/config/effective-excludes.test.ts
```

Expected: all tests in this file pass, including the updated `full registry effective excludes includes all language patterns` test.

- [ ] **Step 4: Guard-rail — verify the assertion actually guards the schema default**

Temporarily delete the `"**/*.worktrees/**"` entry from `src/config/schema.ts` (line 22), rerun the test, confirm it **fails**, then restore the deletion. This proves the new assertion is wired to the thing it claims to protect.

```bash
# Hand-verify: edit src/config/schema.ts to remove "**/*.worktrees/**"
npx vitest run tests/config/effective-excludes.test.ts
# Expected: FAIL with "expected [...] to contain '**/*.worktrees/**'"
# Restore the schema.ts change
git checkout -- src/config/schema.ts
npx vitest run tests/config/effective-excludes.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add tests/config/effective-excludes.test.ts
git commit -m "test: assert **/*.worktrees/** is in effective excludes defaults"
```

---

## Task 2: Extract `buildEffectiveConfig` Helper and Fix Propagation

**Why:** The `{ ...config, scan: { ...config.scan, exclude: computeEffectiveExcludes(config, getRegistry()) } }` pattern is duplicated in four places. Worse, two call sites (`src/cli/commands/scan.ts:123` and `src/cli/commands/generate.ts:252`) build `effectiveConfig` for `discoverApplications` but then pass the **raw** `config` to `runScanAll`/`resolveModel`. Today this is harmless only because `runProjectScan` recomputes the excludes internally — a fragile implicit contract. Extracting a helper kills the duplication; fixing the call sites makes the contract explicit at the boundary.

**Files:**

- Modify: `src/config/loader.ts` (add export)
- Modify: `src/core/scan.ts:203-213` (use helper in `runScan`)
- Modify: `src/core/scan.ts:380-395` (use helper in `runProjectScan`)
- Modify: `src/cli/commands/scan.ts:82-129` (use helper + pass `effectiveConfig` to `runScanAll`)
- Modify: `src/cli/commands/generate.ts:227-254` (use helper + pass `effectiveConfig` to `runScanAll`)
- Create: `tests/config/build-effective-config.test.ts` (new unit test for the helper)

- [ ] **Step 1: Write the failing unit test for `buildEffectiveConfig`**

Create `tests/config/build-effective-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildEffectiveConfig,
  computeEffectiveExcludes,
} from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";
import { getRegistry } from "../../src/analyzers/registry.js";

describe("buildEffectiveConfig", () => {
  it("returns a config whose scan.exclude equals computeEffectiveExcludes", () => {
    const config = configSchema.parse({});
    const effective = buildEffectiveConfig(config);
    expect(effective.scan.exclude).toEqual(
      computeEffectiveExcludes(config, getRegistry()),
    );
  });

  it("preserves the rest of config.scan (include, forceInclude)", () => {
    const config = configSchema.parse({
      scan: { include: ["src/**"], forceInclude: ["**/keepme/**"] },
    });
    const effective = buildEffectiveConfig(config);
    expect(effective.scan.include).toEqual(["src/**"]);
    expect(effective.scan.forceInclude).toEqual(["**/keepme/**"]);
  });

  it("preserves top-level config fields unchanged", () => {
    const config = configSchema.parse({});
    const effective = buildEffectiveConfig(config);
    expect(effective.system).toEqual(config.system);
    expect(effective.abstraction).toEqual(config.abstraction);
    expect(effective.output).toEqual(config.output);
  });

  it("does not mutate the input config", () => {
    const config = configSchema.parse({});
    const originalExclude = [...config.scan.exclude];
    buildEffectiveConfig(config);
    expect(config.scan.exclude).toEqual(originalExclude);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/config/build-effective-config.test.ts
```

Expected: FAIL with `"buildEffectiveConfig" is not exported by "src/config/loader.ts"` (or a TypeScript compile error).

- [ ] **Step 3: Add the `buildEffectiveConfig` export to `src/config/loader.ts`**

Add this function at the bottom of `src/config/loader.ts` (after `computeEffectiveExcludes`):

```typescript
/**
 * Build a Config with `scan.exclude` replaced by the fully-resolved effective
 * excludes (user patterns + analyzer defaults − forceInclude). Use this at the
 * boundary between CLI/orchestration code and any consumer that reads
 * `config.scan.exclude` — so the effective set is computed exactly once per
 * command invocation and flows through the rest of the pipeline explicitly.
 */
export function buildEffectiveConfig(config: Config): Config {
  return {
    ...config,
    scan: {
      ...config.scan,
      exclude: computeEffectiveExcludes(config, getRegistry()),
    },
  };
}
```

You will also need to add the registry import at the top of `src/config/loader.ts`:

```typescript
import { getRegistry } from "../analyzers/registry.js";
```

- [ ] **Step 4: Run the unit test to verify it passes**

```bash
npx vitest run tests/config/build-effective-config.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run the full test suite to catch any circular import**

```bash
npm test
```

Expected: green. If `src/analyzers/registry.ts` imports anything from `src/config/loader.ts`, you will see a circular import; in that case, revert the registry import in Step 3 and instead pass the registry in as a second parameter: `buildEffectiveConfig(config, getRegistry())`. Update the unit test and all call sites below accordingly.

- [ ] **Step 6: Replace the duplicated construction in `src/core/scan.ts` (runScan)**

At `src/core/scan.ts:203-213`, replace:

```typescript
export async function runScan({
  rootDir,
  config,
  force,
}: ScanOptions): Promise<ScanResult> {
  // Compute effective excludes from config + all analyzer defaults
  const effectiveExcludes = computeEffectiveExcludes(config, getRegistry());
  const effectiveConfig: Config = {
    ...config,
    scan: { ...config.scan, exclude: effectiveExcludes },
  };
```

with:

```typescript
export async function runScan({
  rootDir,
  config,
  force,
}: ScanOptions): Promise<ScanResult> {
  const effectiveConfig = buildEffectiveConfig(config);
  const effectiveExcludes = effectiveConfig.scan.exclude;
```

(The local `effectiveExcludes` binding is retained because it is referenced downstream at `src/core/scan.ts:240, 256, 278`.)

Add `buildEffectiveConfig` to the existing `computeEffectiveExcludes` import from `../config/loader.js`.

- [ ] **Step 7: Replace the duplicated construction in `src/core/scan.ts` (runProjectScan)**

At `src/core/scan.ts:389`, replace:

```typescript
const effectiveExcludes = computeEffectiveExcludes(config, getRegistry());
```

with:

```typescript
const effectiveConfig = buildEffectiveConfig(config);
const effectiveExcludes = effectiveConfig.scan.exclude;
```

Then use `effectiveConfig.abstraction` in place of `config.abstraction` in the `configFingerprint` literal and the downstream `scanConfig` literal (`src/core/scan.ts:392-419`) so the whole function consistently operates on the effective config.

- [ ] **Step 8: Replace the duplicated construction in `src/cli/commands/scan.ts` and fix the raw-config leak**

At `src/cli/commands/scan.ts:82-103`, replace:

```typescript
        const effectiveExcludes = computeEffectiveExcludes(
          config,
          getRegistry(),
        );
        const effectiveConfig = {
          ...config,
          scan: { ...config.scan, exclude: effectiveExcludes },
        };
        const discovered = await discoverApplications(
          configDir,
          effectiveConfig,
          {
```

with:

```typescript
        const effectiveConfig = buildEffectiveConfig(config);
        const discovered = await discoverApplications(
          configDir,
          effectiveConfig,
          {
```

Then at `src/cli/commands/scan.ts:121-126`, replace the raw `config` in the `runScanAll` call:

```typescript
const { rawStructure: combined } = await runScanAll({
  rootDir: configDir,
  config: effectiveConfig,
  projects: discovered,
  force: options.force,
});
```

Update the imports at the top of the file:

- Remove `computeEffectiveExcludes` from the `../../config/loader.js` import if it is no longer referenced anywhere else in the file.
- Add `buildEffectiveConfig` to the `../../config/loader.js` import.
- Remove the `getRegistry` import if it is no longer used. (Verify with `grep getRegistry src/cli/commands/scan.ts` — it is still used by `detectBuildFile` at line 24, so leave it.)

- [ ] **Step 9: Replace the duplicated construction in `src/cli/commands/generate.ts` and fix the raw-config leak**

At `src/cli/commands/generate.ts:227-232`, replace:

```typescript
  // 2. Discover and classify projects
  const effectiveExcludes = computeEffectiveExcludes(config, getRegistry());
  const effectiveConfig = {
    ...config,
    scan: { ...config.scan, exclude: effectiveExcludes },
  };
  const discovered = await discoverApplications(configDir, effectiveConfig, {
```

with:

```typescript
  // 2. Discover and classify projects
  const effectiveConfig = buildEffectiveConfig(config);
  const discovered = await discoverApplications(configDir, effectiveConfig, {
```

Then at `src/cli/commands/generate.ts:250-254`, replace the raw `config` in the `runScanAll` call:

```typescript
// 3. Per-project scan with caching
const { rawStructure, projectResults, staleProjects } = await runScanAll({
  rootDir: configDir,
  config: effectiveConfig,
  projects: discovered,
});
```

Update the imports:

- Remove `computeEffectiveExcludes` from the `../../config/loader.js` import.
- Add `buildEffectiveConfig` to the `../../config/loader.js` import.
- Leave `getRegistry` alone — audit the file (`grep -n getRegistry src/cli/commands/generate.ts`) and remove it only if there are no remaining usages. (There are none after this change, so remove it.)

- [ ] **Step 10: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors. Typecheck will catch any forgotten import; lint will catch unused imports.

- [ ] **Step 11: Run the full test suite**

```bash
npm test
```

Expected: all tests green, including the existing `effective-excludes.test.ts`, `scan-rollup.test.ts`, pipeline and submodule integration tests.

- [ ] **Step 12: Commit**

```bash
git add src/config/loader.ts src/core/scan.ts src/cli/commands/scan.ts src/cli/commands/generate.ts tests/config/build-effective-config.test.ts
git commit -m "refactor: extract buildEffectiveConfig helper and thread it into runScanAll

Removes duplicated { ...config, scan: { ...config.scan, exclude: effectiveExcludes } }
construction from four call sites and tightens scan/generate so runScanAll receives
the effective config explicitly instead of relying on downstream recomputation."
```

---

## Task 3: Integration Test — Worktree Project Is Excluded From Discovery

**Why:** The whole point of commits 8136fdc and 063e17f was to stop scanning projects that live inside worktree directories. Currently no test creates a fixture with a buildable project inside a worktree dir and asserts it is absent from `discoverApplications`. This single test closes three gaps at once: the schema defaults, the `effectiveConfig` wiring in `scan`/`generate`, and the `collectConfigFiles` exclude threading.

**Files:**

- Create: `tests/integration/worktree-exclusion.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/worktree-exclusion.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { configSchema } from "../../src/config/schema.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { discoverApplications } from "../../src/core/discovery.js";

describe("worktree directories are excluded from discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-worktree-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProject(relPath: string, buildFile: string, contents = "") {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, buildFile), contents, "utf-8");
  }

  it("ignores projects inside .worktrees/", async () => {
    writeProject("services/main", "build.gradle", "// real project");
    writeProject(
      ".worktrees/feature-branch/services/main",
      "build.gradle",
      "// should be ignored",
    );

    const config = buildEffectiveConfig(configSchema.parse({}));
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path).sort();
    expect(paths).toContain("services/main");
    expect(paths).not.toContain(".worktrees/feature-branch/services/main");
    expect(paths.some((p) => p.startsWith(".worktrees/"))).toBe(false);
  });

  it("ignores projects inside *.worktree/", async () => {
    writeProject("services/api", "pom.xml", "<project/>");
    writeProject("tmp.worktree/services/api", "pom.xml", "<project/>");

    const config = buildEffectiveConfig(configSchema.parse({}));
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path).sort();
    expect(paths).toContain("services/api");
    expect(paths).not.toContain("tmp.worktree/services/api");
  });

  it("ignores projects inside *.worktrees/", async () => {
    writeProject("services/worker", "package.json", '{"name":"worker"}');
    writeProject(
      "feat.worktrees/services/worker",
      "package.json",
      '{"name":"ignored"}',
    );

    const config = buildEffectiveConfig(configSchema.parse({}));
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path).sort();
    expect(paths).toContain("services/worker");
    expect(paths).not.toContain("feat.worktrees/services/worker");
  });

  it("forceInclude overrides worktree exclusion", async () => {
    writeProject(
      ".worktrees/feature/services/main",
      "build.gradle",
      "// explicitly kept",
    );

    const config = buildEffectiveConfig(
      configSchema.parse({
        scan: { forceInclude: ["**/.worktrees/**"] },
      }),
    );
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path);
    expect(paths).toContain(".worktrees/feature/services/main");
  });
});
```

- [ ] **Step 2: Run the test to verify the baseline**

```bash
npx vitest run tests/integration/worktree-exclusion.test.ts
```

Expected: all 4 tests PASS on the current main branch. (This is a regression-prevention test, not a TDD failure-first test — the behaviour already exists after commits 8136fdc/063e17f, and the point of this test is to nail it down so a future regression is caught.)

If any test **fails**, investigate:

- If `services/main` is not discovered at all, the test is using a build-file name that no analyzer recognises. Check `src/analyzers/registry.ts` for `buildFilePatterns`.
- If a worktree project IS discovered, that is a real bug — confirm against `src/config/schema.ts` defaults and `src/core/discovery.ts` to make sure the effective excludes are actually being honoured by discovery.

- [ ] **Step 3: Verify the test catches a regression**

Temporarily remove the three worktree patterns from `src/config/schema.ts:21-23`, rerun the test, confirm the first three tests **fail**, then restore the schema file:

```bash
# Hand-verify: comment out the three worktree patterns in src/config/schema.ts
npx vitest run tests/integration/worktree-exclusion.test.ts
# Expected: FAIL (projects from worktree dirs appear in `discovered`)
git checkout -- src/config/schema.ts
npx vitest run tests/integration/worktree-exclusion.test.ts
# Expected: PASS
```

This verifies the test is actually guarding the fix and not a no-op.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including the new file.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/worktree-exclusion.test.ts
git commit -m "test: add integration test for worktree directory exclusion

Covers **/*.worktree/**, **/*.worktrees/**, and **/.worktrees/** patterns
end-to-end through discoverApplications with the schema defaults, plus a
forceInclude override case."
```

---

## Finalisation

- [ ] **Rebase to origin/main and rerun the full suite**

```bash
git fetch origin
git rebase origin/main
npm run typecheck && npm run lint && npm test
```

Expected: clean rebase, all checks green.

- [ ] **Open PR**

```bash
gh pr create --base main --title "refactor: effective-config helper + worktree exclusion tests" --body "$(cat <<'EOF'
## Summary
- Add `buildEffectiveConfig(config)` helper in `src/config/loader.ts`; remove duplicated `{ ...config, scan: { ...config.scan, exclude: ... } }` from `src/core/scan.ts` (×2), `src/cli/commands/scan.ts`, and `src/cli/commands/generate.ts`.
- Pass `effectiveConfig` (not raw `config`) to `runScanAll` in the scan and generate commands, making the exclude contract explicit at the boundary instead of relying on downstream recomputation in `runProjectScan`.
- Add the missing `**/*.worktrees/**` assertion to `tests/config/effective-excludes.test.ts`.
- Add end-to-end integration test proving that projects inside `.worktrees/`, `*.worktree/`, and `*.worktrees/` directories are excluded from discovery, plus a `forceInclude` override case.

Follow-up for review findings on commits 25990cb, 8136fdc, and 063e17f.

## Test plan
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] New unit tests in `tests/config/build-effective-config.test.ts` pass
- [ ] New integration tests in `tests/integration/worktree-exclusion.test.ts` pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Clean up the worktree after merge**

```bash
cd /Users/chris/dev/diagram-docs
git worktree remove .worktrees/review-followup
git branch -d review-followup-post-merge
```

---

## Self-Review

**Spec coverage:**

- Review finding #1 (missing `**/*.worktrees/**` assertion) → Task 1 ✓
- Review finding #2 (`runScanAll` receives raw `config`) → Task 2 Steps 8 and 9 ✓
- Review finding #3 (no end-to-end worktree exclusion test) → Task 3 ✓
- Review finding #4 (duplicated `effectiveConfig` construction) → Task 2 Steps 6-9 ✓
- Review finding #5 (`collectConfigFiles` exclude parameter untested) → covered indirectly by Task 3 (the end-to-end test exercises the full analyzer path) — not worth a separate unit test given the behaviour is now pinned at the boundary.

**Placeholder scan:** No TBDs, no "implement later", no "similar to above". Every code step has complete code.

**Type consistency:** `buildEffectiveConfig(config: Config): Config` — one signature, used consistently in loader.ts, the two CLI commands, the two core/scan.ts functions, and the new unit test. The test in Task 3 also imports `buildEffectiveConfig` from the same module, matching Task 2.

**Parallelism note:** Tasks 1, 2, and 3 can be dispatched in parallel to three separate subagents, each working in its own worktree (or branching from a shared `review-followup-post-merge` base) because the file sets do not overlap:

- Task 1 → `tests/config/effective-excludes.test.ts`
- Task 2 → `src/config/loader.ts`, `src/core/scan.ts`, `src/cli/commands/{scan,generate}.ts`, `tests/config/build-effective-config.test.ts`
- Task 3 → `tests/integration/worktree-exclusion.test.ts`

If dispatching in parallel, each subagent should create its own sub-worktree (e.g. `.worktrees/review-followup-task1`) off a shared base branch and merge results sequentially at the end. If executing inline, run the tasks in order 1 → 2 → 3 — the order does not matter functionally but task 2 is by far the largest and is the natural one to sit in the middle.
