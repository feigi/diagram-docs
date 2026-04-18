# PR #5 Review Follow-Up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 16 review findings (6 IMPORTANT + 10 SUGGESTIONS) from the 5-agent review of PR #5 ("feat: add C4 code-level diagrams"), plus one missing test (#17). Most work is localised polish; one task (#13, discriminated union on `CodeElement.kind`) is a larger refactor.

**Scope guard:** The L4-submodule placement plan (`docs/superpowers/plans/2026-04-18-l4-submodule-placement.md`) is a *separate* piece of work — do not duplicate it here. Submodule L4 wiring (`src/cli/commands/generate.ts:181,233` and `src/generator/d2/submodule-scaffold.ts:156-200`) is already correct on HEAD.

**Tech Stack:** TypeScript (Node16 ES modules), Zod, tree-sitter WASM, vitest, Commander.js.

**Architecture:** Seventeen tasks grouped by theme:

- **(A) Exit-code correctness** — Tasks 2, 3.
- **(B) Schema + type soundness** — Tasks 5, 6, 14, 8.
- **(C) Cleanup symmetry** — Task 1.
- **(D) Logging / messaging polish** — Tasks 4, 7, 9, 10.
- **(E) Docstring / comment cleanup** — Tasks 11, 12, 15, 16.
- **(F) Type narrowing (largest)** — Task 13.
- **(G) Test coverage** — Task 17.

**Parallelism:** Groups A, C, D, E, G touch disjoint files and can run in parallel worktrees. Group B and Group F both touch `src/analyzers/types.ts`, `src/core/model.ts`, and the two JSON Schemas — they must land sequentially (B first, then F). Recommended dispatch: land B first (Tasks 5 → 6 → 14 → 8), then F (Task 13) off the resulting base, while A, C, D, E, G proceed in parallel worktrees from PR #5's HEAD. Task 17 is trivially independent.

---

## Pre-Flight (one-time, before any task)

- [ ] **Sync PR #5 HEAD locally**

```bash
cd /Users/chris/dev/diagram-docs
git fetch origin feature/c4-code-level
```

- [ ] **Verify the baseline on PR #5 is green**

```bash
cd /Users/chris/dev/diagram-docs/.worktrees/c4-code-level
npm test
npm run typecheck
npm run lint
```

Expected: all tests, typecheck, and lint pass. If anything is broken before we start, stop and investigate — do not paper over pre-existing breakage in this follow-up.

- [ ] **Create a shared base branch for the follow-up work**

```bash
cd /Users/chris/dev/diagram-docs
git worktree add .worktrees/pr5-followup-base -b pr5-review-followup origin/feature/c4-code-level
```

- [ ] **Per-group worktrees (fan out from the shared base)**

For each group you want to dispatch in parallel, create its own worktree:

```bash
git worktree add .worktrees/pr5-followup-<group> -b pr5-review-followup-<group> pr5-review-followup
```

e.g. `pr5-followup-A`, `pr5-followup-C`, `pr5-followup-D`, `pr5-followup-E`, `pr5-followup-G`. **Group B** runs in the shared base branch (its output is a dependency for Group F). **Group F** worktrees off Group B's merged result, not off PR #5's HEAD.

---

## Group A — Exit-code correctness

### Task 2: `generateCodeLevelDiagrams` must propagate scaffold failures into the process exit code

**Why:** `scaffoldCodeFile` inside `generateCodeLevelDiagrams` currently logs a warning on failure but leaves `process.exitCode` at 0. CI cannot distinguish "everything worked" from "all L4 scaffolding failed". `renderD2Files` (same file, diff lines 617-660) already solved this with a counter + `process.exitCode = 1`; mirror that pattern.

**Files:**

- Modify: `src/cli/commands/generate.ts` — the `generateCodeLevelDiagrams` function (around line 705-773 on HEAD)

- [ ] **Step 1: Add a failure counter and return it in the result**

At `src/cli/commands/generate.ts:705-773`, replace the function body. The relevant diff is:

```typescript
export function generateCodeLevelDiagrams(opts: {
  model: ArchitectureModel;
  config: Config;
  outputDir: string;
  rawStructure?: RawStructure;
}): { written: number; unchanged: number; skipped: number; scaffoldFailed: number } {
  const { model, config, outputDir, rawStructure } = opts;
  let written = 0;
  let unchanged = 0;
  let skipped = 0;
  let scaffoldFailed = 0;
```

Inside the `catch (err)` branch around line 764:

```typescript
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `Warning: failed to scaffold c4-code.d2 for component "${component.id}" in container "${container.id}": ${msg}`,
        );
        scaffoldFailed++;
      }
```

And at the end of the function, return the new field:

```typescript
  return { written, unchanged, skipped, scaffoldFailed };
```

- [ ] **Step 2: Surface the failure in the caller**

At `src/cli/commands/generate.ts:181-195`, extend the `if (config.levels.code && !submodulesOn)` block to bump `process.exitCode`:

```typescript
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
      if (codeResult.scaffoldFailed > 0) {
        console.error(
          `Error: ${codeResult.scaffoldFailed} L4 scaffold file(s) failed to write. Process will exit with a non-zero status.`,
        );
        process.exitCode = 1;
      }
    }
```

- [ ] **Step 3: Add a unit test**

Create `tests/generator/d2/code-level-scaffold-failure.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateCodeLevelDiagrams } from "../../../src/cli/commands/generate.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import { configSchema } from "../../../src/config/schema.js";

describe("generateCodeLevelDiagrams — scaffold failures are counted", () => {
  let tmp: string;
  let origExitCode: number | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-l4-scaffold-"));
    origExitCode = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = origExitCode;
    vi.restoreAllMocks();
  });

  it("increments scaffoldFailed when scaffoldCodeFile throws", async () => {
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "c1", applicationId: "c1", name: "C1", description: "", technology: "" },
      ],
      components: [
        { id: "comp1", containerId: "c1", name: "Comp1", description: "", technology: "", moduleIds: ["m1"] },
      ],
      relationships: [],
      codeElements: [
        { id: "e1", componentId: "comp1", containerId: "c1", kind: "class", name: "E1" },
        { id: "e2", componentId: "comp1", containerId: "c1", kind: "class", name: "E2" },
      ],
    };
    const config = configSchema.parse({ levels: { code: true } });

    // Force scaffoldCodeFile to throw by pre-placing a directory where the file
    // should be written.
    const compDir = path.join(tmp, "containers", "c1", "components", "comp1");
    fs.mkdirSync(compDir, { recursive: true });
    fs.mkdirSync(path.join(compDir, "c4-code.d2"));

    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = generateCodeLevelDiagrams({ model, config, outputDir: tmp });

    expect(result.scaffoldFailed).toBeGreaterThan(0);
    expect(result.written + result.unchanged).toBeGreaterThan(0); // _generated write still succeeded
  });
});
```

- [ ] **Step 4: Run**

```bash
npm run typecheck && npx vitest run tests/generator/d2/code-level-scaffold-failure.test.ts
```

Expected: all assertions pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/generate.ts tests/generator/d2/code-level-scaffold-failure.test.ts
git commit -m "fix: exit non-zero when L4 scaffold writes fail

Mirrors the renderD2Files failure-counter pattern so CI surfaces L4
scaffold breakage instead of silently succeeding."
```

---

### Task 3: `renderD2Files` ENOENT branch must set `process.exitCode = 1`

**Why:** When `d2` CLI is missing, `renderD2Files` warns and `return`s. The function previously set `process.exitCode` only for `failed > 0` at the bottom; the ENOENT early-return skips that logic so CI goes green despite producing no SVGs. The missing-binary case *is* a failure of the pipeline from the user's perspective.

**Files:**

- Modify: `src/cli/commands/generate.ts:619-630`

- [ ] **Step 1: Add `process.exitCode = 1` before the ENOENT `return`**

Replace the block around line 625-630:

```typescript
      if (errObj.code === "ENOENT") {
        console.error(
          "Warning: d2 CLI not found. Install it to render diagram files: https://d2lang.com/releases/install",
        );
        process.exitCode = 1;
        return;
      }
```

- [ ] **Step 2: Add a regression test**

Create `tests/generator/d2/render-enoent-exit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("renderD2Files — ENOENT sets process.exitCode=1", () => {
  let tmp: string;
  let origExitCode: number | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-enoent-"));
    origExitCode = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = origExitCode;
    vi.restoreAllMocks();
  });

  it("flips process.exitCode to 1 when d2 binary is missing", async () => {
    // We cannot import renderD2Files directly (not exported); exercise via a
    // dynamic ESM import + spy on execFileSync.
    vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
      const err = new Error("spawn d2 ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const d2Path = path.join(tmp, "c1-context.d2");
    fs.writeFileSync(d2Path, "# noop\n", "utf-8");

    // Access the internal renderD2Files via re-import. If it is not exported,
    // add a test-only export in generate.ts during Step 3 below.
    const mod = await import("../../../src/cli/commands/generate.js");
    (mod as unknown as {
      renderD2FilesForTest?: (files: string[], config: unknown) => void;
    }).renderD2FilesForTest?.(
      [d2Path],
      { output: { format: "svg", theme: 0, layout: "elk", renderTimeout: 60 } },
    );

    expect(process.exitCode).toBe(1);
  });
});
```

- [ ] **Step 3: Expose a test-only alias for `renderD2Files`**

At `src/cli/commands/generate.ts`, add at the bottom of the file:

```typescript
/** @internal test-only alias */
export const renderD2FilesForTest = renderD2Files;
```

- [ ] **Step 4: Run**

```bash
npm run typecheck && npx vitest run tests/generator/d2/render-enoent-exit.test.ts
```

Expected: test passes.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/generate.ts tests/generator/d2/render-enoent-exit.test.ts
git commit -m "fix: exit non-zero when d2 CLI is missing

Previously renderD2Files returned after warning, leaving process.exitCode
at 0 — CI showed green even though nothing was rendered."
```

