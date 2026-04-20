# Skip Aggregator Submodule Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In submodule mode, skip per-folder docs generation for "aggregator" containers — any container whose path is an ancestor of another container's path — so Gradle multi-project roots (e.g. `los-cha/`) no longer produce near-empty `docs/architecture/` sites when their real content lives in child subprojects (`los-cha/app/`).

**Architecture:** Detect aggregators once per `generateSubmoduleDocs` call by comparing `container.path` values. Skip scaffold/generate for aggregator ids. Mirror the skip in `resolveSubmoduleLink` so root C2 drops drill-down links for aggregators. Add a cleanup pass in `removeStaleSubmoduleDirs` that removes previously-scaffolded aggregator dirs (docs subtree + inert `diagram-docs.yaml` stub), guarded by user-modification checks analogous to existing `isUserModified`.

**Tech Stack:** TypeScript (ES modules, Node16 resolution), vitest for tests, `yaml` package. No new dependencies.

---

## File Structure

**Modify:**

- `src/generator/d2/submodule-scaffold.ts` — add `collectAggregatorIds(model)` helper; skip aggregator ids in the main loop.
- `src/cli/commands/generate.ts` — `resolveSubmoduleLink` checks aggregator set and returns `null`.
- `src/generator/d2/cleanup.ts` — add `isInertSubmoduleStub(filePath)` + `removeStaleSubmoduleDirs(repoRoot, model, config)` exported helpers.
- `src/cli/commands/generate.ts` — invoke `removeStaleSubmoduleDirs` before `generateSubmoduleDocs`.
- `tests/integration/submodule.test.ts` — extend with aggregator-skip test.
- `tests/generator/cleanup.test.ts` — extend with stale-submodule-dir tests.

**No new files.**

---

## Task 1: Aggregator detection helper (unit, TDD)

**Files:**

- Create test in: `tests/generator/submodule-scaffold.test.ts`
- Modify: `src/generator/d2/submodule-scaffold.ts`

### Step 1: Write the failing test

Create `tests/generator/submodule-scaffold.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { collectAggregatorIds } from "../../src/generator/d2/submodule-scaffold.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

function makeModel(
  containers: Array<{ id: string; path?: string }>,
): ArchitectureModel {
  return {
    version: 1,
    system: { name: "T", description: "" },
    actors: [],
    externalSystems: [],
    containers: containers.map((c) => ({
      id: c.id,
      applicationId: c.id,
      name: c.id,
      description: c.id,
      technology: "Java",
      path: c.path,
    })),
    components: [],
    relationships: [],
  };
}

describe("collectAggregatorIds", () => {
  it("flags a container whose path is an ancestor of another", () => {
    const model = makeModel([
      { id: "los-cha", path: "los-cha" },
      { id: "los-cha-app", path: "los-cha/app" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set(["los-cha"]));
  });

  it("does not flag sibling paths", () => {
    const model = makeModel([
      { id: "a", path: "services/a" },
      { id: "b", path: "services/b" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set());
  });

  it("does not flag containers without a path", () => {
    const model = makeModel([{ id: "x" }, { id: "y", path: "x/y" }]);
    expect(collectAggregatorIds(model)).toEqual(new Set());
  });

  it("handles multi-level nesting", () => {
    const model = makeModel([
      { id: "root", path: "root" },
      { id: "mid", path: "root/mid" },
      { id: "leaf", path: "root/mid/leaf" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set(["root", "mid"]));
  });

  it("does not flag substring-but-not-prefix paths", () => {
    const model = makeModel([
      { id: "a", path: "foo" },
      { id: "b", path: "foobar/x" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set());
  });
});
```

### Step 2: Run test — expect FAIL

Run: `npx vitest run tests/generator/submodule-scaffold.test.ts`
Expected: FAIL — "collectAggregatorIds is not exported".

### Step 3: Add the implementation

In `src/generator/d2/submodule-scaffold.ts`, add at the top after the existing imports (before `export interface SubmoduleOutputInfo`):

