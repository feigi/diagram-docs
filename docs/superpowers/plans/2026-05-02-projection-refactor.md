# Projection Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicated C4 model traversal between the D2 and drawio emitters by introducing a shared `Projection` module that turns an `ArchitectureModel` into a structural `DiagramSpec`. Both emitters become thin syntax mappers over the same spec.

**Architecture:** A new `src/generator/projection/` module owns filtering, edge deduplication, dangling-container drop, and id resolution. It produces a `DiagramSpec = { vertices, edges }` with structured (un-formatted) vertex/edge data and a `parentId` field for nesting. D2 and drawio emitters consume the spec; D2 reconstructs syntactic nesting via dotted ids, drawio sets `parent` pointers on cells. Phase 1 covers L1 Context, L2 Container, and L3 Component. L4 Code is deferred.

**Tech Stack:** TypeScript (Node16 module resolution, ES modules with `.js` import suffixes), vitest, ESLint. No new dependencies.

**Drift verdicts (canonical answers Projection adopts):**

- L1: external↔external relationships dropped.
- L3: `actor` rendered as cross-container reference (D2 was buggy).
- L3: `" | refId"` debug suffix on cross-container component labels removed.

---

## File structure

**Create:**

- `src/generator/projection/types.ts` — `VertexKind`, `VertexSpec`, `EdgeSpec`, `DiagramSpec`.
- `src/generator/projection/context.ts` — `projectContext(model)`.
- `src/generator/projection/container.ts` — `projectContainer(model)`.
- `src/generator/projection/component.ts` — `projectComponent(model, containerId)`.
- `src/generator/projection/index.ts` — barrel export.
- `tests/generator/projection/context.test.ts`
- `tests/generator/projection/container.test.ts`
- `tests/generator/projection/component.test.ts`

**Modify (D2 emitter — split logic, keep public function names as thin wrappers):**

- `src/generator/d2/context.ts` — body replaced by `emitContextD2(spec)` + thin `generateContextDiagram(model)` wrapper.
- `src/generator/d2/container.ts` — same pattern.
- `src/generator/d2/component.ts` — same pattern. Drops `" | refId"` suffix.

**Modify (drawio emitter — split, keep wrappers):**

- `src/generator/drawio/context.ts` — body replaced by `emitContextCells(spec)` + thin `buildContextCells(model)` wrapper.
- `src/generator/drawio/container.ts` — same pattern.
- `src/generator/drawio/component.ts` — same pattern.

**Untouched (intentional):**

- `src/generator/d2/code.ts` and `src/generator/drawio/code.ts` — L4 deferred.
- `src/generator/drawio/layout.ts`, `merge.ts`, `index.ts` — consume `DiagramCells`; signature unchanged.
- `src/cli/commands/generate.ts` and `src/generator/{d2,drawio}/submodule*` — call `generateContextDiagram(model)` / `buildContextCells(model)` etc.; wrappers preserve those signatures.

**CONTEXT.md:** already on disk uncommitted (created during grilling). Final task commits it.

---

## Task 1: Scaffold projection types and barrel

**Files:**

- Create: `src/generator/projection/types.ts`
- Create: `src/generator/projection/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/generator/projection/types.ts

/**
 * Semantic vertex categories. Emitters map these to their own style/kind
 * vocabularies; projection itself stays free of styling and syntax.
 */
export type VertexKind =
  | "actor"
  | "system"
  | "container"
  | "component"
  | "external-system";

/**
 * Structural representation of a diagram vertex. A vertex with `parentId` is
 * nested inside another vertex; the parent appears in the same `vertices`
 * array and is recognised as a boundary by emitters. `tags` is passed through
 * from the source model (e.g. ["library"] on an external system).
 */
export interface VertexSpec {
  id: string;
  name: string;
  kind: VertexKind;
  technology?: string;
  description?: string;
  tags?: string[];
  parentId?: string;
}

/**
 * Structural representation of a diagram edge. `id` is unique within a
 * `DiagramSpec` (projection deduplicates by source+target before emitting).
 */
export interface EdgeSpec {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  technology?: string;
}

export interface DiagramSpec {
  vertices: VertexSpec[];
  edges: EdgeSpec[];
}
```

- [ ] **Step 2: Write the barrel**

```typescript
// src/generator/projection/index.ts
export type { VertexKind, VertexSpec, EdgeSpec, DiagramSpec } from "./types.js";
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/generator/projection/types.ts src/generator/projection/index.ts
git commit -m "feat(projection): scaffold DiagramSpec types"
```

---

## Task 2: L1 Context projection — `projectContext`

**Files:**