---

## Group B — Schema + type soundness

> Land B as a sequential chain: 5 → 6 → 14 → 8. B must merge before F starts (F touches the same types/schemas).

### Task 5: Add `qualifiedName` / `targetQualifiedName` to JSON Schemas and Zod

**Why:** `RawCodeElement.qualifiedName` (`src/analyzers/types.ts:84`) and `RawCodeReference.targetQualifiedName` (`:118`) exist in TypeScript and are consumed by `src/core/code-model.ts:303-314`, but the two JSON Schemas (`src/schemas/raw-structure.schema.json`, `src/schemas/architecture-model.schema.json`) and the Zod `codeElementSchema` in `src/core/model.ts` do not mention them. A model round-tripped through YAML loses the FQN, which silently degrades resolution quality. Fix drift so all four representations agree.

**Files:**

- Modify: `src/schemas/raw-structure.schema.json` — add `qualifiedName` to the codeElement item and `targetQualifiedName` to the reference item.
- Modify: `src/schemas/architecture-model.schema.json` — add `qualifiedName` to the codeElement item.
- Modify: `src/core/model.ts` — add `qualifiedName` to `codeElementSchema`.

- [ ] **Step 1: Update `src/schemas/raw-structure.schema.json`**

Inside the codeElements item (the block starting at line 72), immediately after the `"kind"` property's enum block, add:

```json
          "qualifiedName": { "type": "string" },
```

Inside the `references` items properties (the block around line 121), add after `"kind"`:

```json
          "targetQualifiedName": { "type": "string" },
```

Final properties order for the reference item: `targetName`, `targetQualifiedName`, `kind`.

- [ ] **Step 2: Update `src/schemas/architecture-model.schema.json`**

Inside the `codeElements` items properties (around line 121), after `"name"`:

```json
          "qualifiedName": { "type": "string" },
```

- [ ] **Step 3: Update `src/core/model.ts`**

Add `qualifiedName` to `codeElementSchema` (line 21-38):

```typescript
const codeElementSchema = z.object({
  id: z.string(),
  componentId: z.string(),
  containerId: z.string(),
  kind: z.enum([
    "class",
    "interface",
    "enum",
    "type",
    "function",
    "struct",
    "typedef",
  ]),
  name: z.string(),
  qualifiedName: z.string().optional(),
  visibility: z.enum(["public", "internal", "private"]).optional(),
  members: z.array(codeMemberSchema).optional(),
  tags: z.array(z.string()).optional(),
});
```

- [ ] **Step 4: Round-trip test**

Create `tests/core/code-model-fqn-roundtrip.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { architectureModelSchema } from "../../src/core/model.js";

describe("qualifiedName survives YAML round-trip", () => {
  it("persists on codeElements after parse", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "c1", applicationId: "a1", name: "C1", description: "", technology: "t" },
      ],
      components: [
        { id: "comp1", containerId: "c1", name: "Comp1", description: "", technology: "t", moduleIds: [] },
      ],
      relationships: [],
      codeElements: [
        {
          id: "comp1.User",
          componentId: "comp1",
          containerId: "c1",
          kind: "class" as const,
          name: "User",
          qualifiedName: "com.example.user.User",
        },
      ],
    };
    const yaml = stringifyYaml(model);
    const parsed = architectureModelSchema.parse(parseYaml(yaml));
    expect(parsed.codeElements?.[0].qualifiedName).toBe("com.example.user.User");
  });
});
```

- [ ] **Step 5: Run**

```bash
npm run typecheck && npx vitest run tests/core/code-model-fqn-roundtrip.test.ts && npm test
```