```typescript
/**
 * Returns the set of container ids whose `path` is a strict ancestor of
 * another container's `path`. These are treated as aggregators (e.g. a
 * Gradle multi-project root) and are skipped during per-folder docs
 * generation because their real content lives in child containers.
 */
export function collectAggregatorIds(model: ArchitectureModel): Set<string> {
  const paths = model.containers
    .map((c) => ({ id: c.id, path: c.path }))
    .filter((c): c is { id: string; path: string } => !!c.path);

  const aggregators = new Set<string>();
  for (const a of paths) {
    for (const b of paths) {
      if (a.id === b.id) continue;
      if (b.path.startsWith(a.path + "/")) {
        aggregators.add(a.id);
        break;
      }
    }
  }
  return aggregators;
}
```

### Step 4: Run test — expect PASS

Run: `npx vitest run tests/generator/submodule-scaffold.test.ts`
Expected: PASS (5 tests).

### Step 5: Commit

```bash
git add src/generator/d2/submodule-scaffold.ts tests/generator/submodule-scaffold.test.ts
git commit -m "feat: detect aggregator containers by path ancestry"
```

---

## Task 2: Skip aggregators in `generateSubmoduleDocs`

**Files:**

- Modify: `src/generator/d2/submodule-scaffold.ts:31-39` (loop top)
- Modify: `tests/integration/submodule.test.ts` (append test)

### Step 1: Write the failing integration test

Append to `tests/integration/submodule.test.ts` inside the existing `describe("Integration: Submodule per-folder docs", ...)` block, before the closing brace:

```typescript
it("skips aggregator containers whose path is an ancestor of another container", () => {
  const tmpRoot = path.join(MONOREPO, "test-submodule-aggregator");
  trackDir(tmpRoot);

  const model: import("../../src/analyzers/types.js").ArchitectureModel = {
    version: 1,
    system: { name: "T", description: "" },
    actors: [],
    externalSystems: [],
    containers: [
      {
        id: "los-cha",
        applicationId: "los-cha",
        name: "Los Cha",
        description: "",
        technology: "Java",
        path: "los-cha",
      },
      {
        id: "los-cha-app",
        applicationId: "los-cha-app",
        name: "Charging App",
        description: "",
        technology: "Java / Spring Boot",
        path: "los-cha/app",
      },
    ],
    components: [],
    relationships: [],
  };

  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { context: true, container: true, component: true },
  });

  const subResults = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

  // Aggregator skipped, leaf kept.
  expect(subResults.map((s) => s.containerId).sort()).toEqual(["los-cha-app"]);

  // No docs dir scaffolded at the aggregator path.
  expect(fs.existsSync(path.join(tmpRoot, "los-cha", "docs"))).toBe(false);
  // No stub diagram-docs.yaml scaffolded at aggregator path.
  expect(
    fs.existsSync(path.join(tmpRoot, "los-cha", "diagram-docs.yaml")),
  ).toBe(false);

  // Leaf subproject site created as usual.
  expect(
    fs.existsSync(
      path.join(tmpRoot, "los-cha/app/docs/architecture/c3-component.d2"),
    ),
  ).toBe(true);
});
```

### Step 2: Run test — expect FAIL

Run: `npx vitest run tests/integration/submodule.test.ts -t "skips aggregator"`
Expected: FAIL — aggregator site still written, `subResults` length is 2.

### Step 3: Apply the skip in the loop

In `src/generator/d2/submodule-scaffold.ts`, replace the start of the loop (currently lines 32-39):

```typescript
  const results: SubmoduleOutputInfo[] = [];
  const subCfg = config.submodules;
  let unchangedCount = 0;

  for (const container of model.containers) {
    // Check for explicit exclude
    const override = subCfg.overrides[container.applicationId];
    if (override?.exclude) continue;
```

With:

```typescript
  const results: SubmoduleOutputInfo[] = [];
  const subCfg = config.submodules;
  const aggregatorIds = collectAggregatorIds(model);
  let unchangedCount = 0;

  for (const container of model.containers) {
    // Check for explicit exclude
    const override = subCfg.overrides[container.applicationId];
    if (override?.exclude) continue;

    // Skip aggregator containers (path is ancestor of another container).
    // Their real content lives in child subprojects that get their own site.
    if (aggregatorIds.has(container.id)) continue;
```

### Step 4: Run test — expect PASS

Run: `npx vitest run tests/integration/submodule.test.ts -t "skips aggregator"`
Expected: PASS.

Also run the whole submodule test file to make sure existing tests still pass:

Run: `npx vitest run tests/integration/submodule.test.ts`
Expected: all PASS.

### Step 5: Commit

```bash
git add src/generator/d2/submodule-scaffold.ts tests/integration/submodule.test.ts
git commit -m "feat: skip aggregator containers in submodule doc generation"
```

---

## Task 3: Skip aggregators in C2 drill-down link resolver

**Files:**

- Modify: `src/cli/commands/generate.ts:475-500`
- Modify: `tests/integration/submodule.test.ts` (append test)

### Step 1: Write the failing test

Append to the same `describe` block in `tests/integration/submodule.test.ts`:

```typescript
it("returns null drill-down link for aggregator containers in C2", () => {
  const model: import("../../src/analyzers/types.js").ArchitectureModel = {
    version: 1,
    system: { name: "T", description: "" },
    actors: [],
    externalSystems: [],
    containers: [
      {
        id: "los-cha",
        applicationId: "los-cha",
        name: "Los Cha",
        description: "",
        technology: "Java",
        path: "los-cha",
      },
      {
        id: "los-cha-app",
        applicationId: "los-cha-app",
        name: "Charging App",
        description: "",
        technology: "Java / Spring Boot",
        path: "los-cha/app",
      },
    ],
    components: [],
    relationships: [],
  };

  const config = configSchema.parse({ submodules: { enabled: true } });

  const d2 = generateContainerDiagram(model, {
    componentLinks: true,
    format: "svg",
    submoduleLinkResolver: (containerId) => {
      // Inline the real resolver behavior we expect to ship:
      // aggregator -> null, leaf -> a path.
      return resolveSubmoduleLinkForTest(containerId, model, config);
    },
  });

  // Leaf gets a link; aggregator does not.
  expect(d2).toContain("los-cha/app/docs/architecture/c3-component.svg");
  // The aggregator box should not carry a link attribute pointing to a los-cha/docs path.
  expect(d2).not.toMatch(/los-cha\/docs\/architecture\/c3-component\.svg/);
});
```

At the top of the file (with other imports), add a lightweight re-export wrapper so the test can exercise the real resolver. Since `resolveSubmoduleLink` is currently a private function, export it from `generate.ts`:

In `src/cli/commands/generate.ts`, find the existing private declaration:

```typescript
function resolveSubmoduleLink(
```

and change it to:

```typescript
export function resolveSubmoduleLink(
```

Then at the top of `tests/integration/submodule.test.ts`, add:

```typescript
import { resolveSubmoduleLink } from "../../src/cli/commands/generate.js";

function resolveSubmoduleLinkForTest(
  containerId: string,
  model: import("../../src/analyzers/types.js").ArchitectureModel,
  config: import("../../src/config/schema.js").Config,
): string | null {
  // Pretend the root output dir sits at /<tmp>/docs/architecture.
  return resolveSubmoduleLink(
    containerId,
    model,
    config,
    path.join(MONOREPO, "docs", "architecture"),
  );
}
```

### Step 2: Run test — expect FAIL

Run: `npx vitest run tests/integration/submodule.test.ts -t "returns null drill-down"`
Expected: FAIL — aggregator currently resolves to a valid path.

### Step 3: Implement the skip

In `src/cli/commands/generate.ts`, update `resolveSubmoduleLink`. Find:

```typescript
export function resolveSubmoduleLink(
  containerId: string,
  model: import("../../analyzers/types.js").ArchitectureModel,
  config: Config,
  rootOutputDir: string,
): string | null {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) return null;

  const appPath = container.path ?? container.applicationId.replace(/-/g, "/");
  const override = config.submodules.overrides[container.applicationId];
  if (override?.exclude) return null;
```

Replace with:

```typescript
export function resolveSubmoduleLink(
  containerId: string,
  model: import("../../analyzers/types.js").ArchitectureModel,
  config: Config,
  rootOutputDir: string,
): string | null {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) return null;

  const appPath = container.path ?? container.applicationId.replace(/-/g, "/");
  const override = config.submodules.overrides[container.applicationId];
  if (override?.exclude) return null;

  // Aggregator containers have no submodule site (see submodule-scaffold.ts).
  if (collectAggregatorIds(model).has(container.id)) return null;
```