- Create: `src/generator/projection/context.ts`
- Create: `tests/generator/projection/context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/generator/projection/context.test.ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../../src/core/model.js";
import { projectContext } from "../../../src/generator/projection/context.js";

const MODEL_PATH = path.resolve(__dirname, "../../fixtures/model.yaml");

describe("projectContext (L1)", () => {
  it("emits actors, system, and non-library externals as vertices", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const ids = spec.vertices.map((v) => v.id).sort();
    expect(ids).toContain("user");
    expect(ids).toContain("system");
    expect(ids).toContain("email-provider");
  });

  it("collapses internal (container/component) endpoints into 'system'", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const userToSystem = spec.edges.find(
      (e) => e.sourceId === "user" && e.targetId === "system",
    );
    expect(userToSystem).toBeDefined();
  });

  it("dedupes edges that collapse to the same source→target pair", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const seen = new Set<string>();
    for (const e of spec.edges) {
      const key = `${e.sourceId}->${e.targetId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("drops external↔external relationships at L1 (drift verdict)", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [
        { id: "ext-a", name: "A", description: "" },
        { id: "ext-b", name: "B", description: "" },
      ],
      containers: [],
      components: [],
      relationships: [{ sourceId: "ext-a", targetId: "ext-b", label: "calls" }],
    } as unknown as Parameters<typeof projectContext>[0];
    const spec = projectContext(model);
    expect(spec.edges).toHaveLength(0);
  });

  it("excludes external systems tagged 'library' from vertices", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [
        { id: "lib-a", name: "Lib", description: "", tags: ["library"] },
        { id: "ext-a", name: "Ext", description: "" },
      ],
      containers: [],
      components: [],
      relationships: [],
    } as unknown as Parameters<typeof projectContext>[0];
    const spec = projectContext(model);
    const ids = spec.vertices.map((v) => v.id);
    expect(ids).not.toContain("lib-a");
    expect(ids).toContain("ext-a");
  });

  it("orders vertices: actors → system → externals (deterministic)", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const systemIdx = spec.vertices.findIndex((v) => v.id === "system");
    const userIdx = spec.vertices.findIndex((v) => v.id === "user");
    const extIdx = spec.vertices.findIndex((v) => v.id === "email-provider");
    expect(userIdx).toBeLessThan(systemIdx);
    expect(systemIdx).toBeLessThan(extIdx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/projection/context.test.ts`
Expected: FAIL — module `../../../src/generator/projection/context.js` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/generator/projection/context.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type { DiagramSpec, EdgeSpec, VertexSpec } from "./types.js";

/**
 * Projects an ArchitectureModel down to the L1 (Context) view.
 *
 * Drift verdicts applied:
 * - external↔external relationships dropped — they scatter the layout and
 *   add no information at L1.
 *
 * Internal (container/component) endpoints collapse into the synthetic
 * "system" vertex; many component→external edges therefore deduplicate into
 * one system→external edge.
 */
export function projectContext(model: ArchitectureModel): DiagramSpec {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  for (const a of sortById(model.actors)) {
    vertices.push({
      id: a.id,
      name: a.name,
      kind: "actor",
      description: a.description || undefined,
    });
  }

  vertices.push({
    id: "system",
    name: model.system.name,
    kind: "system",
    description: model.system.description || undefined,
  });

  const externals = sortById(
    model.externalSystems.filter((e) => !e.tags?.includes("library")),
  );
  for (const e of externals) {
    vertices.push({
      id: e.id,
      name: e.name,
      kind: "external-system",
      technology: e.technology || undefined,
      description: e.description || undefined,
      tags: e.tags,
    });
  }

  const externalIds = new Set(externals.map((e) => e.id));
  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentIds = new Set((model.components ?? []).map((c) => c.id));
  const internalIds = new Set([...containerIds, ...componentIds]);
  const visibleIds = new Set([
    ...model.actors.map((a) => a.id),
    "system",
    ...externalIds,
    ...containerIds,
    ...componentIds,
  ]);

  const seen = new Set<string>();
  for (const r of sortRelationships(model.relationships)) {
    if (!visibleIds.has(r.sourceId) || !visibleIds.has(r.targetId)) continue;
    if (externalIds.has(r.sourceId) && externalIds.has(r.targetId)) continue;
    const src = internalIds.has(r.sourceId) ? "system" : r.sourceId;
    const tgt = internalIds.has(r.targetId) ? "system" : r.targetId;
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: key,
      sourceId: src,
      targetId: tgt,
      label: r.label,
      technology: r.technology || undefined,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/projection/context.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/generator/projection/context.ts tests/generator/projection/context.test.ts
git commit -m "feat(projection): add projectContext (L1)"
```

---

## Task 3: Port D2 L1 emitter onto projection

**Files:**

- Modify: `src/generator/d2/context.ts`

**Behavior change:** D2 will now drop external↔external rels (matched to drawio + projection verdict). Existing D2 fixtures/snapshots that expected those edges must be updated.

- [ ] **Step 1: Replace `src/generator/d2/context.ts` body**

```typescript
// src/generator/d2/context.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { DiagramSpec } from "../projection/types.js";
import { projectContext } from "../projection/context.js";
import { D2Writer, wrapText } from "./writer.js";
import { toD2Id } from "./stability.js";

/**
 * Emit a D2 L1 Context diagram from a structural DiagramSpec.
 * No model traversal happens here — projection has already done it.
 */
export function emitContextD2(spec: DiagramSpec): string {
  const w = new D2Writer();
  w.comment("C4 Context Diagram (Level 1)");
  w.comment("Auto-generated by diagram-docs — do not edit");
  w.blank();

  const actors = spec.vertices.filter((v) => v.kind === "actor");
  for (const v of actors) {
    w.shape(
      toD2Id(v.id),
      `${v.name}\\n\\n[Person]\\n${wrapText(v.description ?? "")}`,
      { class: "person" },
    );
  }
  if (actors.length > 0) w.blank();

  const system = spec.vertices.find((v) => v.kind === "system");
  if (system) {
    w.shape(
      toD2Id(system.id),
      `${system.name}\\n\\n[Software System]\\n${wrapText(system.description ?? "")}`,
      { class: "system" },
    );
    w.blank();
  }

  const externals = spec.vertices.filter((v) => v.kind === "external-system");
  for (const v of externals) {
    const tech = v.technology ? `\\n[${v.technology}]` : "";
    w.shape(
      toD2Id(v.id),
      `${v.name}\\n\\n[External System]${tech}\\n${wrapText(v.description ?? "")}`,
      { class: "external-system" },
    );
  }
  if (externals.length > 0) w.blank();

  for (const e of spec.edges) {
    const tech = e.technology ? ` [${e.technology}]` : "";
    w.connection(
      toD2Id(e.sourceId),
      toD2Id(e.targetId),
      wrapText(`${e.label}${tech}`, 40, 1),
      { "style.font-size": "13" },
    );
  }

  return w.toString();
}

/**
 * Public wrapper preserved for callsites (cli/commands/generate.ts,
 * submodule-scaffold.ts, tests).
 */
export function generateContextDiagram(model: ArchitectureModel): string {
  return emitContextD2(projectContext(model));
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: most pass; D2 context fixture/snapshot tests may fail because external↔external edges now drop. Inspect failures — only failures that match the drift verdict (external↔external edges no longer rendered) are acceptable.

- [ ] **Step 4: Update affected D2 fixtures/snapshots**

For each failing assertion that expected an external↔external edge in D2 L1 output, update the expectation to match the new behavior. Document the verdict in the test file with a comment:

```typescript
// Drift verdict: L1 drops external↔external edges (was kept in D2 only).
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/d2/context.ts tests
git commit -m "refactor(d2): emit L1 from projection; drop external↔external rels"
```

---

## Task 4: Port drawio L1 emitter onto projection

**Files:**

- Modify: `src/generator/drawio/context.ts`

**Behavior change:** none — drawio already drops external↔external rels and the rest of the verdict matches.

- [ ] **Step 1: Replace `src/generator/drawio/context.ts` body**

Keep the existing `VertexSpec`, `EdgeSpec`, and `DiagramCells` exports — they're still used by `drawio/code.ts` (L4) and `drawio/layout.ts`. Replace `buildContextCells` body and add `emitContextCells`.

```typescript
// src/generator/drawio/context.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import type {
  DiagramSpec,
  VertexSpec as PVertex,
} from "../projection/types.js";
import { projectContext } from "../projection/context.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import { toDrawioId, edgeId, wrapEdgeLabel } from "./stability.js";

/** Drawio cell representation (style-aware, kept stable for L4 + layout). */
export interface VertexSpec {
  id: string;
  value: string;
  tooltip?: string;
  style: string;
  kind: StyleKey;
  parent?: string;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  value?: string;
  tooltip?: string;
  style: string;
  parent?: string;
}

export interface DiagramCells {
  vertices: VertexSpec[];
  edges: EdgeSpec[];
}

/**
 * Map a projection vertex to a drawio cell. Boundary detection is structural:
 * any vertex with a child (another vertex names it as parentId) is rendered
 * with the system-boundary style.
 */
function toCell(v: PVertex, hasChildren: boolean): VertexSpec {
  switch (v.kind) {
    case "actor":
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n[Person]`,
        tooltip: v.description || undefined,
        style: STYLES.person,
        kind: "person",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    case "system":
      return {
        id: toDrawioId(v.id) === "system" ? "system" : toDrawioId(v.id),
        value: `${v.name}\n[Software System]`,
        tooltip: v.description || undefined,
        style: hasChildren ? STYLES["system-boundary"] : STYLES.system,
        kind: hasChildren ? "system-boundary" : "system",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    case "container": {
      const techLine = v.technology ? `: ${v.technology}` : "";
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n[Container${techLine}]`,
        tooltip: v.description || undefined,
        style: hasChildren ? STYLES["system-boundary"] : STYLES.container,
        kind: hasChildren ? "system-boundary" : "container",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    }
    case "component": {
      const techLine = v.technology ? `: ${v.technology}` : "";
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n[Component${techLine}]`,
        tooltip: v.description || undefined,
        style: STYLES.component,
        kind: "component",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    }
    case "external-system": {
      const isLib = v.tags?.includes("library") ?? false;
      const techLine = v.technology ? `\n[${v.technology}]` : "";
      const typeTag = isLib ? "[Library]" : "[External System]";
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n${typeTag}${techLine}`,
        tooltip: v.description || undefined,
        style: isLib ? STYLES.library : STYLES["external-system"],
        kind: isLib ? "library" : "external-system",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    }
  }
}