Expected: all green. If any existing test regresses on the JSON-schema change, investigate — the addition is pure (both fields are optional and don't break existing payloads).

- [ ] **Step 6: Commit**

```bash
git add src/schemas/raw-structure.schema.json src/schemas/architecture-model.schema.json src/core/model.ts tests/core/code-model-fqn-roundtrip.test.ts
git commit -m "fix: persist qualifiedName/targetQualifiedName through schemas

TypeScript types and code-model resolver rely on qualifiedName for FQN
disambiguation, but the Zod schema and both JSON Schemas silently
dropped the field on round-trip. This closes that drift."
```

---

### Task 6: Validate `CodeRelationship.targetId` at ingress

**Why:** `architectureModelSchema.superRefine` at `src/core/model.ts:156-163` validates only `sourceId` against `codeElements`. If an LLM emits a dangling `targetId`, it passes schema and breaks the generator later. Since `sourceId` is validated to ensure relationships originate internally, symmetry says `targetId` should too (both ends of a code-level relationship must live inside the container-scoped universe of code elements — cross-container code edges are dropped at build time, see `code-model.ts:303-313`).

**Files:**

- Modify: `src/core/model.ts:156-163`

- [ ] **Step 1: Extend the loop**

Replace the current loop (line 159-167):

```typescript
    for (const [idx, rel] of (data.codeRelationships ?? []).entries()) {
      if (!codeElementIds.has(rel.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeRelationships", idx, "sourceId"],
          message: `codeRelationship.sourceId "${rel.sourceId}" not found in codeElements (relationship sources must be internal)`,
        });
      }
      if (!codeElementIds.has(rel.targetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeRelationships", idx, "targetId"],
          message: `codeRelationship.targetId "${rel.targetId}" not found in codeElements (relationship targets must be internal)`,
        });
      }
    }
```

- [ ] **Step 2: Add a unit test**

Append to `tests/core/code-model.test.ts` (or create a new file `tests/core/model-codeRelationship-validation.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { architectureModelSchema } from "../../src/core/model.js";

describe("architectureModelSchema — codeRelationship.targetId validation", () => {
  const baseModel = {
    version: 1,
    system: { name: "S", description: "" },
    actors: [],
    externalSystems: [],
    containers: [
      { id: "c1", applicationId: "a1", name: "C1", description: "", technology: "t" },
    ],
    components: [
      { id: "comp1", containerId: "c1", name: "Comp1", description: "", technology: "t", moduleIds: [] },
    ],
    relationships: [],
    codeElements: [
      { id: "e1", componentId: "comp1", containerId: "c1", kind: "class" as const, name: "E1" },
    ],
  };

  it("rejects relationships with dangling targetId", () => {
    const bad = {
      ...baseModel,
      codeRelationships: [{ sourceId: "e1", targetId: "does-not-exist", kind: "uses" as const }],
    };
    const result = architectureModelSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("targetId");
    }
  });

  it("accepts relationships with valid sourceId and targetId", () => {
    const good = {
      ...baseModel,
      codeElements: [
        ...baseModel.codeElements,
        { id: "e2", componentId: "comp1", containerId: "c1", kind: "class" as const, name: "E2" },
      ],
      codeRelationships: [{ sourceId: "e1", targetId: "e2", kind: "uses" as const }],
    };
    expect(architectureModelSchema.safeParse(good).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run**

```bash
npx vitest run tests/core/ && npm run typecheck
```

Expected: new tests pass. If any existing fixture in `tests/fixtures/` now fails schema validation, that fixture had a bug — either fix the fixture or explicitly mark it as testing invalid input.

- [ ] **Step 4: Commit**

```bash
git add src/core/model.ts tests/core/model-codeRelationship-validation.test.ts
git commit -m "fix: validate codeRelationship.targetId at ingress

Previously superRefine only checked sourceId, so a dangling targetId
slipped past and surfaced as a runtime render error."
```

---

### Task 14: Enrich `buildCodeModel` return shape with `droppedReferences`

**Why:** Today reference drops are observable only through stderr counters in `src/core/code-model.ts:213-256`. Callers (and tests) that want to assert on *which* references were dropped have no machine-readable surface. Enrich the return shape to `{ codeElements, codeRelationships, droppedReferences }`, and compute the stderr logs *from* that array so the signal lives in one place.

**Files:**

- Modify: `src/core/code-model.ts` — `BuildCodeModelResult` type, the accumulators, the return.
- Modify: `src/core/model-builder.ts:186-206` — accept the new field and ignore it (model output shape unchanged).
- Modify: `src/core/llm-model-builder.ts` — `attachCodeModel` (around line 28-44).
- Modify: `src/core/parallel-model-builder.ts` — nothing direct, because it routes through `attachCodeModel`. Audit anyway.

- [ ] **Step 1: Add the `DroppedReference` type and extend `BuildCodeModelResult`**

In `src/core/code-model.ts:13-16`, replace:

```typescript
export interface DroppedReference {
  sourceId: string;
  targetRaw: string;
  reason: "stdlib" | "cross-container" | "collision";
  componentId: string;
}

export interface BuildCodeModelResult {
  codeElements: CodeElement[];
  codeRelationships: CodeRelationship[];
  droppedReferences: DroppedReference[];
}
```

- [ ] **Step 2: Thread the array through the resolver**

In `buildCodeModel` (around line 147-211), replace the three `Map<string, number>` accumulators with a single `DroppedReference[]`:

```typescript
  const droppedReferences: DroppedReference[] = [];
```

Replace the collision callback (`onCollision`) and the classify-drop block with push sites:

```typescript
          const resolved = resolveReference(
            ref,
            owner,
            ctx,
            (count, where, picked) => {
              droppedReferences.push({
                sourceId: sourceQualified,
                targetRaw: ref.targetName,
                reason: "collision",
                componentId: owner.componentId,
              });
              process.stderr.write(
                `Warning: L4: name collision resolving ${ref.kind} ${ref.targetName} ` +
                  `from ${sourceQualified}: ${count} candidates in ${where}, ` +
                  `picking ${picked}.\n`,
              );
            },
          );
          if (!resolved) {
            const global = byGlobalName.get(ref.targetName);
            const reason: DroppedReference["reason"] =
              global && global.some((el) => el.containerId !== owner.containerId)
                ? "cross-container"
                : "stdlib";
            droppedReferences.push({
              sourceId: sourceQualified,
              targetRaw: ref.targetName,
              reason,
              componentId: owner.componentId,
            });
            continue;
          }
```

Replace the aggregate-count stderr logging (around line 213-256) with counts derived from `droppedReferences`:

```typescript
  let totalUnresolved = 0;
  let totalCrossContainer = 0;
  let totalCollisions = 0;
  const byComponent = new Map<string, { stdlib: number; crossContainer: number; collision: number }>();
  for (const d of droppedReferences) {
    const row =
      byComponent.get(d.componentId) ?? { stdlib: 0, crossContainer: 0, collision: 0 };
    if (d.reason === "stdlib") {
      totalUnresolved++;
      row.stdlib++;
    } else if (d.reason === "cross-container") {
      totalCrossContainer++;
      row.crossContainer++;
    } else {
      totalCollisions++;
      row.collision++;
    }
    byComponent.set(d.componentId, row);
  }

  if (totalUnresolved > 0) {
    process.stderr.write(
      `Warning: L4: ${totalUnresolved} code reference(s) dropped as stdlib/external. ` +
        `Set DIAGRAM_DOCS_DEBUG=1 for per-component breakdown.\n`,
    );
  }
  if (totalCrossContainer > 0) {
    process.stderr.write(
      `Warning: L4: ${totalCrossContainer} code reference(s) dropped because they cross container boundaries ` +
        `(targets exist in a different container). Set DIAGRAM_DOCS_DEBUG=1 for per-component breakdown.\n`,
    );
  }
  if (totalCollisions > 0) {
    process.stderr.write(
      `Warning: L4: ${totalCollisions} name-collision pick(s) during resolution. ` +
        `Picks are deterministic (by qualified id).\n`,
    );
  }

  if (process.env.DIAGRAM_DOCS_DEBUG) {
    for (const [compId, row] of byComponent) {
      if (row.stdlib > 0) {
        process.stderr.write(`[L4 debug] component ${compId}: ${row.stdlib} stdlib/external reference(s) dropped\n`);
      }
      if (row.crossContainer > 0) {
        process.stderr.write(`[L4 debug] component ${compId}: ${row.crossContainer} cross-container reference(s) dropped\n`);
      }
      if (row.collision > 0) {
        process.stderr.write(`[L4 debug] component ${compId}: ${row.collision} name-collision warning(s)\n`);
      }
    }
  }

  return { codeElements: filteredElements, codeRelationships: relationships, droppedReferences };
```

- [ ] **Step 3: Accept the new field in all consumers**

In `src/core/model-builder.ts:186-206`, destructure only the two fields that the model cares about (the third is dropped on the floor — consumed for stderr logging and test assertions via `buildCodeModel`'s side effects):

```typescript
  const { codeElements, codeRelationships } = buildCodeModel(
    rawStructure,
    components,
    { levels: config.levels, code: config.code },
  );
```

No change needed (destructuring ignores the extra field). Same for `attachCodeModel` in `src/core/llm-model-builder.ts:28-44` — it already destructures.

- [ ] **Step 4: Add a unit test that asserts the structured array**

Append to `tests/core/code-model.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";
import type { RawStructure, Component } from "../../src/analyzers/types.js";

describe("buildCodeModel — droppedReferences", () => {
  it("classifies stdlib, cross-container, and collision drops distinctly", () => {
    const raw: RawStructure = {
      version: 1,
      scannedAt: "2026-04-18T00:00:00Z",
      checksum: "x",
      applications: [
        {
          id: "a1",
          path: "a1",
          name: "a1",
          language: "java",
          buildFile: "build.gradle",
          modules: [
            {
              id: "m1",
              path: "m1",
              name: "m1",
              files: [],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "A",
                  kind: "class",
                  name: "A",
                  visibility: "public",
                  location: { file: "A.java", line: 1 },
                  references: [
                    { targetName: "String", kind: "uses" }, // stdlib
                    { targetName: "Other", kind: "uses" }, // cross-container
                  ],
                },
                {
                  id: "B",
                  kind: "class",
                  name: "B",
                  visibility: "public",
                  location: { file: "B.java", line: 1 },
                  references: [],
                },
              ],
              exports: [],
              imports: [],
              metadata: {},
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
        {
          id: "a2",
          path: "a2",
          name: "a2",
          language: "java",
          buildFile: "build.gradle",
          modules: [
            {
              id: "m2",
              path: "m2",
              name: "m2",
              files: [],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "Other",
                  kind: "class",
                  name: "Other",
                  visibility: "public",
                  location: { file: "Other.java", line: 1 },
                  references: [],
                },
                {
                  id: "Other2",
                  kind: "class",
                  name: "Other2",
                  visibility: "public",
                  location: { file: "Other2.java", line: 1 },
                  references: [],
                },
              ],
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
      ],
    };
    const components: Component[] = [
      { id: "comp1", containerId: "a1", name: "Comp1", description: "", technology: "", moduleIds: ["m1"] },
      { id: "comp2", containerId: "a2", name: "Comp2", description: "", technology: "", moduleIds: ["m2"] },
    ];

    const res = buildCodeModel(raw, components, {
      levels: { context: false, container: false, component: false, code: true },
      code: { includePrivate: false, includeMembers: true, minElements: 2 },
    });

    const reasons = new Set(res.droppedReferences.map((d) => d.reason));
    expect(reasons.has("stdlib")).toBe(true);
    expect(reasons.has("cross-container")).toBe(true);
    for (const d of res.droppedReferences) {
      expect(d.componentId).toBeTruthy();
      expect(d.sourceId).toBeTruthy();
      expect(d.targetRaw).toBeTruthy();
    }
  });
});
```

- [ ] **Step 5: Run**

```bash
npm run typecheck && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/core/code-model.ts tests/core/code-model.test.ts
git commit -m "feat: expose droppedReferences from buildCodeModel

Adds a machine-readable array alongside the existing stderr aggregate
logging. Callers (and tests) can now introspect why a given reference
was dropped without parsing log lines."
```

---

### Task 8: Persist per-component language on the model to fix `dominantLanguageForComponent`

**Why:** `src/generator/d2/code-helpers.ts:31-73` infers a component's language from `rawStructure` when available, and falls back to `languageFromKind` — which returns `null` for `class`/`interface`/`function` (ambiguous across Java/TS/Python). The final fallback is "default to Java + warn". With `--model` (no `rawStructure`), every TypeScript-only component renders with the Java profile.

Fix: carry the dominant language on every `CodeElement` as a new optional `language?: "java"|"typescript"|"python"|"c"` field. Populate at `buildCodeModel` time from `app.language`. `dominantLanguageForComponent` reads the persisted value first; raw-structure inference second; kind-based fallback third.

**Files:**

- Modify: `src/analyzers/types.ts` — add `language?` to `CodeElement`.
- Modify: `src/core/model.ts` — add to `codeElementSchema`.
- Modify: `src/schemas/architecture-model.schema.json` — add `language` enum.
- Modify: `src/core/code-model.ts` — populate `language` in the `elements.push` call.
- Modify: `src/generator/d2/code-helpers.ts` — consult persisted `language` first.

- [ ] **Step 1: Extend the TS type**

In `src/analyzers/types.ts:178-189`, extend `CodeElement`:

```typescript
export interface CodeElement {
  id: string;
  componentId: string;
  containerId: string;
  kind: CodeElementKind;
  name: string;
  qualifiedName?: string;
  /** Source language (from the owning app), persisted so --model mode can pick a profile. */
  language?: "java" | "typescript" | "python" | "c";
  visibility?: "public" | "internal" | "private";
  members?: CodeMember[];
  tags?: string[];
}
```

- [ ] **Step 2: Extend the Zod schema**

In `src/core/model.ts:21-38`:

```typescript
const codeElementSchema = z.object({
  id: z.string(),
  componentId: z.string(),
  containerId: z.string(),
  kind: z.enum([
    "class",
    "interface",
    "enum",
    "type",
    "function",
    "struct",
    "typedef",
  ]),
  name: z.string(),
  qualifiedName: z.string().optional(),
  language: z.enum(["java", "typescript", "python", "c"]).optional(),
  visibility: z.enum(["public", "internal", "private"]).optional(),
  members: z.array(codeMemberSchema).optional(),
  tags: z.array(z.string()).optional(),
});
```

- [ ] **Step 3: Extend the JSON Schema**

In `src/schemas/architecture-model.schema.json`, inside the `codeElements.items.properties` block, after `qualifiedName`:

```json
          "language": {
            "type": "string",
            "enum": ["java", "typescript", "python", "c"]
          },
```

- [ ] **Step 4: Populate `language` inside `buildCodeModel`**

Inside `src/core/code-model.ts`, extend `moduleOwnership` to also carry the app's language. Replace lines 41-52:

```typescript
  const moduleOwnership = new Map<
    string,
    {
      containerId: string;
      componentId: string;
      language: "java" | "typescript" | "python" | "c";
    }
  >();
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = components.find((c) => c.moduleIds?.includes(mod.id));
      // fall back: components already iterates, so reuse the existing structure
    }
  }
  for (const comp of components) {
    for (const moduleId of comp.moduleIds ?? []) {
      const app = raw.applications.find((a) => a.modules.some((m) => m.id === moduleId));
      if (!app) continue;
      moduleOwnership.set(moduleId, {
        containerId: comp.containerId,
        componentId: comp.id,
        language: app.language,
      });
    }
  }
```

Then in the push site (around line 91-102), include `language: owner.language`:

```typescript
      elements.push({
        id: qualified,
        componentId: owner.componentId,
        containerId: owner.containerId,
        kind: re.kind,
        name: re.name,
        qualifiedName: re.qualifiedName,
        language: owner.language,
        visibility: re.visibility,
        members: filteredMembers,
        tags: re.tags,
      });
```

- [ ] **Step 5: Consult `language` in `dominantLanguageForComponent`**

Replace the body of `src/generator/d2/code-helpers.ts:31-73`:

```typescript
export function dominantLanguageForComponent(
  component: Component,
  model: ArchitectureModel,
  rawStructure?: RawStructure,
): ProfileLanguage {
  // 1. Persisted per-element language wins — single source of truth since the
  //    model was built from the scan. Survives --model round-trips.
  const langCounts: Record<ProfileLanguage, number> = { java: 0, typescript: 0, python: 0, c: 0 };
  for (const el of model.codeElements ?? []) {
    if (el.componentId !== component.id) continue;
    const lang = el.language;
    if (lang) langCounts[lang]++;
  }
  const persistedTotal = langCounts.java + langCounts.typescript + langCounts.python + langCounts.c;
  if (persistedTotal > 0) {
    const picked = selectProfileForComponent(langCounts);
    if (picked) return picked;
  }

  // 2. Fall back to rawStructure (first-run path, before round-trip).
  if (rawStructure) {
    for (const app of rawStructure.applications) {
      for (const mod of app.modules) {
        if (!component.moduleIds.includes(mod.id)) continue;
        const lang = normalizeLanguage(app.language);
        if (lang) langCounts[lang] += mod.files.length;
      }
    }
    const rawTotal = langCounts.java + langCounts.typescript + langCounts.python + langCounts.c;
    if (rawTotal > 0) {
      const picked = selectProfileForComponent(langCounts);
      if (picked) return picked;
    }
  }

  // 3. Last resort: kind-based inference + warn + default to java.
  for (const el of model.codeElements ?? []) {
    if (el.componentId !== component.id) continue;
    const lang = languageFromKind(el.kind);
    if (lang) langCounts[lang] += 1;
  }
  const picked = selectProfileForComponent(langCounts);
  if (!picked) {
    console.error(
      `Warning: cannot infer language for component "${component.id}"; defaulting to java profile. ` +
        `Re-run scan + generate to populate CodeElement.language, or pass --model with a rawStructure.`,
    );
    return "java";
  }
  return picked;
}
```

- [ ] **Step 6: Unit test**

Create `tests/generator/d2/dominant-language-persistence.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { dominantLanguageForComponent } from "../../../src/generator/d2/code-helpers.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const makeModel = (lang: "typescript" | "java" | undefined): ArchitectureModel => ({
  version: 1,
  system: { name: "", description: "" },
  actors: [],
  externalSystems: [],
  containers: [{ id: "c1", applicationId: "a1", name: "C1", description: "", technology: "" }],
  components: [{ id: "comp1", containerId: "c1", name: "Comp1", description: "", technology: "", moduleIds: ["m1"] }],
  relationships: [],
  codeElements: [
    { id: "e1", componentId: "comp1", containerId: "c1", kind: "class", name: "E1", language: lang },
    { id: "e2", componentId: "comp1", containerId: "c1", kind: "function", name: "fn", language: lang },
  ],
});