Add the import at the top of `src/cli/commands/generate.ts` near the other `submodule-scaffold.js` import:

```typescript
import {
  generateSubmoduleDocs,
  collectAggregatorIds,
} from "../../generator/d2/submodule-scaffold.js";
```

(Replace the existing single-name import line.)

### Step 4: Run test — expect PASS

Run: `npx vitest run tests/integration/submodule.test.ts -t "returns null drill-down"`
Expected: PASS.

Run full suite:

Run: `npx vitest run`
Expected: all PASS.

### Step 5: Commit

```bash
git add src/cli/commands/generate.ts tests/integration/submodule.test.ts
git commit -m "feat: drop C2 drill-down link for aggregator containers"
```

---

## Task 4: Inert-stub detection helper (unit, TDD)

**Files:**

- Modify: `src/generator/d2/cleanup.ts`
- Modify: `tests/generator/cleanup.test.ts`

### Step 1: Write the failing test

Append to `tests/generator/cleanup.test.ts` after the existing `describe("isUserModified", ...)` block:

```typescript
import { isInertSubmoduleStub } from "../../src/generator/d2/cleanup.js";

describe("isInertSubmoduleStub", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when every non-empty line is a comment", () => {
    const filePath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(
      filePath,
      "# diagram-docs.yaml for Foo\n#\n# system:\n#   name: Foo\n",
    );
    expect(isInertSubmoduleStub(filePath)).toBe(true);
  });

  it("returns false when any non-comment, non-empty line exists", () => {
    const filePath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(filePath, "# header\nsystem:\n  name: Foo\n");
    expect(isInertSubmoduleStub(filePath)).toBe(false);
  });

  it("returns false when the file does not exist", () => {
    expect(isInertSubmoduleStub(path.join(tmpDir, "missing.yaml"))).toBe(false);
  });

  it("ignores blank lines and whitespace-only lines", () => {
    const filePath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(filePath, "# header\n\n   \n# more\n");
    expect(isInertSubmoduleStub(filePath)).toBe(true);
  });
});
```

### Step 2: Run test — expect FAIL

Run: `npx vitest run tests/generator/cleanup.test.ts -t "isInertSubmoduleStub"`
Expected: FAIL — "isInertSubmoduleStub is not exported".

### Step 3: Implement

In `src/generator/d2/cleanup.ts`, append after `isUserModified`:

```typescript
/**
 * Returns true if `filePath` is an untouched submodule config stub:
 * every non-empty, non-whitespace line starts with `#`. Returns false if
 * the file does not exist or contains any real YAML content.
 */
export function isInertSubmoduleStub(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith("#")) return false;
  }
  return true;
}
```

### Step 4: Run test — expect PASS

Run: `npx vitest run tests/generator/cleanup.test.ts -t "isInertSubmoduleStub"`
Expected: PASS (4 tests).

### Step 5: Commit

```bash
git add src/generator/d2/cleanup.ts tests/generator/cleanup.test.ts
git commit -m "feat: detect inert submodule config stubs for cleanup"
```

---

## Task 5: Remove stale aggregator docs dirs

**Files:**

- Modify: `src/generator/d2/cleanup.ts`
- Modify: `tests/generator/cleanup.test.ts`
- Modify: `src/cli/commands/generate.ts`

### Step 1: Write the failing test

Append to `tests/generator/cleanup.test.ts`:

```typescript
import { removeStaleSubmoduleDirs } from "../../src/generator/d2/cleanup.js";
import { configSchema } from "../../src/config/schema.js";