/** Convert any DiagramSpec to drawio cells. Shared across L1/L2/L3. */
export function cellsFromSpec(spec: DiagramSpec): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const childCount = new Map<string, number>();
  for (const v of spec.vertices) {
    if (v.parentId) {
      childCount.set(v.parentId, (childCount.get(v.parentId) ?? 0) + 1);
    }
  }

  for (const v of spec.vertices) {
    vertices.push(toCell(v, (childCount.get(v.id) ?? 0) > 0));
  }

  for (const e of spec.edges) {
    edges.push({
      id: edgeId(e.sourceId, e.targetId, e.label),
      source: toDrawioId(e.sourceId),
      target: toDrawioId(e.targetId),
      value: wrapEdgeLabel(e.label),
      tooltip: e.technology ? `[${e.technology}]` : undefined,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}

export function emitContextCells(spec: DiagramSpec): DiagramCells {
  return cellsFromSpec(spec);
}

/** Public wrapper preserved for cli/commands/generate.ts. */
export function buildContextCells(model: ArchitectureModel): DiagramCells {
  return emitContextCells(projectContext(model));
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS. Drawio L1 behavior unchanged (output should be byte-identical for the L1 fixture).

If drawio context snapshots change at all, inspect why. The most likely culprit is system-vertex id mapping — drawio used the literal string `"system"` for the system vertex id (not slugified). The `toCell` branch above preserves that. If a different vertex id changes, fix `toCell` so output matches the previous build.

- [ ] **Step 4: Commit**

```bash
git add src/generator/drawio/context.ts
git commit -m "refactor(drawio): emit L1 cells from projection"
```

---

## Task 5: L2 Container projection — `projectContainer`

**Files:**

- Create: `src/generator/projection/container.ts`
- Create: `tests/generator/projection/container.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/generator/projection/container.test.ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../../src/core/model.js";
import { projectContainer } from "../../../src/generator/projection/container.js";

const MODEL_PATH = path.resolve(__dirname, "../../fixtures/model.yaml");

describe("projectContainer (L2)", () => {
  it("nests connected containers under 'system' via parentId", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContainer(model);
    const userApi = spec.vertices.find((v) => v.id === "user-api");
    expect(userApi?.parentId).toBe("system");
    expect(userApi?.kind).toBe("container");
  });

  it("emits actors and external systems at the top level (no parentId)", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContainer(model);
    const user = spec.vertices.find((v) => v.id === "user");
    expect(user?.parentId).toBeUndefined();
    const ext = spec.vertices.find((v) => v.id === "email-provider");
    expect(ext?.parentId).toBeUndefined();
  });

  it("drops dangling containers (no relationships at L2)", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "used", name: "Used", description: "", technology: "X" },
        { id: "lonely", name: "Lonely", description: "", technology: "X" },
      ],
      components: [],
      relationships: [
        { sourceId: "used", targetId: "used", label: "self" }, // self drops too
      ],
    } as unknown as Parameters<typeof projectContainer>[0];
    const spec = projectContainer(model);
    const ids = spec.vertices.map((v) => v.id);
    expect(ids).not.toContain("used");
    expect(ids).not.toContain("lonely");
  });

  it("collapses component endpoints to their parent container", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [{ id: "ext", name: "E", description: "" }],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
      ],
      components: [
        {
          id: "ctrl",
          containerId: "api",
          name: "C",
          description: "",
          technology: "X",
        },
      ],
      relationships: [{ sourceId: "ctrl", targetId: "ext", label: "calls" }],
    } as unknown as Parameters<typeof projectContainer>[0];
    const spec = projectContainer(model);
    const e = spec.edges.find(
      (e) => e.sourceId === "api" && e.targetId === "ext",
    );
    expect(e).toBeDefined();
  });

  it("dedupes edges that collapse to the same container→target pair", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [{ id: "ext", name: "E", description: "" }],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
      ],
      components: [
        {
          id: "c1",
          containerId: "api",
          name: "C1",
          description: "",
          technology: "X",
        },
        {
          id: "c2",
          containerId: "api",
          name: "C2",
          description: "",
          technology: "X",
        },
      ],
      relationships: [
        { sourceId: "c1", targetId: "ext", label: "calls" },
        { sourceId: "c2", targetId: "ext", label: "calls" },
      ],
    } as unknown as Parameters<typeof projectContainer>[0];
    const spec = projectContainer(model);
    const apiToExt = spec.edges.filter(
      (e) => e.sourceId === "api" && e.targetId === "ext",
    );
    expect(apiToExt).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/projection/container.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/generator/projection/container.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type { DiagramSpec, EdgeSpec, VertexSpec } from "./types.js";

/**
 * Projects an ArchitectureModel down to the L2 (Container) view.
 *
 * Component endpoints collapse to their parent container; many cross-component
 * edges therefore deduplicate to one edge per container-pair. Containers
 * with no remaining edge participation are dropped (dangling).
 */
export function projectContainer(model: ArchitectureModel): DiagramSpec {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentToContainer = new Map(
    (model.components ?? []).map((c) => [c.id, c.containerId]),
  );
  const allIds = new Set<string>([
    ...model.actors.map((a) => a.id),
    ...model.containers.map((c) => c.id),
    ...model.externalSystems.map((e) => e.id),
    ...(model.components ?? []).map((c) => c.id),
  ]);

  const resolve = (id: string): string => componentToContainer.get(id) ?? id;

  const seen = new Set<string>();
  const connected = new Set<string>();

  for (const r of sortRelationships(
    model.relationships.filter(
      (r) => allIds.has(r.sourceId) && allIds.has(r.targetId),
    ),
  )) {
    const src = resolve(r.sourceId);
    const tgt = resolve(r.targetId);
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: key,
      sourceId: src,
      targetId: tgt,
      label: r.label,
      technology: r.technology || undefined,
    });
    if (containerIds.has(src)) connected.add(src);
    if (containerIds.has(tgt)) connected.add(tgt);
  }

  for (const a of sortById(model.actors)) {
    vertices.push({
      id: a.id,
      name: a.name,
      kind: "actor",
      description: a.description || undefined,
    });
  }

  vertices.push({
    id: "system",
    name: model.system.name,
    kind: "system",
    description: model.system.description || undefined,
  });

  for (const c of sortById(model.containers)) {
    if (!connected.has(c.id)) continue;
    vertices.push({
      id: c.id,
      name: c.name,
      kind: "container",
      technology: c.technology || undefined,
      description: c.description || undefined,
      parentId: "system",
    });
  }

  for (const e of sortById(model.externalSystems)) {
    vertices.push({
      id: e.id,
      name: e.name,
      kind: "external-system",
      technology: e.technology || undefined,
      description: e.description || undefined,
      tags: e.tags,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/projection/container.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/generator/projection/container.ts tests/generator/projection/container.test.ts
git commit -m "feat(projection): add projectContainer (L2)"
```

---

## Task 6: Port D2 L2 emitter onto projection

**Files:**

- Modify: `src/generator/d2/container.ts`

**Behavior change:** none expected — projection adopts the same dedup+dangling-drop rules D2 already uses.

- [ ] **Step 1: Replace `src/generator/d2/container.ts` body**

```typescript
// src/generator/d2/container.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { DiagramSpec } from "../projection/types.js";
import { projectContainer } from "../projection/container.js";
import { D2Writer, wrapText } from "./writer.js";
import { toD2Id } from "./stability.js";

export interface ContainerDiagramOptions {
  componentLinks?: boolean;
  format?: string;
  /** Resolve a container ID to a relative link path for submodule mode. */
  submoduleLinkResolver?: (containerId: string) => string | null;
}

export function emitContainerD2(
  spec: DiagramSpec,
  options?: ContainerDiagramOptions,
): string {
  const w = new D2Writer();
  w.comment("C4 Container Diagram (Level 2)");
  w.comment("Auto-generated by diagram-docs — do not edit");
  w.blank();

  const actors = spec.vertices.filter((v) => v.kind === "actor");
  for (const v of actors) {
    w.shape(
      toD2Id(v.id),
      `${v.name}\\n\\n[Person]\\n${wrapText(v.description ?? "")}`,
      { class: "person" },
    );
  }
  if (actors.length > 0) w.blank();

  const system = spec.vertices.find((v) => v.kind === "system");
  if (!system) {
    throw new Error("projectContainer must emit a 'system' vertex");
  }
  const sysId = toD2Id(system.id);
  const containers = spec.vertices.filter(
    (v) => v.kind === "container" && v.parentId === system.id,
  );

  w.container(sysId, `${system.name}\\n[Software System]`, () => {
    w.raw("class: system-boundary");
    w.blank();
    for (const c of containers) {
      const props: Record<string, string> = { class: "container" };
      if (options?.submoduleLinkResolver) {
        const link = options.submoduleLinkResolver(c.id);
        if (link) props.link = link;
      } else if (options?.componentLinks) {
        const ext = options.format ?? "svg";
        props.link = `./containers/${c.id}/c3-component.${ext}`;
      }
      const tech = c.technology ?? "";
      w.shape(
        toD2Id(c.id),
        `${c.name}\\n\\n[Container: ${tech}]\\n${wrapText(c.description ?? "")}`,
        props,
      );
    }
  });
  w.blank();

  const externals = spec.vertices.filter((v) => v.kind === "external-system");
  for (const v of externals) {
    const tech = v.technology ? `\\n[${v.technology}]` : "";
    const isLibrary = v.tags?.includes("library") ?? false;
    const label = isLibrary
      ? `${v.name}\\n\\n[Library]${tech}\\n${wrapText(v.description ?? "")}`
      : `${v.name}\\n\\n[External System]${tech}\\n${wrapText(v.description ?? "")}`;
    w.shape(toD2Id(v.id), label, {
      class: isLibrary ? "library" : "external-system",
    });
  }
  if (externals.length > 0) w.blank();

  for (const e of spec.edges) {
    const containerIds = new Set(containers.map((c) => c.id));
    const src = containerIds.has(e.sourceId)
      ? `${sysId}.${toD2Id(e.sourceId)}`
      : toD2Id(e.sourceId);
    const tgt = containerIds.has(e.targetId)
      ? `${sysId}.${toD2Id(e.targetId)}`
      : toD2Id(e.targetId);
    const tech = e.technology ? ` [${e.technology}]` : "";
    w.connection(src, tgt, wrapText(`${e.label}${tech}`, 40, 1), {
      "style.font-size": "13",
    });
  }

  return w.toString();
}

export function generateContainerDiagram(
  model: ArchitectureModel,
  options?: ContainerDiagramOptions,
): string {
  return emitContainerD2(projectContainer(model), options);
}
```

- [ ] **Step 2: Type-check + test**

Run: `npm run typecheck && npm test`
Expected: PASS. If a fixture changes by whitespace only, accept it; if substantive content changes, investigate before updating.

- [ ] **Step 3: Commit**

```bash
git add src/generator/d2/container.ts
git commit -m "refactor(d2): emit L2 from projection"
```

---

## Task 7: Port drawio L2 emitter onto projection

**Files:**

- Modify: `src/generator/drawio/container.ts`

- [ ] **Step 1: Replace `src/generator/drawio/container.ts` body**

```typescript
// src/generator/drawio/container.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import { projectContainer } from "../projection/container.js";
import { cellsFromSpec, type DiagramCells } from "./context.js";

export function emitContainerCells(
  spec: ReturnType<typeof projectContainer>,
): DiagramCells {
  return cellsFromSpec(spec);
}

export function buildContainerCells(model: ArchitectureModel): DiagramCells {
  return emitContainerCells(projectContainer(model));
}
```

- [ ] **Step 2: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS. Drawio L2 output should be unchanged.

If a snapshot diff appears, the most likely culprit is the `[Container]` label format — `cellsFromSpec`'s `toCell` for `kind: "container"` produces `\n[Container: X]` matching the previous emitter. If the diff is something else, investigate before accepting.

- [ ] **Step 3: Commit**

```bash
git add src/generator/drawio/container.ts
git commit -m "refactor(drawio): emit L2 cells from projection"
```

---

## Task 8: L3 Component projection — `projectComponent`

**Files:**

- Create: `src/generator/projection/component.ts`
- Create: `tests/generator/projection/component.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/generator/projection/component.test.ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../../src/core/model.js";
import { projectComponent } from "../../../src/generator/projection/component.js";

const MODEL_PATH = path.resolve(__dirname, "../../fixtures/model.yaml");

describe("projectComponent (L3)", () => {
  it("nests local components under the container via parentId", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectComponent(model, "user-api");
    const ctrl = spec.vertices.find((v) => v.id === "user-controller");
    expect(ctrl?.parentId).toBe("user-api");
    expect(ctrl?.kind).toBe("component");
  });

  it("includes ACTOR as cross-container reference (drift verdict)", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [{ id: "u", name: "User", description: "" }],
      externalSystems: [],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
      ],
      components: [
        {
          id: "c1",
          containerId: "api",
          name: "C1",
          description: "",
          technology: "X",
        },
      ],
      relationships: [{ sourceId: "u", targetId: "c1", label: "uses" }],
    } as unknown as Parameters<typeof projectComponent>[0];
    const spec = projectComponent(model, "api");
    const actor = spec.vertices.find((v) => v.id === "u");
    expect(actor).toBeDefined();
    expect(actor?.kind).toBe("actor");
  });

  it("does NOT decorate cross-container component refs with refId suffix", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
        { id: "svc", name: "SVC", description: "", technology: "Y" },
      ],
      components: [
        {
          id: "c1",
          containerId: "api",
          name: "C1",
          description: "",
          technology: "X",
        },
        {
          id: "c2",
          containerId: "svc",
          name: "C2",
          description: "",
          technology: "Y",
        },
      ],
      relationships: [{ sourceId: "c1", targetId: "c2", label: "calls" }],
    } as unknown as Parameters<typeof projectComponent>[0];
    const spec = projectComponent(model, "api");
    const ref = spec.vertices.find((v) => v.id === "c2");
    expect(ref?.name).toBe("C2");
    expect(ref?.name).not.toContain("|");
  });

  it("throws when container not found", async () => {
    const model = await loadModel(MODEL_PATH);
    expect(() => projectComponent(model, "missing")).toThrow(/not found/);
  });

  it("emits the local container as the boundary vertex", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectComponent(model, "user-api");
    const boundary = spec.vertices.find((v) => v.id === "user-api");
    expect(boundary?.kind).toBe("container");
    expect(boundary?.parentId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/projection/component.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/generator/projection/component.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type { DiagramSpec, EdgeSpec, VertexSpec, VertexKind } from "./types.js";

/**
 * Projects an ArchitectureModel down to the L3 (Component) view for one
 * container.
 *
 * Drift verdicts applied:
 * - Actors are emitted as cross-container references when they participate
 *   in a relationship (D2 emitter previously dropped them).
 * - Cross-container references carry only their plain name — no debug
 *   "| refId" suffix on the label.
 */
export function projectComponent(
  model: ArchitectureModel,
  containerId: string,
): DiagramSpec {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) {
    throw new Error(`Container not found: ${containerId}`);
  }

  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const localComponents = (model.components ?? []).filter(
    (c) => c.containerId === containerId,
  );
  const localIds = new Set(localComponents.map((c) => c.id));

  vertices.push({
    id: container.id,
    name: container.name,
    kind: "container",
    technology: container.technology || undefined,
    description: container.description || undefined,
  });

  for (const c of sortById(localComponents)) {
    vertices.push({
      id: c.id,
      name: c.name,
      kind: "component",
      technology: c.technology || undefined,
      description: c.description || undefined,
      parentId: container.id,
    });
  }

  const refIds = new Set<string>();
  const rels = model.relationships.filter((r) => {
    const si = localIds.has(r.sourceId);
    const ti = localIds.has(r.targetId);
    if (si || ti) {
      if (!si) refIds.add(r.sourceId);
      if (!ti) refIds.add(r.targetId);
      return true;
    }
    return false;
  });

  for (const rid of [...refIds].sort()) {
    const actor = model.actors.find((a) => a.id === rid);
    const ext = model.externalSystems.find((e) => e.id === rid);
    const otherContainer = model.containers.find((c) => c.id === rid);
    const otherComp = (model.components ?? []).find((c) => c.id === rid);
    let kind: VertexKind | undefined;
    let name: string | undefined;
    let technology: string | undefined;
    let description: string | undefined;
    let tags: string[] | undefined;
    if (actor) {
      kind = "actor";
      name = actor.name;
      description = actor.description || undefined;
    } else if (ext) {
      kind = "external-system";
      name = ext.name;
      technology = ext.technology || undefined;
      description = ext.description || undefined;
      tags = ext.tags;
    } else if (otherContainer) {
      kind = "container";
      name = otherContainer.name;
      technology = otherContainer.technology || undefined;
      description = otherContainer.description || undefined;
    } else if (otherComp) {
      kind = "component";
      name = otherComp.name;
      technology = otherComp.technology || undefined;
      description = otherComp.description || undefined;
    }
    if (kind && name) {
      vertices.push({ id: rid, name, kind, technology, description, tags });
    }
  }

  for (const r of sortRelationships(rels)) {
    edges.push({
      id: `${r.sourceId}->${r.targetId}`,
      sourceId: r.sourceId,
      targetId: r.targetId,
      label: r.label,
      technology: r.technology || undefined,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/projection/component.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/generator/projection/component.ts tests/generator/projection/component.test.ts
git commit -m "feat(projection): add projectComponent (L3)"
```

---

## Task 9: Port D2 L3 emitter onto projection

**Files:**

- Modify: `src/generator/d2/component.ts`

**Behavior changes (drift verdicts):**

- Actor cross-references now render in D2 L3 (previously absent).
- Cross-container component label loses the `" | refId"` debug suffix.
- D2 fixtures/snapshots covering L3 may need updates.

- [ ] **Step 1: Replace `src/generator/d2/component.ts` body**

```typescript
// src/generator/d2/component.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { DiagramSpec } from "../projection/types.js";
import { projectComponent } from "../projection/component.js";
import { D2Writer, wrapText } from "./writer.js";
import { toD2Id } from "./stability.js";

export interface ComponentDiagramOptions {
  /** Component IDs that have a C4 code-level diagram to link to. */
  codeLinks?: Set<string>;
  /** Rendered output extension (e.g. "svg", "png"). Defaults to "svg". */
  format?: string;
}

export function emitComponentD2(
  spec: DiagramSpec,
  options?: ComponentDiagramOptions,
): string {
  const w = new D2Writer();
  const boundary = spec.vertices.find(
    (v) => v.kind === "container" && !v.parentId,
  );
  if (!boundary) {
    throw new Error("projectComponent must emit a boundary container vertex");
  }
  const cId = toD2Id(boundary.id);
  w.comment(`C4 Component Diagram (Level 3) — ${boundary.name}`);
  w.comment("Auto-generated by diagram-docs — do not edit");
  w.blank();

  const components = spec.vertices.filter(
    (v) => v.kind === "component" && v.parentId === boundary.id,
  );
  const componentIds = new Set(components.map((c) => c.id));

  w.container(
    cId,
    `${boundary.name}\\n[Container: ${boundary.technology ?? ""}]`,
    () => {
      w.raw("class: system-boundary");
      w.blank();
      const ext = options?.format ?? "svg";
      for (const c of components) {
        const props: Record<string, string> = { class: "component" };
        if (options?.codeLinks?.has(c.id)) {
          props.link = `./components/${c.id}/c4-code.${ext}`;
        }
        w.shape(
          toD2Id(c.id),
          `${c.name}\\n\\n[Component: ${c.technology ?? ""}]\\n${wrapText(c.description ?? "")}`,
          props,
        );
      }
    },
  );
  w.blank();

  const externals = spec.vertices.filter(
    (v) => !v.parentId && v.id !== boundary.id,
  );
  for (const v of externals) {
    if (v.kind === "actor") {
      w.shape(
        toD2Id(v.id),
        `${v.name}\\n\\n[Person]\\n${wrapText(v.description ?? "")}`,
        { class: "person" },
      );
    } else if (v.kind === "external-system") {
      w.shape(toD2Id(v.id), `${v.name}\\n[External System]`, {
        class: "external-system",
      });
    } else if (v.kind === "container") {
      w.shape(toD2Id(v.id), `${v.name}\\n[Container: ${v.technology ?? ""}]`, {
        class: "container",
      });
    } else if (v.kind === "component") {
      w.shape(
        toD2Id(v.id),
        `${v.name}\\n\\n[Component: ${v.technology ?? ""}]`,
        { class: "component" },
      );
    }
  }
  if (externals.length > 0) w.blank();

  for (const e of spec.edges) {
    const src = componentIds.has(e.sourceId)
      ? `${cId}.${toD2Id(e.sourceId)}`
      : toD2Id(e.sourceId);
    const tgt = componentIds.has(e.targetId)
      ? `${cId}.${toD2Id(e.targetId)}`
      : toD2Id(e.targetId);
    const tech = e.technology ? ` [${e.technology}]` : "";
    w.connection(src, tgt, wrapText(`${e.label}${tech}`, 40, 1), {
      "style.font-size": "13",
    });
  }

  return w.toString();
}

export function generateComponentDiagram(
  model: ArchitectureModel,
  containerId: string,
  options?: ComponentDiagramOptions,
): string {
  return emitComponentD2(projectComponent(model, containerId), options);
}
```

- [ ] **Step 2: Type-check + test**

Run: `npm run typecheck && npm test`
Expected: most pass; some D2 L3 fixture/snapshot tests may fail because actors now render and the `" | refId"` suffix is gone.

- [ ] **Step 3: Update D2 L3 fixtures/snapshots**

For each failure, confirm the diff matches the drift verdict (actor present, refId suffix removed). Update the expected output. Add a comment in the test:

```typescript
// Drift verdict: actors render at L3 + no refId suffix on cross-container labels.
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/generator/d2/component.ts tests
git commit -m "refactor(d2): emit L3 from projection; render actors, drop refId suffix"
```

---

## Task 10: Port drawio L3 emitter onto projection

**Files:**

- Modify: `src/generator/drawio/component.ts`

- [ ] **Step 1: Replace `src/generator/drawio/component.ts` body**

```typescript
// src/generator/drawio/component.ts
import type { ArchitectureModel } from "../../analyzers/types.js";
import { projectComponent } from "../projection/component.js";
import { cellsFromSpec, type DiagramCells } from "./context.js";

export function emitComponentCells(
  spec: ReturnType<typeof projectComponent>,
): DiagramCells {
  return cellsFromSpec(spec);
}

export function buildComponentCells(
  model: ArchitectureModel,
  containerId: string,
): DiagramCells {
  return emitComponentCells(projectComponent(model, containerId));
}
```

- [ ] **Step 2: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS. Drawio L3 output should match the previous build.

If snapshots change, the most likely culprits:

- Cross-container component shapes previously used `STYLES.component` for ALL cross-container components; the new `cellsFromSpec` keeps that (kind: "component" → component style).
- Cross-container container refs previously used `STYLES.container`; ditto preserved.
- If the diff is something else, debug before accepting.

- [ ] **Step 3: Commit**

```bash
git add src/generator/drawio/component.ts
git commit -m "refactor(drawio): emit L3 cells from projection"
```

---

## Task 11: Run full quality suite + commit CONTEXT.md

**Files:**

- Modify (uncommitted): `CONTEXT.md` (already on disk from grilling).

- [ ] **Step 1: Run lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: PASS. Fix any lint warnings introduced by the refactor in place.

- [ ] **Step 2: Run quality suites**

Run: `npm run test:correctness`
Expected: precision/recall/F1 numbers unchanged or improved (drift verdicts at L1/L3 only affect D2 output, not model accuracy).

Run: `npm run test:drift`
Expected: PASS. Drift suite mutates the model and verifies stable output across changes — projection deepening doesn't affect model semantics.

Run: `npm run test:tokens`
Expected: PASS. Scan output is upstream of the refactor.

Run: `npm run bench`
Expected: PASS. Generation may be marginally faster (no duplicated traversal) but no regressions.

- [ ] **Step 3: Verify drawio output byte-stability for unchanged levels**

Run: `npx vitest run tests/generator/drawio`
Expected: PASS. Drawio L1/L2/L3 output should be byte-identical to the pre-refactor build for any committed fixture.

- [ ] **Step 4: Commit CONTEXT.md**

```bash
git add CONTEXT.md
git commit -m "docs: introduce CONTEXT.md with project glossary"
```

- [ ] **Step 5: Final commit (if any leftover changes)**

```bash
git status
# If clean, skip. If files remain, inspect and commit with a descriptive message.
```

---

## Self-review checklist (post-write)

**Spec coverage:**

- Projection module — Tasks 1, 2, 5, 8.
- D2 emitter ports — Tasks 3, 6, 9.
- Drawio emitter ports — Tasks 4, 7, 10.
- Drift verdict L1 (external↔external dropped) — Task 2 (projection), Task 3 (D2 fixture update).
- Drift verdict L3 (actor rendered) — Task 8 (projection), Task 9 (D2 fixture update).
- Drift verdict L3 (refId suffix removed) — Task 8 (projection — name field is plain), Task 9 (D2 emitter no longer appends).
- Test surface (3-tier: projection unit / emitter snapshot / E2E) — projection tests in Tasks 2/5/8; emitter tests preserved + updated in Tasks 3/6/9; E2E in Task 11.
- L4 deferred — explicitly noted in header + file structure.
- CONTEXT.md committed — Task 11.

**Type consistency:**

- `DiagramSpec`, `VertexSpec`, `EdgeSpec`, `VertexKind` defined in Task 1, used unchanged in 2/5/8 and consumed in 3/4/6/7/9/10.
- `cellsFromSpec` defined in Task 4, reused by Task 7 and Task 10.
- `projectContext`, `projectContainer`, `projectComponent` signatures consistent across tasks.
- D2 emitter wrapper names (`generateContextDiagram`, `generateContainerDiagram`, `generateComponentDiagram`) and drawio wrapper names (`buildContextCells`, `buildContainerCells`, `buildComponentCells`) preserved across tasks — call sites in `cli/commands/generate.ts`, `submodule.ts`, `submodule-scaffold.ts` need no changes.

**Placeholder scan:** none — every step has the actual command, expected output, or full code.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-projection-refactor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