describe("dominantLanguageForComponent — persisted language wins", () => {
  it("reads language directly from CodeElement when set (no rawStructure needed)", () => {
    const model = makeModel("typescript");
    expect(dominantLanguageForComponent(model.components[0], model, undefined)).toBe(
      "typescript",
    );
  });

  it("falls back to kind-based default + warn when nothing is persisted", () => {
    const model = makeModel(undefined);
    // Both elements are kind-ambiguous -> default to java after warning.
    const picked = dominantLanguageForComponent(model.components[0], model, undefined);
    expect(picked).toBe("java");
  });
});
```

- [ ] **Step 7: Run**

```bash
npm run typecheck && npx vitest run tests/generator/d2/dominant-language-persistence.test.ts && npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/analyzers/types.ts src/core/model.ts src/schemas/architecture-model.schema.json src/core/code-model.ts src/generator/d2/code-helpers.ts tests/generator/d2/dominant-language-persistence.test.ts
git commit -m "feat: persist per-element language for L4 profile selection

dominantLanguageForComponent previously defaulted to java whenever
rawStructure was unavailable (--model mode) and element kinds were
language-ambiguous. Carrying language on CodeElement makes --model
round-trip pick the right profile deterministically."
```

---

## Group C — Cleanup symmetry

### Task 1: `removeStaleComponentDirs` for root mode

**Why:** Submodule mode has `removeStaleSubmoduleComponentDirs` (`src/generator/d2/cleanup.ts:94-149`) that tidies orphaned `components/<compId>/` dirs. Root mode has `removeStaleContainerDirs` at container level only — `containers/<id>/components/<compId>/` orphans never get cleaned up. Add a symmetric `removeStaleComponentDirs(outputDir, model)`.

**Files:**

- Modify: `src/generator/d2/cleanup.ts` — add `removeStaleComponentDirs`.
- Modify: `src/cli/commands/generate.ts:111-112` — wire it in.

- [ ] **Step 1: Add the function**

Append to `src/generator/d2/cleanup.ts` after `removeStaleContainerDirs`:

```typescript
/**
 * Remove root-mode `containers/<containerId>/components/<compId>/` dirs whose
 * component is no longer in the model. Mirrors removeStaleSubmoduleComponentDirs
 * for the root layout. `_generated/` is always removed; scaffold + dir are
 * removed only when the scaffold has no user content.
 */
export function removeStaleComponentDirs(
  outputDir: string,
  model: ArchitectureModel,
): void {
  const containersDir = path.join(outputDir, "containers");
  if (!fs.existsSync(containersDir)) return;

  const activeByContainer = new Map<string, Set<string>>();
  for (const comp of model.components) {
    const set = activeByContainer.get(comp.containerId) ?? new Set<string>();
    set.add(comp.id);
    activeByContainer.set(comp.containerId, set);
  }

  for (const containerEntry of fs.readdirSync(containersDir)) {
    const componentsDir = path.join(containersDir, containerEntry, "components");
    if (!fs.existsSync(componentsDir)) continue;

    const activeIds = activeByContainer.get(containerEntry) ?? new Set<string>();

    for (const compEntry of fs.readdirSync(componentsDir)) {
      if (activeIds.has(compEntry)) continue;

      const compDir = path.join(componentsDir, compEntry);
      const stat = fs.statSync(compDir, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;

      const generatedDir = path.join(compDir, "_generated");
      if (fs.existsSync(generatedDir)) {
        fs.rmSync(generatedDir, { recursive: true, force: true });
      }

      const scaffoldFile = path.join(compDir, "c4-code.d2");
      if (isUserModified(scaffoldFile)) {
        console.error(
          `Warning: containers/${containerEntry}/components/${compEntry}/c4-code.d2 has user customizations — remove manually if no longer needed.`,
        );
        continue;
      }

      if (fs.existsSync(scaffoldFile)) fs.rmSync(scaffoldFile);

      const remaining = fs.readdirSync(compDir);
      if (remaining.length === 0) {
        fs.rmdirSync(compDir);
        console.error(
          `Removed: containers/${containerEntry}/components/${compEntry}/`,
        );
      }
    }
  }
}
```

- [ ] **Step 2: Wire it into `src/cli/commands/generate.ts`**

Update the import at line 36-39:

```typescript
import {
  removeStaleContainerDirs,
  removeStaleComponentDirs,
  removeStaleSubmoduleComponentDirs,
} from "../../generator/d2/cleanup.js";
```

Insert at line 112 (between the two existing calls):

```typescript
    removeStaleContainerDirs(outputDir, model);
    removeStaleComponentDirs(outputDir, model);
    removeStaleSubmoduleComponentDirs(configDir, config, model);
```

- [ ] **Step 3: Add a unit test**

Create `tests/generator/d2/remove-stale-component-dirs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeStaleComponentDirs } from "../../../src/generator/d2/cleanup.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