describe("removeStaleSubmoduleDirs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeScaffold(filePath: string, customized = false): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      customized ? CUSTOMIZED_SCAFFOLD : DEFAULT_SCAFFOLD,
    );
  }

  function writeStub(filePath: string, inert = true): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      inert ? "# stub\n# system: ...\n" : "system:\n  name: Real\n",
    );
  }

  it("removes aggregator docs dir + inert stub when scaffold is untouched", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));
    fs.writeFileSync(
      path.join(docsArch, "_generated", "c3-component.d2"),
      "generated\n",
    );
    writeStub(path.join(tmpDir, appPath, "diagram-docs.yaml"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };

    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(tmpDir, appPath, "docs"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, appPath, "diagram-docs.yaml"))).toBe(
      false,
    );
  });

  it("preserves aggregator docs dir when scaffold has user customizations", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"), true);
    writeStub(path.join(tmpDir, appPath, "diagram-docs.yaml"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(docsArch, "c3-component.d2"))).toBe(true);
  });

  it("preserves stub when it has user customizations (non-inert)", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));
    writeStub(path.join(tmpDir, appPath, "diagram-docs.yaml"), false);

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(tmpDir, appPath, "diagram-docs.yaml"))).toBe(
      true,
    );
  });

  it("does nothing for non-aggregator containers", () => {
    const appPath = "services/user-api";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "user-api",
          applicationId: "services-user-api",
          name: "User API",
          description: "",
          technology: "Java",
          path: "services/user-api",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(docsArch, "c3-component.d2"))).toBe(true);
  });
});
```

### Step 2: Run test — expect FAIL

Run: `npx vitest run tests/generator/cleanup.test.ts -t "removeStaleSubmoduleDirs"`
Expected: FAIL — function not exported.

### Step 3: Implement

In `src/generator/d2/cleanup.ts`, append after `isInertSubmoduleStub`:

```typescript
import type { Config } from "../../config/schema.js";
import { collectAggregatorIds } from "./submodule-scaffold.js";

/**
 * Remove previously-scaffolded submodule sites for containers that are now
 * classified as aggregators. Called from `generate` before
 * `generateSubmoduleDocs`. Honors user customizations:
 *
 * - The aggregator docs subtree is removed only if the scaffold
 *   `c3-component.d2` has no user customizations. Otherwise a warning is
 *   printed and the tree is left intact.
 * - The aggregator `diagram-docs.yaml` stub is removed only if inert
 *   (all lines commented). Otherwise it is preserved.
 */
