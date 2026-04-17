# L4 Code-Level Diagrams in Submodule Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When submodule mode is on, L4 (C4 code-level) diagrams live inside each per-app `architecture/` tree as a sibling to its C3 diagram, and the per-submodule C3 emits drill-down links to L4. Non-submodule mode is unchanged.

**Architecture:** Reuse the existing root L4 generator (`generateCodeDiagram`, `scaffoldCodeFile`) but route writes through `generateSubmoduleDocs` per container when `submodules.enabled`. Skip the root L4 pass in that case. Extend drift + stale-cleanup to cover the new submodule paths. Extract three pure helpers (`codeLinkableComponentIds`, language inference, submodule path resolution) into shared modules so the submodule pass and the root pass stay in sync.

**Tech Stack:** TypeScript ES modules (Node16 resolution, `.js` import suffixes), vitest with globals, existing D2 generator scaffolding.

**Working directory:** All code changes happen in the worktree at `.worktrees/c4-code-level/` on branch `feature/c4-code-level` (PR #5). The spec file lives on `main` at `docs/superpowers/specs/2026-04-18-l4-submodule-placement-design.md` — read it first.

**Reference files (read before starting):**

- Spec: `docs/superpowers/specs/2026-04-18-l4-submodule-placement-design.md` (on `main`)
- `.worktrees/c4-code-level/src/cli/commands/generate.ts` — root L4 routing + `codeLinkableComponentIds` + `dominantLanguageForComponent` (currently private)
- `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts` — current C3 submodule emission, no L4
- `.worktrees/c4-code-level/src/generator/d2/code.ts`, `code-profiles.ts`, `code-scaffold.ts` — L4 generation primitives
- `.worktrees/c4-code-level/src/generator/d2/drift.ts` — current drift implementation
- `.worktrees/c4-code-level/src/generator/d2/cleanup.ts` — current `isUserModified` + `removeStaleContainerDirs`

---

## Task 1: Extract shared helpers into `src/generator/d2/code-helpers.ts`

**Why:** `submodule-scaffold.ts` (under `src/generator/d2/`) cannot import from `src/cli/commands/generate.ts` without inverting the CLI→generator dependency. Move the four helpers needed by both the existing root L4 path and the new submodule L4 path into a shared module under `src/generator/d2/`.

**Files:**

- Create: `.worktrees/c4-code-level/src/generator/d2/code-helpers.ts`
- Create: `.worktrees/c4-code-level/tests/generator/d2/code-helpers.test.ts`
- Modify: `.worktrees/c4-code-level/src/cli/commands/generate.ts`

- [ ] **Step 1: Write the failing test**

```ts
// .worktrees/c4-code-level/tests/generator/d2/code-helpers.test.ts
import { describe, it, expect } from "vitest";
import {
  codeLinkableComponentIds,
  dominantLanguageForComponent,
} from "../../../src/generator/d2/code-helpers.js";
import type {
  ArchitectureModel,
  Component,
  RawStructure,
} from "../../../src/analyzers/types.js";

const baseModel: ArchitectureModel = {
  version: 1,
  system: { name: "Sys", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "c",
      name: "C",
      technology: "TS",
      description: "",
      applicationId: "c",
    },
  ],
  components: [
    {
      id: "comp-a",
      name: "A",
      containerId: "c",
      technology: "TS",
      description: "",
      moduleIds: [],
    },
    {
      id: "comp-b",
      name: "B",
      containerId: "c",
      technology: "TS",
      description: "",
      moduleIds: [],
    },
  ],
  relationships: [],
  codeElements: [
    {
      id: "e1",
      componentId: "comp-a",
      containerId: "c",
      kind: "class",
      name: "Foo",
    },
    {
      id: "e2",
      componentId: "comp-a",
      containerId: "c",
      kind: "class",
      name: "Bar",
    },
    {
      id: "e3",
      componentId: "comp-b",
      containerId: "c",
      kind: "class",
      name: "Baz",
    },
  ],
  codeRelationships: [],
};

describe("codeLinkableComponentIds", () => {
  it("returns components meeting the minElements threshold", () => {
    const ids = codeLinkableComponentIds(baseModel, 2);
    expect([...ids].sort()).toEqual(["comp-a"]);
  });

  it("returns all components when threshold is 1", () => {
    const ids = codeLinkableComponentIds(baseModel, 1);
    expect([...ids].sort()).toEqual(["comp-a", "comp-b"]);
  });

  it("returns empty set when codeElements is undefined", () => {
    const m = { ...baseModel, codeElements: undefined };
    expect(codeLinkableComponentIds(m, 1).size).toBe(0);
  });
});

describe("dominantLanguageForComponent", () => {
  const comp: Component = {
    id: "comp-a",
    name: "A",
    containerId: "c",
    technology: "Java",
    description: "",
    moduleIds: ["mod-1"],
  };

  it("infers from rawStructure module file count", () => {
    const raw: RawStructure = {
      version: 1,
      scannedAt: "now",
      checksum: "x",
      applications: [
        {
          id: "c",
          path: "c",
          name: "C",
          language: "java",
          buildFile: "pom.xml",
          modules: [
            {
              id: "mod-1",
              path: "src/main/java",
              name: "m",
              files: ["A.java", "B.java"],
              exports: [],
              imports: [],
              metadata: {},
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
      ],
    };
    expect(dominantLanguageForComponent(comp, baseModel, raw)).toBe("java");
  });

  it("falls back to codeElements kind inference when rawStructure missing", () => {
    // Replace baseModel codeElements with kinds that disambiguate language.
    const m = {
      ...baseModel,
      codeElements: [
        {
          id: "s1",
          componentId: "comp-a",
          containerId: "c",
          kind: "struct" as const,
          name: "S",
        },
        {
          id: "t1",
          componentId: "comp-a",
          containerId: "c",
          kind: "typedef" as const,
          name: "T",
        },
      ],
    };
    expect(dominantLanguageForComponent(comp, m, undefined)).toBe("c");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/generator/d2/code-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper module**

Open `.worktrees/c4-code-level/src/cli/commands/generate.ts`, locate the four functions (`codeLinkableComponentIds`, `dominantLanguageForComponent`, `languageFromKind`, `normalizeLanguage`) and copy them verbatim into a new file:

```ts
// .worktrees/c4-code-level/src/generator/d2/code-helpers.ts
import type {
  ArchitectureModel,
  CodeElement,
  Component,
  RawStructure,
} from "../../analyzers/types.js";
import {
  selectProfileForComponent,
  type ProfileLanguage,
} from "./code-profiles.js";

/**
 * Component IDs that qualify for a C4 code-level diagram
 * (i.e. code elements ≥ minElements).
 */
export function codeLinkableComponentIds(
  model: ArchitectureModel,
  minElements: number,
): Set<string> {
  const counts = new Map<string, number>();
  for (const e of model.codeElements ?? []) {
    counts.set(e.componentId, (counts.get(e.componentId) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const [id, n] of counts) {
    if (n >= minElements) ids.add(id);
  }
  return ids;
}

export function dominantLanguageForComponent(
  component: Component,
  model: ArchitectureModel,
  rawStructure?: RawStructure,
): ProfileLanguage {
  const counts: Record<ProfileLanguage, number> = {
    java: 0,
    typescript: 0,
    python: 0,
    c: 0,
  };
  if (rawStructure) {
    for (const app of rawStructure.applications) {
      for (const mod of app.modules) {
        if (!component.moduleIds.includes(mod.id)) continue;
        const lang = normalizeLanguage(app.language);
        if (lang) counts[lang] += mod.files.length;
      }
    }
  }
  const totalFromRaw =
    counts.java + counts.typescript + counts.python + counts.c;
  if (totalFromRaw === 0) {
    for (const el of model.codeElements ?? []) {
      if (el.componentId !== component.id) continue;
      const lang = languageFromKind(el.kind);
      if (lang) counts[lang] += 1;
    }
  }
  const picked = selectProfileForComponent(counts);
  if (!picked) {
    console.error(
      `Warning: cannot infer language for component "${component.id}"; defaulting to java profile. ` +
        `Pass --model with a rawStructure or ensure components contain at least one kind-distinct element.`,
    );
    return "java";
  }
  return picked;
}

function languageFromKind(kind: CodeElement["kind"]): ProfileLanguage | null {
  switch (kind) {
    case "struct":
    case "typedef":
      return "c";
    case "type":
      return "typescript";
    case "enum":
      return "java";
    case "class":
    case "interface":
    case "function":
      return null; // ambiguous across languages
  }
}

function normalizeLanguage(raw: string): ProfileLanguage | null {
  if (raw === "java") return "java";
  if (raw === "typescript") return "typescript";
  if (raw === "python") return "python";
  if (raw === "c") return "c";
  return null;
}
```

- [ ] **Step 4: Run new test — verify it passes**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/generator/d2/code-helpers.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Replace the in-place definitions in `generate.ts` with imports**

Edit `.worktrees/c4-code-level/src/cli/commands/generate.ts`:

- Delete the four function bodies (`codeLinkableComponentIds`, `dominantLanguageForComponent`, `languageFromKind`, `normalizeLanguage`).
- Add to the import block at the top:

```ts
import {
  codeLinkableComponentIds,
  dominantLanguageForComponent,
} from "../../generator/d2/code-helpers.js";
```

- Drop any now-unused imports (`CodeElement`, `selectProfileForComponent`, `ProfileLanguage`, etc. — only if no other use remains).

- [ ] **Step 6: Run full test suite — verify no regression**

Run: `cd .worktrees/c4-code-level && npm test`
Expected: PASS, same count as before this task.

- [ ] **Step 7: Typecheck + lint**

Run: `cd .worktrees/c4-code-level && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd .worktrees/c4-code-level
git add src/generator/d2/code-helpers.ts \
        src/cli/commands/generate.ts \
        tests/generator/d2/code-helpers.test.ts
git commit -m "refactor: extract code-level helpers into generator module

Move codeLinkableComponentIds, dominantLanguageForComponent, and the
language-inference helpers from src/cli/commands/generate.ts into
src/generator/d2/code-helpers.ts so the submodule scaffold path can
reuse them without depending on the CLI command module."
```

---

## Task 2: Add `resolveSubmodulePaths` helper to `submodule-scaffold.ts`

**Why:** The path-resolution trio (`appPath`, `docsDir`, `architectureDir`) is currently inlined in `generateSubmoduleDocs` and reimplemented in `core/remove.ts`. Centralize it now so the new L4 pass, drift, and stale-cleanup all share one source of truth.

**Files:**

- Modify: `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts`
- Create: `.worktrees/c4-code-level/tests/generator/d2/submodule-paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// .worktrees/c4-code-level/tests/generator/d2/submodule-paths.test.ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { resolveSubmodulePaths } from "../../../src/generator/d2/submodule-scaffold.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import type { Config } from "../../../src/config/schema.js";
import { configSchema } from "../../../src/config/schema.js";

type Container = ArchitectureModel["containers"][number];

const cfg: Config = configSchema.parse({});
const repoRoot = "/repo";

function container(overrides: Partial<Container>): Container {
  return {
    id: "c",
    name: "C",
    technology: "TS",
    description: "",
    applicationId: "my-app",
    ...overrides,
  };
}

describe("resolveSubmodulePaths", () => {
  it("uses container.path when set", () => {
    const c = container({ path: "services/foo" });
    const r = resolveSubmodulePaths(repoRoot, c, cfg);
    expect(r.appPath).toBe("services/foo");
    expect(r.docsDir).toBe("docs");
    expect(r.architectureDir).toBe(
      path.join(repoRoot, "services/foo/docs/architecture"),
    );
  });

  it("falls back to slash-expanded applicationId when path missing", () => {
    const c = container({ applicationId: "team-foo-svc", path: undefined });
    const r = resolveSubmodulePaths(repoRoot, c, cfg);
    expect(r.appPath).toBe("team/foo/svc");
  });

  it("honours per-container docsDir override", () => {
    const overridden: Config = {
      ...cfg,
      submodules: {
        ...cfg.submodules,
        overrides: { "my-app": { docsDir: "documentation" } },
      },
    };
    const c = container({ path: "services/foo" });
    const r = resolveSubmodulePaths(repoRoot, c, overridden);
    expect(r.docsDir).toBe("documentation");
    expect(r.architectureDir).toBe(
      path.join(repoRoot, "services/foo/documentation/architecture"),
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/generator/d2/submodule-paths.test.ts`
Expected: FAIL — `resolveSubmodulePaths` not exported.

- [ ] **Step 3: Add the helper**

Edit `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts`. Add near the top, after the existing imports:

```ts
type Container = ArchitectureModel["containers"][number];

export interface SubmodulePaths {
  /** Repo-relative path from the repo root to the app directory (no leading slash). */
  appPath: string;
  /** Per-container docs dir name, after override resolution. */
  docsDir: string;
  /** Absolute path to `{repoRoot}/{appPath}/{docsDir}/architecture`. */
  architectureDir: string;
}

export function resolveSubmodulePaths(
  repoRoot: string,
  container: Container,
  config: Config,
): SubmodulePaths {
  const override = config.submodules.overrides[container.applicationId];
  const appPath = container.path ?? container.applicationId.replace(/-/g, "/");
  const docsDir = override?.docsDir ?? config.submodules.docsDir;
  const architectureDir = path.join(repoRoot, appPath, docsDir, "architecture");
  return { appPath, docsDir, architectureDir };
}
```

(`ArchitectureModel` is already imported at the top of `submodule-scaffold.ts`. The local `Container` alias mirrors the pattern used elsewhere in the file.)

Then refactor the inline computation inside `generateSubmoduleDocs`:

```ts
// inside the `for (const container of model.containers)` loop, replace the
// existing 4-line `appPath` / `docsDir` / `outputDir` block with:
const {
  appPath,
  docsDir,
  architectureDir: outputDir,
} = resolveSubmodulePaths(repoRoot, container, config);
const generatedDir = path.join(outputDir, "_generated");
```

(Variable name `outputDir` must stay because the rest of the function references it. Alias the helper's `architectureDir` to `outputDir`.)

- [ ] **Step 4: Run helper tests + the full suite — verify pass**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/generator/d2/submodule-paths.test.ts && npm test`
Expected: helper tests PASS; full suite same count as before.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/c4-code-level
git add src/generator/d2/submodule-scaffold.ts \
        tests/generator/d2/submodule-paths.test.ts
git commit -m "refactor: extract resolveSubmodulePaths helper

Centralize the {appPath, docsDir, architectureDir} trio so the new
submodule L4 pass, drift, and stale-cleanup can share one source of
truth instead of reimplementing the override + path-fallback logic."
```

---

## Task 3: Wire `codeLinks` through `generateSubmoduleDocs` for C3 emission

**Why:** Per-submodule C3 today regenerates without a `codeLinks` set, so the per-submodule diagram never emits drill-down links to L4 even when L4 exists. This change is a prerequisite for L4-in-submodule-mode being useful.

**Files:**

- Modify: `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts`
- Modify: `.worktrees/c4-code-level/src/cli/commands/generate.ts`
- Modify: `.worktrees/c4-code-level/tests/integration/submodule.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/submodule.test.ts` (inside the existing `describe("Integration: Submodule per-folder docs")` block):

```ts
it("emits drill-down links to L4 in per-submodule C3 when codeLinks supplied", () => {
  const tmpRoot = path.join(MONOREPO, "test-submodule-codelinks");
  trackDir(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { component: true, code: true },
  });
  const codeLinks = new Set(model.components.map((c) => c.id));

  generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, { codeLinks });

  // Find any per-app c3-component generated file and assert it has links.
  const subDirs = fs
    .readdirSync(tmpRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(tmpRoot, e.name));

  const sampleGenerated = subDirs
    .map((d) => {
      // Walk to find the generated c3-component.d2
      function find(dir: string): string | null {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const inner = find(full);
            if (inner) return inner;
          } else if (
            entry.name === "c3-component.d2" &&
            full.includes("_generated")
          ) {
            return full;
          }
        }
        return null;
      }
      return find(d);
    })
    .find((p): p is string => p !== null);

  expect(sampleGenerated).toBeTruthy();
  const content = fs.readFileSync(sampleGenerated!, "utf-8");
  expect(content).toMatch(/link:\s*"?\.\/components\/[^/]+\/c4-code\.svg/);
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts -t "drill-down"`
Expected: FAIL — either signature mismatch (5th arg not accepted) or content lacks `link:` tokens.

- [ ] **Step 3: Extend the `generateSubmoduleDocs` signature**

Edit `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts`:

```ts
export interface GenerateSubmoduleDocsOptions {
  codeLinks?: Set<string>;
  format?: string;
}

export function generateSubmoduleDocs(
  repoRoot: string,
  rootOutputDir: string,
  model: ArchitectureModel,
  config: Config,
  options?: GenerateSubmoduleDocsOptions,
): SubmoduleOutputInfo[] {
  // ... existing body ...
}
```

Inside the per-container loop, find the call:

```ts
const d2 = generateComponentDiagram(model, container.id);
```

Replace with:

```ts
const d2 = generateComponentDiagram(model, container.id, {
  codeLinks: options?.codeLinks,
  format: options?.format ?? config.output.format,
});
```

- [ ] **Step 4: Pass `codeLinks` from `generate.ts`**

Edit `.worktrees/c4-code-level/src/cli/commands/generate.ts`. Find the existing call:

```ts
const subResults = generateSubmoduleDocs(configDir, outputDir, model, config);
```

Compute the link set once at the top of the action (or hoist if already computed for the root L3 loop) and pass it:

```ts
const codeLinks = config.levels.code
  ? codeLinkableComponentIds(model, config.code.minElements)
  : undefined;

// ... later ...

const subResults = generateSubmoduleDocs(configDir, outputDir, model, config, {
  codeLinks,
  format: config.output.format,
});
```

If the L3 root loop already computes `codeLinks` locally, hoist that computation up so it's used by both call sites.

- [ ] **Step 5: Run new test — verify it passes**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts -t "drill-down"`
Expected: PASS.

- [ ] **Step 6: Run full suite + typecheck + lint**

Run: `cd .worktrees/c4-code-level && npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd .worktrees/c4-code-level
git add src/generator/d2/submodule-scaffold.ts \
        src/cli/commands/generate.ts \
        tests/integration/submodule.test.ts
git commit -m "feat: emit C3→L4 drill-down links in per-submodule diagrams

Thread codeLinks through generateSubmoduleDocs so the per-submodule
c3-component.d2 renders the same drill-down links as the root C3.
Without this the submodule C3 had no path to reach L4 even when L4
existed."
```

---

## Task 4: Add submodule L4 generation pass to `generateSubmoduleDocs`

**Why:** Core of the change — write `_generated/c4-code.d2` and the user-facing scaffold under `{outputDir}/components/<compId>/` for every qualifying component in each submodule.

**Files:**

- Modify: `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts`
- Modify: `.worktrees/c4-code-level/tests/integration/submodule.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/submodule.test.ts`:

```ts
it("writes L4 diagrams under {appPath}/{docsDir}/architecture/components/<compId>/", () => {
  const tmpRoot = path.join(MONOREPO, "test-submodule-l4");
  trackDir(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
  // Ensure at least one component qualifies — use minElements=1
  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { component: true, code: true },
    code: { minElements: 1, includePrivate: false, includeMembers: true },
  });

  // Force at least one model component to have a code element so we can
  // assert L4 paths regardless of fixture state.
  const compId = model.components[0].id;
  const containerId = model.components[0].containerId;
  model.codeElements = [
    {
      id: `${compId}__synth1`,
      componentId: compId,
      containerId,
      kind: "class",
      name: "Synth1",
    },
  ];

  const codeLinks = new Set([compId]);
  const results = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, {
    codeLinks,
  });

  const target = results.find((r) => r.containerId === containerId);
  expect(target).toBeTruthy();
  const expectedGen = path.join(
    target!.outputDir,
    "components",
    compId,
    "_generated",
    "c4-code.d2",
  );
  const expectedScaffold = path.join(
    target!.outputDir,
    "components",
    compId,
    "c4-code.d2",
  );
  expect(fs.existsSync(expectedGen)).toBe(true);
  expect(fs.existsSync(expectedScaffold)).toBe(true);

  // Scaffold must reference the generated file via @import
  const scaffold = fs.readFileSync(expectedScaffold, "utf-8");
  expect(scaffold).toContain("...@_generated/c4-code.d2");
});

it("skips L4 components below code.minElements", () => {
  const tmpRoot = path.join(MONOREPO, "test-submodule-l4-skip");
  trackDir(tmpRoot);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
  const compId = model.components[0].id;
  const containerId = model.components[0].containerId;
  model.codeElements = [
    {
      id: `${compId}__only`,
      componentId: compId,
      containerId,
      kind: "class",
      name: "Only",
    },
  ];

  const config = configSchema.parse({
    submodules: { enabled: true },
    levels: { component: true, code: true },
    code: { minElements: 5, includePrivate: false, includeMembers: true },
  });

  const codeLinks = new Set<string>(); // none qualify
  const results = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, {
    codeLinks,
  });

  const target = results.find((r) => r.containerId === containerId);
  expect(target).toBeTruthy();
  const componentsDir = path.join(target!.outputDir, "components");
  expect(fs.existsSync(componentsDir)).toBe(false);
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts -t "L4"`
Expected: FAIL — neither the generated nor scaffold path exists.

- [ ] **Step 3: Add the L4 pass**

Edit `.worktrees/c4-code-level/src/generator/d2/submodule-scaffold.ts`. Add imports at the top:

```ts
import { generateCodeDiagram } from "./code.js";
import { scaffoldCodeFile } from "./code-scaffold.js";
import {
  codeLinkableComponentIds,
  dominantLanguageForComponent,
} from "./code-helpers.js";
import { getProfileForLanguage } from "./code-profiles.js";
import type { RawStructure } from "../../analyzers/types.js";
```

Extend the options type:

```ts
export interface GenerateSubmoduleDocsOptions {
  codeLinks?: Set<string>;
  format?: string;
  rawStructure?: RawStructure;
}
```

Inside the per-container loop, _after_ the C3 + scaffold + model fragment writes and _before_ `results.push(...)`, insert the L4 pass:

```ts
if (config.levels.code) {
  const elementCountByComponent = new Map<string, number>();
  for (const e of model.codeElements ?? []) {
    if (e.containerId !== container.id) continue;
    elementCountByComponent.set(
      e.componentId,
      (elementCountByComponent.get(e.componentId) ?? 0) + 1,
    );
  }

  for (const component of model.components.filter(
    (c) => c.containerId === container.id,
  )) {
    const count = elementCountByComponent.get(component.id) ?? 0;
    if (count < config.code.minElements) continue;

    const compDir = path.join(outputDir, "components", component.id);
    const compGenDir = path.join(compDir, "_generated");
    fs.mkdirSync(compGenDir, { recursive: true });

    try {
      const lang = dominantLanguageForComponent(
        component,
        model,
        options?.rawStructure,
      );
      const profile = getProfileForLanguage(lang);
      const d2 = generateCodeDiagram(model, component, profile);
      const genPath = path.join(compGenDir, "c4-code.d2");
      if (writeIfChanged(genPath, d2)) changed = true;
      d2Files.push(genPath);

      scaffoldCodeFile(path.join(compDir, "c4-code.d2"), {
        containerName: container.name,
        componentName: component.name,
        outputDir,
      });
      d2Files.push(path.join(compDir, "c4-code.d2"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `Warning: failed to generate L4 for "${component.id}" in "${container.id}": ${msg}`,
      );
    }
  }
}
```

(Use the existing `writeIfChanged` helper already defined in the same file. Push both generated and scaffold paths into the existing `d2Files` array so they're picked up for SVG rendering.)

- [ ] **Step 4: Run new tests — verify they pass**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts -t "L4"`
Expected: PASS — both new tests green.

- [ ] **Step 5: Run full suite + typecheck**

Run: `cd .worktrees/c4-code-level && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/c4-code-level
git add src/generator/d2/submodule-scaffold.ts \
        tests/integration/submodule.test.ts
git commit -m "feat: write L4 diagrams under per-submodule architecture dir

Each per-app architecture/ tree now emits components/<compId>/c4-code.d2
plus a generated _generated/c4-code.d2 sibling, mirroring the existing
C3 placement. Components below code.minElements are skipped. Uses the
shared dominantLanguageForComponent helper extracted in Task 1."
```

---

## Task 5: Skip root L4 in submodule mode + thread `rawStructure` through

**Why:** With L4 now produced inside `generateSubmoduleDocs`, the existing root L4 pass would double-write into `{outputDir}/containers/<cid>/components/...`. Skip it when submodules are on. Also pipe `rawStructure` through `generateSubmoduleDocs` so language inference works the same way as at root.

**Files:**

- Modify: `.worktrees/c4-code-level/src/cli/commands/generate.ts`
- Modify: `.worktrees/c4-code-level/tests/integration/submodule.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/submodule.test.ts`:

```ts
it("does not write root containers/<cid>/components/ tree when submodules enabled", async () => {
  // Use a dedicated output dir to keep this test self-contained.
  const tmpRoot = path.join(MONOREPO, "test-submodule-no-root-l4");
  const tmpOutput = path.join(MONOREPO, "test-submodule-no-root-l4-output");
  trackDir(tmpRoot);
  trackDir(tmpOutput);
  fs.mkdirSync(tmpRoot, { recursive: true });
  fs.mkdirSync(tmpOutput, { recursive: true });

  const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
  const compId = model.components[0].id;
  const containerId = model.components[0].containerId;
  model.codeElements = [
    {
      id: `${compId}__a`,
      componentId: compId,
      containerId,
      kind: "class",
      name: "A",
    },
    {
      id: `${compId}__b`,
      componentId: compId,
      containerId,
      kind: "class",
      name: "B",
    },
  ];

  // Run only the submodule pass — emulates `generate --submodules` skipping
  // the root L4 block. The assertion is that we never wrote into tmpOutput's
  // containers/<cid>/components/ tree.
  generateSubmoduleDocs(
    tmpRoot,
    tmpOutput,
    model,
    configSchema.parse({
      submodules: { enabled: true },
      levels: { component: true, code: true },
      code: { minElements: 1, includePrivate: false, includeMembers: true },
    }),
    { codeLinks: new Set([compId]) },
  );

  const rootComponentsDir = path.join(
    tmpOutput,
    "containers",
    containerId,
    "components",
  );
  expect(fs.existsSync(rootComponentsDir)).toBe(false);
});
```

This test is a **regression guard** for the helper, not the TDD driver for this task. The actual behaviour change is in `generate.ts` (skip the root L4 block in submodule mode); the TDD driver is the CLI spawn test added in Step 3 below. Run this guard first to confirm the helper itself never writes to root:

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts -t "no root L4"`
Expected: PASS — locks in current helper behaviour so any future regression in `submodule-scaffold.ts` that accidentally writes to the root tree is caught.

- [ ] **Step 2: Modify `generate.ts` to skip root L4 in submodule mode**

Edit `.worktrees/c4-code-level/src/cli/commands/generate.ts`. Locate the existing root L4 block:

```ts
if (config.levels.code) {
  const codeResult = generateCodeLevelDiagrams({
    model,
    config,
    outputDir,
    rawStructure,
  });
  filesWritten += codeResult.written;
  filesUnchanged += codeResult.unchanged;
  // ... log line ...
}
```

Wrap with the submodule-mode guard. Replace with:

```ts
const submodulesOn = options.submodules || config.submodules.enabled;

if (config.levels.code && !submodulesOn) {
  const codeResult = generateCodeLevelDiagrams({
    model,
    config,
    outputDir,
    rawStructure,
  });
  filesWritten += codeResult.written;
  filesUnchanged += codeResult.unchanged;
  const total = codeResult.written + codeResult.unchanged;
  console.error(
    `L4: ${total} component diagram(s) generated, ` +
      `${codeResult.skipped} skipped (below code.minElements=${config.code.minElements}).`,
  );
}
```

Hoist the `submodulesOn` const high enough that the existing `if (options.submodules || config.submodules.enabled)` block (which calls `generateSubmoduleDocs`) can reuse it. Replace that condition with `if (submodulesOn)`.

Pass `rawStructure` through to `generateSubmoduleDocs`:

```ts
const subResults = generateSubmoduleDocs(configDir, outputDir, model, config, {
  codeLinks,
  format: config.output.format,
  rawStructure,
});
```

Also remove the now-double-counted `d2Files.push(path.join(outputDir, "containers", ..., "c4-code.d2"))` block when `submodulesOn` — those paths come from `subResults.d2Files` instead. Existing code (around line 235 in `generate.ts`):

```ts
if (config.levels.code) {
  // ... loop building root L4 paths and pushing into d2Files ...
}
```

Wrap with `if (config.levels.code && !submodulesOn) { ... }`.

- [ ] **Step 3: Add a CLI smoke test for the routing**

Add to `tests/integration/submodule.test.ts` (or an existing CLI spawn test if you prefer — both are acceptable; integration is faster to maintain):

```ts
it("`generate --submodules --deterministic` does not create root L4 dirs", async () => {
  const tmpRoot = path.join(MONOREPO, "test-cli-submodule-no-root");
  trackDir(tmpRoot);
  // Copy the monorepo fixture to a tmp dir to keep the source clean
  fs.cpSync(MONOREPO, tmpRoot, {
    recursive: true,
    filter: (src) => !src.includes("test-"),
  });
  // Force code-level on in the copied config
  const cfgPath = path.join(tmpRoot, "diagram-docs.yaml");
  const raw = fs.readFileSync(cfgPath, "utf-8");
  const cfg = parseYaml(raw) ?? {};
  cfg.levels = { ...(cfg.levels ?? {}), code: true };
  cfg.code = { minElements: 1, includePrivate: false, includeMembers: true };
  fs.writeFileSync(cfgPath, stringifyYaml(cfg), "utf-8");

  // Spawn the CLI deterministically — uses tsx via npm run dev
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    "npm",
    ["run", "dev", "--", "generate", "--submodules", "--deterministic"],
    { cwd: tmpRoot, encoding: "utf-8" },
  );
  expect(result.status, result.stderr).toBe(0);

  const rootContainers = path.join(tmpRoot, "docs/architecture/containers");
  if (fs.existsSync(rootContainers)) {
    for (const entry of fs.readdirSync(rootContainers)) {
      const componentsDir = path.join(rootContainers, entry, "components");
      expect(fs.existsSync(componentsDir), `unexpected: ${componentsDir}`).toBe(
        false,
      );
    }
  }
});
```

> Spawn-based test runs the real CLI — slow (~5–15s). If the suite already has a faster runner, use it. The CLI must compile via `tsx` for `npm run dev`; verify the parent project has `npm run dev` declared (it does — see `package.json`).

- [ ] **Step 4: Run new tests + full suite**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/c4-code-level
git add src/cli/commands/generate.ts tests/integration/submodule.test.ts
git commit -m "feat: route L4 through generateSubmoduleDocs in submodule mode

Skip the root L4 block when submodules.enabled (or --submodules) is on.
L4 paths come from generateSubmoduleDocs.d2Files for SVG rendering.
Threads rawStructure through so language inference matches root mode."
```

---

## Task 6: Extend `checkDrift` to scan submodule L4 paths

**Why:** Drift today only walks `{outputDir}/containers/*/components/*/c4-code.d2`. With L4 living under per-submodule trees, user edits to those files escape the stale-id check.

**Files:**

- Modify: `.worktrees/c4-code-level/src/generator/d2/drift.ts`
- Modify: `.worktrees/c4-code-level/src/cli/commands/generate.ts`
- Modify: `.worktrees/c4-code-level/tests/quality/drift.test.ts` (or add `tests/generator/drift-submodule.test.ts` if quality/ is reserved)

- [ ] **Step 1: Write the failing test**

Add to `tests/quality/drift.test.ts` (or create `tests/generator/drift-submodule.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkDrift } from "../../src/generator/d2/drift.js";
import { configSchema } from "../../src/config/schema.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

describe("checkDrift — submodule L4 paths", () => {
  it("warns on stale code-element id inside per-submodule c4-code.d2", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drift-submodule-"));
    const repoRoot = path.join(tmp, "repo");
    const appPath = "services/foo";
    const archDir = path.join(repoRoot, appPath, "docs/architecture");
    const compDir = path.join(archDir, "components", "comp-a");
    fs.mkdirSync(compDir, { recursive: true });

    fs.writeFileSync(
      path.join(compDir, "c4-code.d2"),
      [
        "...@_generated/c4-code.d2",
        "# Add your customizations below this line",
        "stale_id_42.style.fill: red",
        "",
      ].join("\n"),
      "utf-8",
    );

    const model: ArchitectureModel = {
      version: 1,
      system: { name: "Sys", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "c",
          name: "C",
          technology: "TS",
          description: "",
          applicationId: "foo",
          path: appPath,
        },
      ],
      components: [
        {
          id: "comp-a",
          name: "A",
          containerId: "c",
          technology: "TS",
          description: "",
          moduleIds: [],
        },
      ],
      relationships: [],
      codeElements: [
        {
          id: "real_id_1",
          componentId: "comp-a",
          containerId: "c",
          kind: "class",
          name: "Real",
        },
      ],
      codeRelationships: [],
    };

    const config = configSchema.parse({
      submodules: { enabled: true },
    });

    const warnings = checkDrift(
      path.join(repoRoot, "docs/architecture"),
      model,
      {
        repoRoot,
        config,
      },
    );

    const matched = warnings.find((w) => w.id === "stale_id_42");
    expect(matched, JSON.stringify(warnings)).toBeTruthy();
    expect(matched!.file).toBe(path.join(compDir, "c4-code.d2"));
  });

  it("does not scan submodule L4 paths when submodules disabled", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drift-submodule-off-"));
    const repoRoot = path.join(tmp, "repo");
    const appPath = "services/foo";
    const archDir = path.join(repoRoot, appPath, "docs/architecture");
    const compDir = path.join(archDir, "components", "comp-a");
    fs.mkdirSync(compDir, { recursive: true });

    fs.writeFileSync(
      path.join(compDir, "c4-code.d2"),
      [
        "...@_generated/c4-code.d2",
        "# Add your customizations below this line",
        "stale_id_99.style.fill: red",
        "",
      ].join("\n"),
      "utf-8",
    );

    const model: ArchitectureModel = {
      version: 1,
      system: { name: "Sys", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "c",
          name: "C",
          technology: "TS",
          description: "",
          applicationId: "foo",
          path: appPath,
        },
      ],
      components: [
        {
          id: "comp-a",
          name: "A",
          containerId: "c",
          technology: "TS",
          description: "",
          moduleIds: [],
        },
      ],
      relationships: [],
      codeElements: [
        {
          id: "real_id_1",
          componentId: "comp-a",
          containerId: "c",
          kind: "class",
          name: "Real",
        },
      ],
      codeRelationships: [],
    };

    const config = configSchema.parse({
      submodules: { enabled: false },
    });

    const warnings = checkDrift(
      path.join(repoRoot, "docs/architecture"),
      model,
      {
        repoRoot,
        config,
      },
    );

    expect(warnings.find((w) => w.id === "stale_id_99")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/quality/drift.test.ts -t "submodule"`
Expected: FAIL — `checkDrift` rejects 3rd arg or scans nothing.

- [ ] **Step 3: Extend `checkDrift` signature and body**

Edit `.worktrees/c4-code-level/src/generator/d2/drift.ts`:

```ts
import { resolveSubmodulePaths } from "./submodule-scaffold.js";
import type { Config } from "../../config/schema.js";

export interface CheckDriftOptions {
  repoRoot: string;
  config: Config;
}

export function checkDrift(
  outputDir: string,
  model: ArchitectureModel,
  options?: CheckDriftOptions,
): DriftWarning[] {
  // ... existing body unchanged through the root L4 scan block ...

  // NEW: submodule L4 paths
  if (
    options?.config.submodules.enabled &&
    model.codeElements &&
    model.codeElements.length > 0
  ) {
    const codeIds = new Set<string>();
    for (const el of model.codeElements) codeIds.add(toD2Id(el.id));
    const codeOpts: DriftCheckOptions = {
      caseInsensitive: true,
      pattern: ID_PATTERNS.code,
    };
    for (const container of model.containers) {
      const { architectureDir } = resolveSubmodulePaths(
        options.repoRoot,
        container,
        options.config,
      );
      const componentsDir = path.join(architectureDir, "components");
      if (!fs.existsSync(componentsDir)) continue;
      for (const entry of fs.readdirSync(componentsDir)) {
        const codeFile = path.join(componentsDir, entry, "c4-code.d2");
        if (!fs.existsSync(codeFile)) continue;
        warnings.push(...checkFile(codeFile, codeIds, codeOpts));
      }
    }
  }

  return warnings;
}
```

- [ ] **Step 4: Update the caller in `generate.ts`**

Edit `.worktrees/c4-code-level/src/cli/commands/generate.ts`. Find:

```ts
const driftWarnings = checkDrift(outputDir, model);
```

Replace with:

```ts
const driftWarnings = checkDrift(outputDir, model, {
  repoRoot: configDir,
  config,
});
```

- [ ] **Step 5: Run new tests + full suite**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/quality/drift.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/c4-code-level
git add src/generator/d2/drift.ts \
        src/cli/commands/generate.ts \
        tests/quality/drift.test.ts
git commit -m "feat: drift-check submodule L4 user files

Extend checkDrift to walk {appPath}/{docsDir}/architecture/components/*
when submodules are enabled, using the same codeIds set as the root L4
scan so stale-ref semantics are identical across placements."
```

---

## Task 7: Add `removeStaleSubmoduleComponentDirs` and wire it into `generate`

**Why:** When a component is removed from a still-active container, the submodule `components/<compId>/` dir is orphaned. Mirror the root `removeStaleContainerDirs` semantics: drop `_generated/` always, drop scaffold + dir if no user content, warn if user-modified.

**Files:**

- Modify: `.worktrees/c4-code-level/src/generator/d2/cleanup.ts`
- Modify: `.worktrees/c4-code-level/src/cli/commands/generate.ts`
- Modify: `.worktrees/c4-code-level/tests/generator/cleanup.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/generator/cleanup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeStaleSubmoduleComponentDirs } from "../../src/generator/d2/cleanup.js";
import { configSchema } from "../../src/config/schema.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

const MARKER = "# Add your customizations below this line";

function setup(opts: { userModified: boolean }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-submodule-"));
  const repoRoot = path.join(tmp, "repo");
  const archDir = path.join(repoRoot, "services/foo/docs/architecture");
  const compDir = path.join(archDir, "components", "stale-comp");
  fs.mkdirSync(path.join(compDir, "_generated"), { recursive: true });
  fs.writeFileSync(
    path.join(compDir, "_generated/c4-code.d2"),
    "auto",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(compDir, "c4-code.d2"),
    opts.userModified ? `${MARKER}\nstale_id.style.fill: red\n` : `${MARKER}\n`,
    "utf-8",
  );
  return { tmp, repoRoot, archDir, compDir };
}

const baseModel: ArchitectureModel = {
  version: 1,
  system: { name: "Sys", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "c",
      name: "C",
      technology: "TS",
      description: "",
      applicationId: "foo",
      path: "services/foo",
    },
  ],
  components: [
    // Note: NO "stale-comp" — its dir on disk is orphaned.
    {
      id: "live-comp",
      name: "Live",
      containerId: "c",
      technology: "TS",
      description: "",
      moduleIds: [],
    },
  ],
  relationships: [],
};

describe("removeStaleSubmoduleComponentDirs", () => {
  it("removes orphaned component dir when scaffold has no user content", () => {
    const { repoRoot, compDir } = setup({ userModified: false });
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleComponentDirs(repoRoot, config, baseModel);

    expect(fs.existsSync(compDir)).toBe(false);
  });

  it("preserves orphaned component dir when scaffold has user customizations", () => {
    const { repoRoot, compDir } = setup({ userModified: true });
    const config = configSchema.parse({ submodules: { enabled: true } });

    const errors: string[] = [];
    const origErr = console.error;
    console.error = (msg: string) => errors.push(msg);
    try {
      removeStaleSubmoduleComponentDirs(repoRoot, config, baseModel);
    } finally {
      console.error = origErr;
    }

    expect(fs.existsSync(compDir)).toBe(true);
    expect(errors.some((e) => e.includes("user customizations"))).toBe(true);
  });

  it("leaves active component dirs untouched", () => {
    const { repoRoot, archDir } = setup({ userModified: false });
    const liveDir = path.join(archDir, "components", "live-comp");
    fs.mkdirSync(path.join(liveDir, "_generated"), { recursive: true });
    fs.writeFileSync(
      path.join(liveDir, "_generated/c4-code.d2"),
      "auto",
      "utf-8",
    );
    fs.writeFileSync(path.join(liveDir, "c4-code.d2"), MARKER, "utf-8");

    const config = configSchema.parse({ submodules: { enabled: true } });
    removeStaleSubmoduleComponentDirs(repoRoot, config, baseModel);

    expect(fs.existsSync(liveDir)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/generator/cleanup.test.ts -t "removeStaleSubmoduleComponentDirs"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement the function**

Edit `.worktrees/c4-code-level/src/generator/d2/cleanup.ts`. Add at the bottom:

```ts
import { resolveSubmodulePaths } from "./submodule-scaffold.js";
import type { Config } from "../../config/schema.js";

/**
 * Remove submodule `components/<compId>/` dirs whose component is no longer
 * in the model for the owning container. Mirrors removeStaleContainerDirs:
 * `_generated/` is always removed; scaffold + dir are removed only when the
 * scaffold has no user content; otherwise warn and leave intact.
 */
export function removeStaleSubmoduleComponentDirs(
  repoRoot: string,
  config: Config,
  model: ArchitectureModel,
): void {
  if (!config.submodules.enabled) return;

  for (const container of model.containers) {
    const { architectureDir } = resolveSubmodulePaths(
      repoRoot,
      container,
      config,
    );
    const componentsDir = path.join(architectureDir, "components");
    if (!fs.existsSync(componentsDir)) continue;

    const activeIds = new Set(
      model.components
        .filter((c) => c.containerId === container.id)
        .map((c) => c.id),
    );

    for (const entry of fs.readdirSync(componentsDir)) {
      if (activeIds.has(entry)) continue;

      const compDir = path.join(componentsDir, entry);
      const stat = fs.statSync(compDir, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;

      const generatedDir = path.join(compDir, "_generated");
      if (fs.existsSync(generatedDir)) {
        fs.rmSync(generatedDir, { recursive: true, force: true });
      }

      const scaffoldFile = path.join(compDir, "c4-code.d2");
      const relPath = path.relative(repoRoot, scaffoldFile);

      if (isUserModified(scaffoldFile)) {
        console.error(
          `Warning: ${relPath} has user customizations — remove manually if no longer needed.`,
        );
        continue;
      }

      if (fs.existsSync(scaffoldFile)) fs.rmSync(scaffoldFile);

      const remaining = fs.readdirSync(compDir);
      if (remaining.length === 0) {
        fs.rmdirSync(compDir);
        console.error(`Removed: ${path.relative(repoRoot, compDir)}/`);
      }
    }
  }
}
```

- [ ] **Step 4: Wire into `generate.ts`**

Edit `.worktrees/c4-code-level/src/cli/commands/generate.ts`. Update the cleanup imports:

```ts
import {
  removeStaleContainerDirs,
  removeStaleSubmoduleComponentDirs,
} from "../../generator/d2/cleanup.js";
```

Find the existing call:

```ts
removeStaleContainerDirs(outputDir, model);
```

Add the submodule cleanup right after:

```ts
removeStaleContainerDirs(outputDir, model);
removeStaleSubmoduleComponentDirs(configDir, config, model);
```

- [ ] **Step 5: Run new tests + full suite**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/generator/cleanup.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/c4-code-level
git add src/generator/d2/cleanup.ts \
        src/cli/commands/generate.ts \
        tests/generator/cleanup.test.ts
git commit -m "feat: clean up orphaned per-submodule L4 component dirs

Add removeStaleSubmoduleComponentDirs mirroring the root cleanup
semantics: drop _generated/ always, drop scaffold + dir when no user
content, warn otherwise. Called from generate before L4 writes when
submodules are on."
```

---

## Task 8: Integration test — end-to-end submodule L4 round trip

**Why:** Exercise the full `scan → model → generate` pipeline with submodules + L4 enabled, including idempotence and user-edit preservation, against the real fixture.

**Files:**

- Modify: `.worktrees/c4-code-level/tests/integration/submodule.test.ts`

- [ ] **Step 1: Add the test**

Append to `tests/integration/submodule.test.ts`:

```ts
it("end-to-end: submodule mode + L4 — generate, mutate scaffold, regenerate, preserve edits", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-submodule-l4-"));
  // Copy the monorepo fixture to a tmp dir
  fs.cpSync(MONOREPO, tmp, {
    recursive: true,
    filter: (src) => !src.includes("test-"),
  });

  // Force levels.code on + minElements low enough to trigger L4
  const cfgPath = path.join(tmp, "diagram-docs.yaml");
  const cfg = parseYaml(fs.readFileSync(cfgPath, "utf-8")) ?? {};
  cfg.levels = { ...(cfg.levels ?? {}), code: true };
  cfg.code = { minElements: 1, includePrivate: false, includeMembers: true };
  cfg.submodules = { ...(cfg.submodules ?? {}), enabled: true };
  fs.writeFileSync(cfgPath, stringifyYaml(cfg), "utf-8");

  const { spawnSync } = await import("node:child_process");

  // First generate
  let result = spawnSync(
    "npm",
    ["run", "dev", "--", "generate", "--deterministic"],
    { cwd: tmp, encoding: "utf-8" },
  );
  expect(result.status, result.stderr).toBe(0);

  // Find at least one submodule L4 scaffold
  function findScaffolds(dir: string, out: string[]): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findScaffolds(full, out);
      else if (
        entry.name === "c4-code.d2" &&
        full.includes("/architecture/components/") &&
        !full.includes("/_generated/")
      ) {
        out.push(full);
      }
    }
    return out;
  }
  const scaffolds = findScaffolds(tmp, []);
  expect(scaffolds.length).toBeGreaterThan(0);

  // Append a user marker line
  const target = scaffolds[0];
  const userMark = "user_marker_42.style.fill: hotpink";
  fs.appendFileSync(target, `\n${userMark}\n`, "utf-8");

  // Second generate
  result = spawnSync(
    "npm",
    ["run", "dev", "--", "generate", "--deterministic"],
    { cwd: tmp, encoding: "utf-8" },
  );
  expect(result.status, result.stderr).toBe(0);

  // User content preserved
  const after = fs.readFileSync(target, "utf-8");
  expect(after).toContain(userMark);

  // Cleanup
  fs.rmSync(tmp, { recursive: true });
});
```

- [ ] **Step 2: Run it — verify it passes**

Run: `cd .worktrees/c4-code-level && npx vitest run tests/integration/submodule.test.ts -t "end-to-end"`
Expected: PASS. (Slow test — ~20–30s for two CLI spawns.)

- [ ] **Step 3: Final full-suite + typecheck + lint**

Run: `cd .worktrees/c4-code-level && npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd .worktrees/c4-code-level
git add tests/integration/submodule.test.ts
git commit -m "test: end-to-end submodule + L4 idempotence + user-edit preservation"
```

---

## Verification Checklist

After all tasks complete, verify against the spec:

- [ ] Submodule mode + `levels.code: true` writes L4 under `{appPath}/{docsDir}/architecture/components/<compId>/c4-code.d2` (Tasks 4, 5, 8).
- [ ] Submodule C3 emits `link: ./components/<compId>/c4-code.svg` for qualifying components (Task 3).
- [ ] Root `containers/<cid>/components/` not created in submodule mode (Task 5).
- [ ] Non-submodule mode unchanged — root L4 still produced (existing tests + Task 5 regression guard).
- [ ] `code.minElements` honoured per submodule (Task 4).
- [ ] `override.exclude` skips a container's L4 (inherits from existing C3 path — verify in `submodule-scaffold.ts` that the `override?.exclude` check happens before the L4 pass).
- [ ] `override.docsDir` honoured (Task 2 helper test + integration test path checks).
- [ ] `container.path` fallback to slash-expanded `applicationId` (Task 2).
- [ ] Scaffold create-once: re-running preserves user content below marker (Task 8).
- [ ] Drift warns on stale code-element id in submodule L4 user files (Task 6).
- [ ] Stale `components/<compId>/` removed when component dropped, scaffold has no user edits; warned + preserved otherwise (Task 7).
- [ ] `validateD2Files` runs on submodule L4 paths (paths added to `d2Files` in Task 4).

If any item is unverified, add a focused test rather than skipping.