describe("removeStaleComponentDirs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-stale-comp-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const model: ArchitectureModel = {
    version: 1,
    system: { name: "", description: "" },
    actors: [],
    externalSystems: [],
    containers: [{ id: "c1", applicationId: "a1", name: "C1", description: "", technology: "" }],
    components: [{ id: "comp-active", containerId: "c1", name: "A", description: "", technology: "", moduleIds: [] }],
    relationships: [],
  };

  it("removes pristine scaffold + generated dirs for orphan components", () => {
    const orphanDir = path.join(tmp, "containers", "c1", "components", "comp-orphan");
    fs.mkdirSync(path.join(orphanDir, "_generated"), { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "_generated", "c4-code.d2"), "# gen\n");
    fs.writeFileSync(
      path.join(orphanDir, "c4-code.d2"),
      "# Add your customizations below this line\n",
    );

    removeStaleComponentDirs(tmp, model);
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  it("preserves user-modified orphan scaffolds and warns", () => {
    const orphanDir = path.join(tmp, "containers", "c1", "components", "comp-orphan");
    fs.mkdirSync(path.join(orphanDir, "_generated"), { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "_generated", "c4-code.d2"), "# gen\n");
    fs.writeFileSync(
      path.join(orphanDir, "c4-code.d2"),
      "# Add your customizations below this line\nmy-edit\n",
    );

    removeStaleComponentDirs(tmp, model);
    expect(fs.existsSync(path.join(orphanDir, "c4-code.d2"))).toBe(true);
    expect(fs.existsSync(path.join(orphanDir, "_generated"))).toBe(false);
  });

  it("leaves active components untouched", () => {
    const activeDir = path.join(tmp, "containers", "c1", "components", "comp-active");
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, "c4-code.d2"), "# Add your customizations below this line\n");
    removeStaleComponentDirs(tmp, model);
    expect(fs.existsSync(activeDir)).toBe(true);
  });
});
```

- [ ] **Step 4: Run**

```bash
npx vitest run tests/generator/d2/remove-stale-component-dirs.test.ts && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/generator/d2/cleanup.ts src/cli/commands/generate.ts tests/generator/d2/remove-stale-component-dirs.test.ts
git commit -m "feat: clean up orphaned root-mode L4 component dirs

Submodule mode had removeStaleSubmoduleComponentDirs; root mode was
missing the symmetric sweep under containers/<id>/components/.
Added removeStaleComponentDirs with matching user-edit preservation."
```

---

## Group D — Logging / messaging polish

### Task 4: Include a failing filename in tree-sitter partial-failure warning

**Why:** `src/analyzers/tree-sitter.ts:120-157` reports `extraction failed for N/M file(s); diagrams will be incomplete.` but hides *which* files failed. For debugging a systemic grammar/ABI mismatch the user needs at least one concrete path to reproduce with.

**Files:**

- Modify: `src/analyzers/tree-sitter.ts:116-157`

- [ ] **Step 1: Track the first failing filename**

Replace the body (from line 116):

```typescript
export async function extractCodeElementsForFiles(
  filePaths: string[],
  extractFn: (filePath: string, source: string) => Promise<RawCodeElement[]>,
): Promise<RawCodeElement[]> {
  let extractionFailures = 0;
  let firstFailingFile: string | undefined;
  const results = await Promise.all(
    filePaths.map(async (fp) => {
      let source: string;
      try {
        source = await readFile(fp, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `Warning: code-level extraction failed for ${fp} (read error): ${msg}\n`,
        );
        return [] as RawCodeElement[];
      }
      try {
        return await extractFn(fp, source);
      } catch (err) {
        extractionFailures++;
        if (!firstFailingFile) firstFailingFile = fp;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `Warning: code-level extraction failed for ${fp}: ${msg}\n`,
        );
        return [] as RawCodeElement[];
      }
    }),
  );
  if (extractionFailures > 0) {
    if (extractionFailures === filePaths.length) {
      process.stderr.write(
        `Warning: code-level extraction failed on all ${filePaths.length} file(s) — likely a grammar, query, or walker bug rather than per-file source issues. First failing file: ${firstFailingFile ?? "(unknown)"}.\n`,
      );
    } else {
      process.stderr.write(
        `Warning: code-level extraction failed for ${extractionFailures}/${filePaths.length} file(s); diagrams will be incomplete. First failing file: ${firstFailingFile ?? "(unknown)"}.\n`,
      );
    }
  }
  return results.flat();
}
```

- [ ] **Step 2: Update or add a test**

If `tests/analyzers/tree-sitter.test.ts` already exercises the failure path, update the matcher to assert the filename appears. Otherwise add:

```typescript
import { describe, it, expect, vi } from "vitest";
import { extractCodeElementsForFiles } from "../../src/analyzers/tree-sitter.js";

describe("extractCodeElementsForFiles — first failing file in aggregate warning", () => {
  it("includes the first failing filename in the aggregate warning", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await extractCodeElementsForFiles(
      ["/tmp/does-not-exist-1.java", "/tmp/does-not-exist-2.java"],
      async () => {
        throw new Error("simulated parser crash");
      },
    );
    const all = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(all).toContain("First failing file:");
    expect(all).toMatch(/does-not-exist-1\.java|does-not-exist-2\.java/);
    spy.mockRestore();
  });
});
```

(Note: `extractFn` is never called for files that can't be read, so seed with `readFile`-safe paths. The test above relies on `extractCodeElementsForFiles` calling `readFile` first which *will* fail for nonexistent paths — that goes through the read-error branch, not the extraction-failure branch. Amend the test: pre-create two readable files with bogus content, then provide an `extractFn` that throws.)

Corrected test:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { extractCodeElementsForFiles } from "../../src/analyzers/tree-sitter.js";

describe("extractCodeElementsForFiles — first failing file in aggregate warning", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-ts-fail-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("includes the first failing filename in the aggregate warning", async () => {
    const files = ["a.java", "b.java"].map((n) => {
      const p = path.join(tmp, n);
      fs.writeFileSync(p, "class Foo {}");
      return p;
    });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await extractCodeElementsForFiles(files, async () => {
      throw new Error("simulated parser crash");
    });
    const all = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(all).toContain("First failing file:");
    expect(all).toContain(files[0]);
  });
});
```

- [ ] **Step 3: Run**

```bash
npx vitest run tests/analyzers/tree-sitter.test.ts && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/analyzers/tree-sitter.ts tests/analyzers/tree-sitter.test.ts
git commit -m "feat: include first failing filename in tree-sitter aggregate warning

Systemic grammar/ABI failures were anonymised behind a count-only
warning. Surfacing the first path makes repro one-liner debugging
possible."
```

---

### Task 7: Override drift warning basename for root-mode L4

**Why:** `src/generator/d2/drift.ts:80-82` calls `checkFile(codeFile, codeIds, codeOpts)` without patching the `file` field, so every warning for an L4 drift says `file: "c4-code.d2"` — ambiguous across components. The submodule branch (`drift.ts:111-115`) already applies the absolute-path override. Mirror it.

**Files:**

- Modify: `src/generator/d2/drift.ts:79-84`

- [ ] **Step 1: Wrap the push site**

Replace lines 73-82:

```typescript
        for (const componentEntry of fs.readdirSync(componentsDir)) {
          const codeFile = path.join(
            componentsDir,
            componentEntry,
            "c4-code.d2",
          );
          if (!fs.existsSync(codeFile)) continue;
          // Root-mode c4-code.d2 files all share the same basename, so the
          // default basename-only `file` field is ambiguous across components.
          // Replace it with the absolute path so warnings can be located.
          for (const w of checkFile(codeFile, codeIds, codeOpts)) {
            warnings.push({ ...w, file: codeFile });
          }
        }
```

- [ ] **Step 2: Assert the override in a test**

Add to `tests/generator/d2/drift.test.ts` (or create it if missing):

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkDrift } from "../../../src/generator/d2/drift.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