export function removeStaleSubmoduleDirs(
  repoRoot: string,
  model: ArchitectureModel,
  config: Config,
): void {
  const aggregatorIds = collectAggregatorIds(model);
  const subCfg = config.submodules;

  for (const container of model.containers) {
    if (!aggregatorIds.has(container.id)) continue;
    if (!container.path) continue;

    const override = subCfg.overrides[container.applicationId];
    const docsDir = override?.docsDir ?? subCfg.docsDir;
    const appRoot = path.join(repoRoot, container.path);
    const archDir = path.join(appRoot, docsDir, "architecture");
    const scaffold = path.join(archDir, "c3-component.d2");

    if (fs.existsSync(archDir)) {
      if (isUserModified(scaffold)) {
        console.error(
          `Warning: ${path.relative(repoRoot, scaffold)} has user customizations — aggregator site preserved. Remove manually if no longer needed.`,
        );
      } else {
        fs.rmSync(path.join(appRoot, docsDir), {
          recursive: true,
          force: true,
        });
        console.error(
          `Removed: ${path.relative(repoRoot, path.join(appRoot, docsDir))}/`,
        );
      }
    }

    const stub = path.join(appRoot, "diagram-docs.yaml");
    if (fs.existsSync(stub) && isInertSubmoduleStub(stub)) {
      fs.rmSync(stub);
      console.error(`Removed: ${path.relative(repoRoot, stub)}`);
    }
  }
}
```

### Step 4: Wire it up in `generate`

In `src/cli/commands/generate.ts`, find the block that calls `generateSubmoduleDocs` (around line 192):

```typescript
    // Per-folder submodule docs
    if (options.submodules || config.submodules.enabled) {
      const subResults = generateSubmoduleDocs(
        configDir,
        outputDir,
        model,
        config,
      );
```

Change to:

```typescript
    // Per-folder submodule docs
    if (options.submodules || config.submodules.enabled) {
      removeStaleSubmoduleDirs(configDir, model, config);
      const subResults = generateSubmoduleDocs(
        configDir,
        outputDir,
        model,
        config,
      );
```

Add the import at the top of the file alongside the existing `cleanup.js` import:

```typescript
import {
  removeStaleContainerDirs,
  removeStaleSubmoduleDirs,
} from "../../generator/d2/cleanup.js";
```

### Step 5: Run tests — expect PASS

Run: `npx vitest run tests/generator/cleanup.test.ts`
Expected: all PASS.

Run: `npx vitest run`
Expected: all PASS.

### Step 6: Commit

```bash
git add src/generator/d2/cleanup.ts src/cli/commands/generate.ts tests/generator/cleanup.test.ts
git commit -m "feat: clean up stale aggregator submodule docs on generate"
```

---

## Task 6: End-to-end smoke via monorepo fixture

**Files:**

- Modify: `tests/integration/submodule.test.ts`

### Step 1: Add end-to-end test exercising skip + cleanup together

Append inside the existing `describe` block:

```typescript
it("skips aggregator + cleans a pre-existing aggregator site", () => {
  const tmpRoot = path.join(MONOREPO, "test-submodule-aggregator-cleanup");
  trackDir(tmpRoot);

  // Simulate a prior run that scaffolded a site at the aggregator path.
  const archDir = path.join(tmpRoot, "los-cha/docs/architecture");
  fs.mkdirSync(path.join(archDir, "_generated"), { recursive: true });
  fs.writeFileSync(
    path.join(archDir, "c3-component.d2"),
    "# C4 Component Diagram — Los Cha\n\n...@_generated/c3-component.d2\n...@styles.d2\n\n# Add your customizations below this line\n",
  );
  fs.writeFileSync(
    path.join(archDir, "_generated", "c3-component.d2"),
    "los_cha: {}\n",
  );
  fs.writeFileSync(
    path.join(tmpRoot, "los-cha", "diagram-docs.yaml"),
    "# diagram-docs.yaml for Los Cha\n# system:\n#   name: Los Cha\n",
  );

  const model: import("../../src/analyzers/types.js").ArchitectureModel = {
    version: 1,
    system: { name: "T", description: "" },
    actors: [],
    externalSystems: [],
    containers: [
      {
        id: "los-cha",
        applicationId: "los-cha",
        name: "Los Cha",
        description: "",
        technology: "Java",
        path: "los-cha",
      },
      {
        id: "los-cha-app",
        applicationId: "los-cha-app",
        name: "Charging App",
        description: "",
        technology: "Java / Spring Boot",
        path: "los-cha/app",
      },
    ],
    components: [],
    relationships: [],
  };

  const config = configSchema.parse({ submodules: { enabled: true } });

  removeStaleSubmoduleDirs(tmpRoot, model, config);
  const subResults = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

  // Aggregator site gone.
  expect(fs.existsSync(path.join(tmpRoot, "los-cha/docs"))).toBe(false);
  expect(fs.existsSync(path.join(tmpRoot, "los-cha/diagram-docs.yaml"))).toBe(
    false,
  );

  // Leaf site present.
  expect(subResults.map((s) => s.containerId)).toEqual(["los-cha-app"]);
  expect(
    fs.existsSync(
      path.join(tmpRoot, "los-cha/app/docs/architecture/c3-component.d2"),
    ),
  ).toBe(true);
});
```

Add the import at the top of the file:

```typescript
import { removeStaleSubmoduleDirs } from "../../src/generator/d2/cleanup.js";
```

### Step 2: Run test — expect PASS

Run: `npx vitest run tests/integration/submodule.test.ts -t "cleans a pre-existing"`
Expected: PASS.

Full suite sanity check:

Run: `npm test`
Expected: all PASS.

### Step 3: Typecheck + lint

Run: `npm run typecheck && npm run lint`
Expected: clean.

### Step 4: Commit

```bash
git add tests/integration/submodule.test.ts
git commit -m "test: end-to-end aggregator skip + cleanup via monorepo fixture"
```

---

## Verification

End-to-end check against the real charging-triad repo:

1. From `/Users/chris/Downloads/charging-triad`, run `diagram-docs generate` with the built CLI.
2. Expect console output to include `Removed: los-cha/docs/` and `Removed: los-cha/diagram-docs.yaml` (plus the two other aggregators).
3. Expect `los-cha/app/docs/architecture/c3-component.d2` to still exist and render.
4. Expect `docs/architecture/c2-container.svg` to contain container boxes for `los-cha` without a drill-down link attribute, and for `los-cha-app` with a link to `../../los-cha/app/docs/architecture/c3-component.svg`.

If an aggregator site was previously customized (marker + user content) the tool must warn instead of deleting — verify by adding a trailing line to one `c3-component.d2` and re-running `generate`.