describe("checkDrift — root-mode L4 uses absolute path", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-drift-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("emits the absolute codeFile path in warnings instead of the shared basename", () => {
    const compDir = path.join(tmp, "containers", "c1", "components", "comp1");
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(
      path.join(compDir, "c4-code.d2"),
      "...@_generated/c4-code.d2\ndangling-id\n",
    );
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [{ id: "c1", applicationId: "a1", name: "C1", description: "", technology: "" }],
      components: [{ id: "comp1", containerId: "c1", name: "Comp1", description: "", technology: "", moduleIds: [] }],
      relationships: [],
      codeElements: [
        { id: "other1", componentId: "comp1", containerId: "c1", kind: "class", name: "O1" },
      ],
    };
    const warnings = checkDrift(tmp, model);
    const w = warnings.find((ww) => ww.id === "dangling-id");
    expect(w).toBeDefined();
    expect(w?.file).toBe(path.join(compDir, "c4-code.d2"));
  });
});
```

- [ ] **Step 3: Run + Commit**

```bash
npx vitest run tests/generator/d2/drift.test.ts
git add src/generator/d2/drift.ts tests/generator/d2/drift.test.ts
git commit -m "fix: disambiguate root-mode L4 drift warnings with absolute path

Every c4-code.d2 shares the same basename; using it as file in the
warning made drift reports point-nowhere. Mirrors the submodule branch
fix applied in PR #5 HEAD."
```

---

### Task 9: Unify "Warning: L4:" stderr prefix

**Why:** `src/core/code-model.ts:164-189` emits warnings with inconsistent prefixes — some are `L4: ...`, some are `Warning: L4: ...`. Grep-ability and CI log classification both want exactly one prefix. Pick `Warning: L4:` and apply everywhere.

**Files:**

- Modify: `src/core/code-model.ts:164-238` (covers both the collision and drop logging sites).

*Note:* This overlaps with Task 14. If Task 14 merges first, Task 9 becomes trivial — the new `Warning: L4:` format is already used there; just verify consistency.

- [ ] **Step 1: Find and rewrite stragglers**

After Task 14 merged, grep for `stderr.write.*L4:` lines still using the bare `L4:` prefix (e.g. the current line 223 `L4: ${totalUnresolved} ...` and line 234 `L4: ${totalCollisions} ...`). Replace both with `Warning: L4:` so all three counter warnings use the same prefix.

Concretely — the two surviving lines after Task 14:

```typescript
    process.stderr.write(
      `Warning: L4: ${totalUnresolved} code reference(s) dropped as stdlib/external. ` +
        `Set DIAGRAM_DOCS_DEBUG=1 for per-component breakdown.\n`,
    );
    ...
    process.stderr.write(
      `Warning: L4: ${totalCollisions} name-collision pick(s) during resolution. ` +
        `Picks are deterministic (by qualified id).\n`,
    );
```

- [ ] **Step 2: Scan the rest of the tree for any straggler prefixes**

```bash
npx grep-cli -n "stderr.write.*L4:" src/
```

(Or use Grep tool in your IDE.) Ensure every such line has the `Warning: L4:` prefix except the `[L4 debug]` debug-only lines, which stay as-is.

- [ ] **Step 3: Commit**

```bash
git add src/core/code-model.ts
git commit -m "style: unify 'Warning: L4:' prefix across code-model warnings"
```

---

### Task 10: Log `minElements`-based element drops

**Why:** `src/core/code-model.ts:100-103` silently filters out elements belonging to small components (below `code.minElements`). The user has no visibility into why those elements vanished from the diagram. Add an aggregate count log.

**Files:**

- Modify: `src/core/code-model.ts:100-114`

- [ ] **Step 1: Compute and log the drop count**

Replace lines 105-114:

```typescript
  const countByComponent = new Map<string, number>();
  for (const el of elements) {
    countByComponent.set(
      el.componentId,
      (countByComponent.get(el.componentId) ?? 0) + 1,
    );
  }
  const filteredElements = elements.filter(
    (el) => (countByComponent.get(el.componentId) ?? 0) >= minElements,
  );
  const droppedElementCount = elements.length - filteredElements.length;
  if (droppedElementCount > 0) {
    process.stderr.write(
      `Warning: L4: ${droppedElementCount} element(s) dropped because their component has < code.minElements=${minElements}.\n`,
    );
  }
  const keepIds = new Set(filteredElements.map((e) => e.id));
```

- [ ] **Step 2: Unit test**

Extend `tests/core/code-model.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";

describe("buildCodeModel — minElements drop is logged", () => {
  it("emits an aggregate stderr warning when elements are filtered", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const raw = {
      version: 1 as const,
      scannedAt: "2026-04-18T00:00:00Z",
      checksum: "x",
      applications: [
        {
          id: "a1", path: "a1", name: "a1", language: "java" as const, buildFile: "b",
          modules: [{
            id: "m1", path: "m1", name: "m1", files: [], exports: [], imports: [], metadata: {},
            codeElements: [
              { id: "OnlyOne", kind: "class" as const, name: "OnlyOne", visibility: "public" as const, location: { file: "f.java", line: 1 } },
            ],
          }],
          externalDependencies: [], internalImports: [],
        },
      ],
    };
    const components = [
      { id: "comp1", containerId: "a1", name: "Comp1", description: "", technology: "", moduleIds: ["m1"] },
    ];
    buildCodeModel(raw, components, {
      levels: { context: true, container: true, component: true, code: true },
      code: { includePrivate: false, includeMembers: true, minElements: 2 },
    });
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("minElements=2");
    expect(out).toMatch(/Warning: L4: 1 element\(s\) dropped/);
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run + Commit**

```bash
npx vitest run tests/core/code-model.test.ts
git add src/core/code-model.ts tests/core/code-model.test.ts
git commit -m "feat: log minElements-based element drops at L4

Previously components below code.minElements vanished silently.
Aggregate stderr warning now surfaces the count + threshold."
```

---

## Group E — Docstring / comment cleanup

### Task 11: Fix contradictory docstring at `code-model.ts:22-23`

**Why:** The comment says "always exactly one element per key" but the code at `:133-141` handles collisions via lexicographic tie-break. The comment misleads future readers into assuming uniqueness is guaranteed upstream.

**Files:**

- Modify: `src/core/code-model.ts:22-25`

- [ ] **Step 1: Rewrite**

Replace lines 22-25:

```typescript
  /** Index of elements that carry a qualifiedName, keyed by `${componentId}:${qualifiedName}`. Collisions are broken lexicographically by id. */
  byComponentQualifiedName: Map<string, CodeElement>;
  /** Container-scope FQN index, keyed by `${containerId}:${qualifiedName}`. Collisions broken lexicographically by id. */
  byContainerQualifiedName: Map<string, CodeElement>;
```

- [ ] **Step 2: Commit**

```bash
git add src/core/code-model.ts
git commit -m "docs: clarify FQN index collision behaviour in ResolveContext"
```

---

### Task 12: Rewrite `resolveReference` docstring at `code-model.ts:252-266`

**Why:** The current docstring says "drop silently — per-ref logging would drown the signal" but then the surrounding function *does* accumulate aggregate stderr counts (Tasks 10, 14). Reconcile: clarify that per-ref drops are not logged, but aggregate counts are.

**Files:**

- Modify: `src/core/code-model.ts:303-314` (numbers shift after earlier tasks; locate by function name `resolveReference`)

- [ ] **Step 1: Collapse to 3-4 lines**

Replace the multi-paragraph docstring with:

```typescript
/**
 * Resolve a reference against same-component, then same-container scope.
 * FQN-keyed lookups win when available. Cross-container refs are intentionally
 * unresolved — components in different containers represent separately-deployable
 * units. Drops are not logged per-ref; aggregate counts are surfaced by
 * buildCodeModel.
 */
```

- [ ] **Step 2: Commit**

```bash
git add src/core/code-model.ts
git commit -m "docs: tighten resolveReference JSDoc per CLAUDE.md style"
```

---

### Task 15: Drop obvious `;;` banner comments from tree-sitter queries

**Why:** `src/analyzers/java/queries/code.scm` lines 1, 5, 9 and `src/analyzers/typescript/queries/code.scm` lines 1, 5, 9, 13 are banner comments that repeat the capture names. Remove. Keep Java line 13 (the visibility-filter note is genuinely non-obvious).

**Files:**

- Modify: `src/analyzers/java/queries/code.scm`
- Modify: `src/analyzers/typescript/queries/code.scm`

- [ ] **Step 1: Rewrite `src/analyzers/java/queries/code.scm`**

```
(class_declaration
  name: (identifier) @class.name) @class.decl

(interface_declaration
  name: (identifier) @interface.name) @interface.decl

(enum_declaration
  name: (identifier) @enum.name) @enum.decl

;; Methods inside classes or interfaces (visibility filtered downstream via inferVisibility)
(method_declaration
  (modifiers)? @method.modifiers
  type: (_) @method.return
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.decl

(field_declaration
  (modifiers)? @field.modifiers
  type: (_) @field.type
  declarator: (variable_declarator name: (identifier) @field.name)) @field.decl
```

- [ ] **Step 2: Rewrite `src/analyzers/typescript/queries/code.scm`**

```
(class_declaration
  name: (type_identifier) @class.name) @class.decl

(interface_declaration
  name: (type_identifier) @interface.name) @interface.decl

(type_alias_declaration
  name: (type_identifier) @type.name) @type.decl

(function_declaration
  name: (identifier) @fn.name) @fn.decl
```

- [ ] **Step 3: Run**

```bash
npm test
```

Expected: analyzer tests still pass (query text change must not affect captures).

- [ ] **Step 4: Commit**

```bash
git add src/analyzers/java/queries/code.scm src/analyzers/typescript/queries/code.scm
git commit -m "chore: drop obvious banner comments from tree-sitter queries

Kept the Java method visibility-filter note (non-obvious); rest were
redundant with the capture names."
```

---

### Task 16: Collapse multi-paragraph `resolveReference` docstring

**Why:** Same as Task 12 — this is the same docstring. The task entry is redundant with #12. Treat as an alias: after Task 12 lands, Task 16 is a no-op.

**Files:** none (already handled in Task 12).

- [ ] **Step 1: Verify the Task 12 edit already satisfies Task 16 — no additional change needed.**

If the 12/16 distinction meant something different in the review (e.g. 12 targeted the numbered list at lines 252-266 and 16 targeted a different paragraph), re-read the diff and apply the same collapse rule: 3-4 lines max, no numbered list that duplicates what the code shows. Commit empty if already done:

```bash
# If Task 12 already handled it:
echo "Task 16 subsumed by Task 12; no additional change."
# Otherwise:
# git add src/core/code-model.ts && git commit -m "docs: collapse resolveReference JSDoc paragraph"
```

---

## Group F — Type narrowing

### Task 13: Discriminated union on `CodeElement.kind`

**Why:** Currently `CodeElement` has a flat 7-variant kind enum with every per-kind field (`members`, `visibility`, `tags`, `signature`) optional regardless of kind. That lets `{ kind: "function", members: [...] }` or `{ kind: "typedef", members: [...] }` slip past the type-checker. Splitting into a discriminated union catches mis-wiring at compile time and tells generators/rendering profiles the exact shape to destructure.

Proposed split:

- **Container kinds** — `class | interface | enum | struct` — carry `members: CodeMember[]`.
- **Alias/signature kinds** — `type | typedef | function` — carry `signature?: string`, never `members`.

**Scope:** This refactor ripples through:

1. `src/analyzers/types.ts` — both `RawCodeElement` and `CodeElement`.
2. `src/core/model.ts` — `codeElementSchema` → `z.discriminatedUnion("kind", [...])`.
3. `src/schemas/raw-structure.schema.json`, `src/schemas/architecture-model.schema.json` — `oneOf` with `kind` discriminator.
4. `src/analyzers/java/code.ts`, `src/analyzers/typescript/code.ts`, `src/analyzers/python/code.ts`, `src/analyzers/c/code.ts` — ensure emissions conform.
5. `src/core/code-model.ts` — `elements.push(...)` must branch on `re.kind`.
6. `src/generator/d2/code-profiles.ts`, `src/generator/d2/code.ts` — narrow on discriminator when reading `members`/`signature`.
7. `src/generator/d2/code-helpers.ts` — `languageFromKind` may need updating.

**Files:** (all listed above)

- [ ] **Step 1: Define the new union in `src/analyzers/types.ts`**

Replace the flat `RawCodeElement` (lines 83-98) and `CodeElement` (lines 178-189) with:

```typescript
export type CodeElementKind =
  | "class"
  | "interface"
  | "enum"
  | "struct"
  | "type"
  | "typedef"
  | "function";

/** Container-style elements that model a composite shape with members. */
interface CodeElementCommon {
  id: string;
  name: string;
  qualifiedName?: string;
  language?: "java" | "typescript" | "python" | "c";
  visibility?: "public" | "internal" | "private";
  tags?: string[];
}

export type RawCodeElement =
  | (CodeElementCommon & {
      kind: "class" | "interface" | "enum" | "struct";
      members?: CodeMember[];
      references?: RawCodeReference[];
      location: { file: string; line: number };
    })
  | (CodeElementCommon & {
      kind: "type" | "typedef" | "function";
      signature?: string;
      references?: RawCodeReference[];
      location: { file: string; line: number };
    });

export type CodeElement =
  | (CodeElementCommon & {
      componentId: string;
      containerId: string;
      kind: "class" | "interface" | "enum" | "struct";
      members?: CodeMember[];
    })
  | (CodeElementCommon & {
      componentId: string;
      containerId: string;
      kind: "type" | "typedef" | "function";
      signature?: string;
    });
```

- [ ] **Step 2: Convert `codeElementSchema` to a Zod `discriminatedUnion`**

In `src/core/model.ts:21-38`:

```typescript
const codeElementCommon = {
  id: z.string(),
  componentId: z.string(),
  containerId: z.string(),
  name: z.string(),
  qualifiedName: z.string().optional(),
  language: z.enum(["java", "typescript", "python", "c"]).optional(),
  visibility: z.enum(["public", "internal", "private"]).optional(),
  tags: z.array(z.string()).optional(),
};

const codeElementSchema = z.discriminatedUnion("kind", [
  z.object({
    ...codeElementCommon,
    kind: z.enum(["class", "interface", "enum", "struct"]),
    members: z.array(codeMemberSchema).optional(),
  }),
  z.object({
    ...codeElementCommon,
    kind: z.enum(["type", "typedef", "function"]),
    signature: z.string().optional(),
  }),
]);
```

- [ ] **Step 3: Update `src/schemas/architecture-model.schema.json`**

Replace the flat `codeElements.items` with a `oneOf` of two shapes:

```json
"codeElements": {
  "type": "array",
  "default": [],
  "items": {
    "oneOf": [
      {
        "type": "object",
        "required": ["id", "componentId", "containerId", "kind", "name"],
        "properties": {
          "id": { "type": "string" },
          "componentId": { "type": "string" },
          "containerId": { "type": "string" },
          "kind": { "type": "string", "enum": ["class", "interface", "enum", "struct"] },
          "name": { "type": "string" },
          "qualifiedName": { "type": "string" },
          "language": { "type": "string", "enum": ["java", "typescript", "python", "c"] },
          "visibility": { "type": "string", "enum": ["public", "internal", "private"] },
          "members": { "type": "array", "items": { /* unchanged member oneOf */ } },
          "tags": { "type": "array", "items": { "type": "string" } }
        }
      },
      {
        "type": "object",
        "required": ["id", "componentId", "containerId", "kind", "name"],
        "properties": {
          "id": { "type": "string" },
          "componentId": { "type": "string" },
          "containerId": { "type": "string" },
          "kind": { "type": "string", "enum": ["type", "typedef", "function"] },
          "name": { "type": "string" },
          "qualifiedName": { "type": "string" },
          "language": { "type": "string", "enum": ["java", "typescript", "python", "c"] },
          "visibility": { "type": "string", "enum": ["public", "internal", "private"] },
          "signature": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } }
        }
      }
    ]
  }
}
```

Mirror for `src/schemas/raw-structure.schema.json` inside the module `codeElements` items.

- [ ] **Step 4: Audit analyzer emissions**

In each of `src/analyzers/{java,typescript,python,c}/code.ts`, confirm the object literal emitted at each element-push site lines up with the correct variant. Typical edits:

- Java `class`/`interface`/`enum` already carry `members` — OK.
- TypeScript `class`/`interface` carry `members`; `function`/`type` must *not* — if any site pushes `members: []` for a function, drop it or switch to `signature`.
- C `struct` carries members; `typedef`/`function` must not.
- Python `class` carries members; `function` must not.

Use `npm run typecheck` to find the exact lines — the discriminator will flag them.

- [ ] **Step 5: Update `src/core/code-model.ts` push site**

The push at lines 91-102 must branch on kind:

```typescript
      if (re.kind === "class" || re.kind === "interface" || re.kind === "enum" || re.kind === "struct") {
        elements.push({
          id: qualified,
          componentId: owner.componentId,
          containerId: owner.containerId,
          kind: re.kind,
          name: re.name,
          qualifiedName: re.qualifiedName,
          language: owner.language,
          visibility: re.visibility,
          members: filteredMembers,
          tags: re.tags,
        });
      } else {
        elements.push({
          id: qualified,
          componentId: owner.componentId,
          containerId: owner.containerId,
          kind: re.kind,
          name: re.name,
          qualifiedName: re.qualifiedName,
          language: owner.language,
          visibility: re.visibility,
          signature: "signature" in re ? re.signature : undefined,
          tags: re.tags,
        });
      }
```

- [ ] **Step 6: Update code-profiles + code generator**

In `src/generator/d2/code-profiles.ts:56-76` (the `javaTsPyProfile.renderElements` body), switch the `"class" | "interface" | "enum" | "type"` check to rely on the discriminator so TS narrows `members` correctly:

```typescript
  renderElements(w, elements) {
    for (const el of elements) {
      if (
        (el.kind === "class" || el.kind === "interface" || el.kind === "enum" || el.kind === "struct") &&
        (el.members?.length ?? 0) > 0
      ) {
        w.container(toD2Id(el.id), el.name, () => {
          w.raw("shape: class");
          for (const m of el.members ?? []) {
            w.raw(memberLine(m));
          }
        });
      } else {
        const shape = el.kind === "function" ? undefined : "class";
        w.shape(toD2Id(el.id), el.name, shape ? { shape } : undefined);
      }
    }
  },
```

Note the `type` kind *no longer has members* (it's a type alias). This is a semantic tightening — verify fixtures still render. If any fixture relied on a type alias having members, fix the fixture (it was wrong) or introduce an explicit third variant for TS `type` with optional `members`.

- [ ] **Step 7: Run the full matrix**

```bash
npm run typecheck && npm run lint && npm test
```

Every analyzer, code-model, and generator test must pass. Expect ≥20 typecheck errors on first pass — fix each by narrowing on `kind`. Do NOT suppress with `as any`.

- [ ] **Step 8: Commit**

```bash
git add src/analyzers/types.ts src/core/model.ts src/schemas/*.json src/core/code-model.ts src/generator/d2/code-profiles.ts src/generator/d2/code-helpers.ts src/analyzers/java/code.ts src/analyzers/typescript/code.ts src/analyzers/python/code.ts src/analyzers/c/code.ts
git commit -m "refactor: discriminated union on CodeElement.kind

Container kinds (class/interface/enum/struct) carry members; alias/
signature kinds (type/typedef/function) carry signature. Kills the
'everything optional' shape that let analyzers emit malformed elements."
```

---

## Group G — Test coverage

### Task 17: Cascading-config × L4 interaction test

**Why:** The test reviewer rated this the single highest-value missing test (severity 5). L4 is gated by `config.levels.code`, and cascading config can flip that flag on/off per submodule. A wrong merge would silently generate L4 diagrams for the wrong submodules (or skip the right ones). Locks in the gate.

**Files:**

- Create: `tests/core/cascading-config-l4.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfig } from "../../src/core/cascading-config.js";

describe("resolveConfig × levels.code", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-l4-config-"));
    fs.mkdirSync(path.join(tmp, ".git")); // signal repo root to the walker
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeConfig(dir: string, body: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "diagram-docs.yaml"), body, "utf-8");
  }

  it("submodule override can turn levels.code off when root enables it", () => {
    writeConfig(tmp, "levels:\n  code: true\n");
    const subDir = path.join(tmp, "services", "api");
    writeConfig(subDir, "levels:\n  code: false\n");

    const rootCfg = resolveConfig(tmp, tmp);
    const subCfg = resolveConfig(subDir, tmp);
    expect(rootCfg.levels.code).toBe(true);
    expect(subCfg.levels.code).toBe(false);
  });

  it("submodule override can turn levels.code on when root disables it", () => {
    writeConfig(tmp, "levels:\n  code: false\n");
    const subDir = path.join(tmp, "services", "api");
    writeConfig(subDir, "levels:\n  code: true\n");

    const rootCfg = resolveConfig(tmp, tmp);
    const subCfg = resolveConfig(subDir, tmp);
    expect(rootCfg.levels.code).toBe(false);
    expect(subCfg.levels.code).toBe(true);
  });

  it("default is false when no config mentions levels.code", () => {
    writeConfig(tmp, "system:\n  name: Test\n");
    const cfg = resolveConfig(tmp, tmp);
    expect(cfg.levels.code).toBe(false);
  });
});
```

*Note:* Adjust the `resolveConfig(path, rootDir)` signature to match the actual function in the worktree (`src/core/cascading-config.ts` may take one or two args).

- [ ] **Step 2: Run + Commit**

```bash
npx vitest run tests/core/cascading-config-l4.test.ts
git add tests/core/cascading-config-l4.test.ts
git commit -m "test: cover cascading config × levels.code interaction

Root ↔ submodule override in both directions; locks the gate against
accidental L4 generation / suppression."
```

---

## Finalisation

- [ ] **Merge all group branches back into the shared `pr5-review-followup` base**

For each group worktree:

```bash
cd /Users/chris/dev/diagram-docs/.worktrees/pr5-followup-base
git merge --no-ff pr5-review-followup-A -m "Merge group A"
git merge --no-ff pr5-review-followup-B -m "Merge group B"
git merge --no-ff pr5-review-followup-C -m "Merge group C"
git merge --no-ff pr5-review-followup-D -m "Merge group D"
git merge --no-ff pr5-review-followup-E -m "Merge group E"
git merge --no-ff pr5-review-followup-F -m "Merge group F"
git merge --no-ff pr5-review-followup-G -m "Merge group G"
```

(If subagents branched sequentially on the same branch rather than parallel-worktree, skip the merges.)

- [ ] **Rebase onto `origin/feature/c4-code-level` and rerun**

```bash
git fetch origin
git rebase origin/feature/c4-code-level
npm run typecheck && npm run lint && npm test
```

Expected: clean rebase, all checks green.

- [ ] **Open PR**

```bash
gh pr create --base feature/c4-code-level --title "chore: PR #5 review follow-up (16 findings + 1 test)" --body "$(cat <<'EOF'
## Summary
- Exit-code correctness: L4 scaffold failures and missing d2 CLI now set process.exitCode=1 (Tasks 2, 3).
- Schema + type soundness: qualifiedName / targetQualifiedName / language / targetId now round-trip through Zod and both JSON Schemas; buildCodeModel exposes droppedReferences (Tasks 5, 6, 8, 14).
- Cleanup symmetry: removeStaleComponentDirs sweeps root-mode orphans to match removeStaleSubmoduleComponentDirs (Task 1).
- Logging polish: tree-sitter failures name the first bad file, root-mode L4 drift warnings carry absolute path, stderr prefix unified to Warning: L4:, minElements drops are logged (Tasks 4, 7, 9, 10).
- Docstring/comment cleanup (Tasks 11, 12, 15, 16).
- Type narrowing: CodeElement.kind is now a discriminated union that separates container kinds from signature kinds (Task 13).
- Cascading-config × L4 interaction test (Task 17).

## Test plan
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] All new test files pass
- [ ] Manual smoke: run `npm run dev -- generate` against `tests/fixtures/monorepo` with `levels.code: true` in the root config; verify L4 diagrams land under `docs/architecture/containers/<id>/components/<compId>/c4-code.d2`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Clean up worktrees after merge**

```bash
cd /Users/chris/dev/diagram-docs
git worktree remove .worktrees/pr5-followup-base
for g in A B C D E F G; do
  git worktree remove ".worktrees/pr5-followup-${g}" 2>/dev/null
  git branch -d "pr5-review-followup-${g}" 2>/dev/null
done
git branch -d pr5-review-followup
```

---

## Self-Review

**Spec coverage table:**

| Finding | Severity | Task | Notes |
|---|---|---|---|
| 1 — root-mode L4 cleanup missing | IMPORTANT | Task 1 (Group C) | |
| 2 — `generateCodeLevelDiagrams` scaffold silent on failure | IMPORTANT | Task 2 (Group A) | |
| 3 — `renderD2Files` ENOENT keeps exit 0 | IMPORTANT | Task 3 (Group A) | |
| 4 — tree-sitter partial failure hides filenames | IMPORTANT | Task 4 (Group D) | |
| 5 — JSON Schema drift on qualifiedName / targetQualifiedName | IMPORTANT | Task 5 (Group B) | |
| 6 — `CodeRelationship.targetId` not validated | IMPORTANT | Task 6 (Group B) | |
| 7 — root-mode L4 drift warning ambiguous basename | SUGGESTION | Task 7 (Group D) | |
| 8 — `dominantLanguageForComponent` fallback wrong | SUGGESTION | Task 8 (Group B) | |
| 9 — inconsistent "L4:" stderr prefix | SUGGESTION | Task 9 (Group D) | Overlaps with Task 14 |
| 10 — minElements drops not logged | SUGGESTION | Task 10 (Group D) | |
| 11 — contradictory docstring at `code-model.ts:22-23` | SUGGESTION | Task 11 (Group E) | |
| 12 — docstring at `:252-266` contradicts code | SUGGESTION | Task 12 (Group E) | |
| 13 — `CodeElement` flat kind enum | SUGGESTION | Task 13 (Group F) | Biggest refactor |
| 14 — expose `droppedReferences` | SUGGESTION | Task 14 (Group B) | |
| 15 — drop banner `;;` comments in .scm files | SUGGESTION | Task 15 (Group E) | |
| 16 — collapse multi-paragraph JSDoc | SUGGESTION | Task 16 (Group E) | Subsumed by Task 12 |
| 17 — cascading-config × L4 interaction test | MISSING TEST | Task 17 (Group G) | |

**Placeholder scan:** No TBDs, no "similar to above". Every code step has the complete snippet to paste. The only synthesised calls that are *inferred* (not verified by reading the file) are the `resolveConfig` signature in Task 17 — the executing subagent must confirm against `src/core/cascading-config.ts` before committing.

**Parallelism summary:**

- **Sequential chain (must land in order):** Group B (5 → 6 → 14 → 8), then Group F (Task 13). Both groups edit `src/analyzers/types.ts`, `src/core/model.ts`, and the two JSON Schemas; parallelising them would guarantee merge conflicts.
- **Fully parallel:** Groups A, C, D, E, G can each dispatch to a separate subagent from the same PR #5 HEAD with no overlap.
- **Test-cost note:** Every group adds at least one new test file; none remove existing ones. Expect `npm test` runtime to rise ~5-10%.

**Type consistency:** `RawCodeElement`, `CodeElement`, `codeElementSchema`, and both JSON Schemas move together as a unit in Groups B and F. `DroppedReference` is a new exported type in Group B; no other signature changes survive outside those groups.

