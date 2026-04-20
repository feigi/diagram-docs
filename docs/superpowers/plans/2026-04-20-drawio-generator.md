# Drawio Generator with Regen-Preserving Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class drawio (`.drawio` / mxGraph XML) generator alongside the existing D2 generator, make it the default output, and preserve user edits to geometry/style across regenerations via id-based merge.

**Architecture:** New `src/generator/drawio/` directory mirrors `src/generator/d2/`, consuming the same `ArchitectureModel`. Each per-diagram run reads the existing `.drawio` file (if any) with `fast-xml-parser`, classifies cells as matched / new / stale / user-freehand by id, preserves geometry+style on matched cells, layouts new cells with `elkjs`, then serialises back to XML. A dispatcher in `src/cli/commands/generate.ts` iterates `config.output.generators` (new config field) and runs each registered generator. D2 path is untouched.

**Tech Stack:** TypeScript (ESM, Node16), `fast-xml-parser` (new dep), `elkjs` (new dep), `zod` (existing), `vitest` (existing).

**Spec:** `docs/superpowers/specs/2026-04-20-drawio-generator-design.md`.

---

## File structure

```
src/generator/drawio/
  index.ts                # entry: generateDrawioFile(input)
  writer.ts               # mxGraph XML builder
  merge.ts                # parse existing .drawio, id-match, preserve geometry+style
  layout.ts               # elkjs wrapper with per-level algorithm selection
  styles.ts               # default mxCell styles per C4 kind
  context.ts              # L1 cell builder
  container.ts            # L2 cell builder
  component.ts            # L3 cell builder
  code.ts                 # L4 cell builder
  stability.ts            # deterministic cell ordering
  drift.ts                # stale-reference detection (drawio variant)
  cleanup.ts              # orphan .drawio cleanup
  submodule.ts            # per-submodule orchestration
tests/generator/drawio/
  writer.test.ts
  styles.test.ts
  layout.test.ts
  merge.test.ts
  context.test.ts
  container.test.ts
  component.test.ts
  code.test.ts
  stability.test.ts
  cleanup.test.ts
  drift.test.ts
  index.test.ts
  submodule.test.ts
tests/generator/drawio/integration/
  end-to-end.test.ts
  regen-determinism.test.ts
  user-edit-preservation.test.ts
  stale-deletion.test.ts
tests/fixtures/drawio/
  populated.drawio
  corrupted.drawio
```

---

## Task 1: Add `generators` config field

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/config/schema.test.ts` (create if missing; otherwise extend)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema output.generators", () => {
  it("defaults to ['drawio']", () => {
    const cfg = configSchema.parse({});
    expect(cfg.output.generators).toEqual(["drawio"]);
  });

  it("accepts ['d2']", () => {
    const cfg = configSchema.parse({ output: { generators: ["d2"] } });
    expect(cfg.output.generators).toEqual(["d2"]);
  });

  it("accepts ['d2', 'drawio']", () => {
    const cfg = configSchema.parse({
      output: { generators: ["d2", "drawio"] },
    });
    expect(cfg.output.generators).toEqual(["d2", "drawio"]);
  });

  it("rejects unknown generator", () => {
    expect(() =>
      configSchema.parse({ output: { generators: ["foo"] } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/config/schema.test.ts -t "generators"`
Expected: FAIL (`generators` unknown key rejected by strict schema).

- [ ] **Step 3: Add the field to the schema**

In `src/config/schema.ts`, inside the `output` object (after the `renderTimeout` line):

```typescript
generators: z
  .array(z.enum(["d2", "drawio"]))
  .min(1)
  .default(["drawio"]),
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/config/schema.test.ts -t "generators"`
Expected: PASS.

- [ ] **Step 5: Run full typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts tests/config/schema.test.ts
git commit -m "feat(config): add output.generators field (default ['drawio'])"
```

---

## Task 2: Add `fast-xml-parser` and `elkjs` dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the deps**

Run: `npm install fast-xml-parser@^4.5.1 elkjs@^0.9.3`
Expected: both appear in `dependencies`.

- [ ] **Step 2: Verify install**

Run: `npm ls fast-xml-parser elkjs`
Expected: both present at the requested versions.

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add fast-xml-parser and elkjs for drawio generator"
```

---

## Task 3: Stability helpers

**Files:**
- Create: `src/generator/drawio/stability.ts`
- Test: `tests/generator/drawio/stability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "../../../src/generator/drawio/stability.js";

describe("drawio stability", () => {
  it("toDrawioId slugifies and preserves hyphens", () => {
    expect(toDrawioId("User Service")).toBe("user-service");
  });

  it("edgeId combines source, target, and relationship slug", () => {
    expect(edgeId("auth", "user-db", "uses")).toBe("auth->user-db-uses");
  });

  it("sortById sorts by id ascending", () => {
    expect(sortById([{ id: "b" }, { id: "a" }])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("sortRelationships sorts by sourceId then targetId", () => {
    const rels = [
      { sourceId: "b", targetId: "x" },
      { sourceId: "a", targetId: "z" },
      { sourceId: "a", targetId: "y" },
    ];
    expect(sortRelationships(rels)).toEqual([
      { sourceId: "a", targetId: "y" },
      { sourceId: "a", targetId: "z" },
      { sourceId: "b", targetId: "x" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/stability.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement stability helpers**

Create `src/generator/drawio/stability.ts`:

```typescript
import { slugify } from "../../core/slugify.js";

export function toDrawioId(modelId: string): string {
  return slugify(modelId);
}

export function edgeId(
  sourceId: string,
  targetId: string,
  relationship: string,
): string {
  return `${toDrawioId(sourceId)}->${toDrawioId(targetId)}-${slugify(relationship)}`;
}

export function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

export function sortRelationships<
  T extends { sourceId: string; targetId: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const cmp = a.sourceId.localeCompare(b.sourceId);
    if (cmp !== 0) return cmp;
    return a.targetId.localeCompare(b.targetId);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/stability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/stability.ts tests/generator/drawio/stability.test.ts
git commit -m "feat(drawio): add stability helpers for deterministic cell ordering"
```

---

## Task 4: Styles and managed-cell tagging

**Files:**
- Create: `src/generator/drawio/styles.ts`
- Test: `tests/generator/drawio/styles.test.ts`

Rationale: merge distinguishes managed (generator-owned) cells from user freehand by looking for `ddocs_managed=1` inside the `style` string. All emitted cells carry it.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  STYLES,
  MANAGED_TAG,
  withManagedTag,
  isManagedStyle,
} from "../../../src/generator/drawio/styles.js";

describe("drawio styles", () => {
  it("exposes a style string per C4 kind", () => {
    expect(STYLES.person).toContain("shape=");
    expect(STYLES.system).toContain("fillColor=");
    expect(STYLES.container).toContain("fillColor=");
    expect(STYLES.component).toContain("fillColor=");
    expect(STYLES["external-system"]).toContain("fillColor=");
    expect(STYLES["code-class"]).toContain("fillColor=");
    expect(STYLES["code-fn"]).toContain("fillColor=");
    expect(STYLES.relationship).toContain("endArrow=");
  });

  it("MANAGED_TAG is the exact sentinel embedded in managed style strings", () => {
    expect(MANAGED_TAG).toBe("ddocs_managed=1");
  });

  it("withManagedTag appends the tag when missing", () => {
    expect(withManagedTag("rounded=1")).toBe("rounded=1;ddocs_managed=1");
  });

  it("withManagedTag is idempotent", () => {
    const s = withManagedTag(withManagedTag("rounded=1"));
    expect(s.match(/ddocs_managed=1/g)?.length).toBe(1);
  });

  it("isManagedStyle detects the tag regardless of position", () => {
    expect(isManagedStyle("rounded=1;ddocs_managed=1;strokeColor=black")).toBe(
      true,
    );
    expect(isManagedStyle("rounded=1;strokeColor=black")).toBe(false);
  });

  it("all STYLES are pre-tagged as managed", () => {
    for (const key of Object.keys(STYLES)) {
      expect(isManagedStyle(STYLES[key as keyof typeof STYLES])).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/styles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement styles**

Create `src/generator/drawio/styles.ts`:

```typescript
export const MANAGED_TAG = "ddocs_managed=1";

export type StyleKey =
  | "person"
  | "system"
  | "external-system"
  | "container"
  | "component"
  | "system-boundary"
  | "code-class"
  | "code-fn"
  | "relationship";

const BASE: Record<StyleKey, string> = {
  person:
    "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#08427B;strokeColor=#073B6F;fontColor=#ffffff",
  system:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#1168BD;strokeColor=#0E5CA8;fontColor=#ffffff",
  "external-system":
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#999999;strokeColor=#8A8A8A;fontColor=#ffffff",
  container:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#438DD5;strokeColor=#3C7FC0;fontColor=#ffffff",
  component:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#85BBF0;strokeColor=#78A8D8;fontColor=#000000",
  "system-boundary":
    "rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#444444;dashed=1;fontColor=#444444",
  "code-class":
    "rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#000000",
  "code-fn":
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#000000",
  relationship:
    "endArrow=classic;html=1;rounded=0;strokeColor=#707070;fontSize=11",
};

export function withManagedTag(style: string): string {
  if (isManagedStyle(style)) return style;
  const trimmed = style.endsWith(";") ? style.slice(0, -1) : style;
  return `${trimmed};${MANAGED_TAG}`;
}

export function isManagedStyle(style: string): boolean {
  return style.split(";").some((p) => p.trim() === MANAGED_TAG);
}

export const STYLES: Record<StyleKey, string> = Object.fromEntries(
  Object.entries(BASE).map(([k, v]) => [k, withManagedTag(v)]),
) as Record<StyleKey, string>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/styles.ts tests/generator/drawio/styles.test.ts
git commit -m "feat(drawio): add mxCell style definitions and managed-cell tag"
```

---

## Task 5: XML writer

**Files:**
- Create: `src/generator/drawio/writer.ts`
- Test: `tests/generator/drawio/writer.test.ts`

Rationale: small DSL over `fast-xml-parser`'s `XMLBuilder`. Cells emitted in insertion order — the caller (merge + stability) controls ordering.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { DrawioWriter } from "../../../src/generator/drawio/writer.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

describe("DrawioWriter", () => {
  it("emits mxfile > diagram > mxGraphModel > root with default 0/1 cells", () => {
    const w = new DrawioWriter({ diagramName: "L1 - context" });
    const xml = w.serialise();
    expect(xml).toContain("<mxfile");
    expect(xml).toContain('<diagram name="L1 - context"');
    expect(xml).toContain('<mxCell id="0"');
    expect(xml).toContain('<mxCell id="1" parent="0"');
  });

  it("addVertex produces mxCell with geometry and style", () => {
    const w = new DrawioWriter({ diagramName: "L1" });
    w.addVertex({
      id: "auth-service",
      value: "Auth Service",
      style: STYLES.container,
      geometry: { x: 100, y: 80, width: 160, height: 60 },
    });
    const xml = w.serialise();
    expect(xml).toContain('id="auth-service"');
    expect(xml).toContain('value="Auth Service"');
    expect(xml).toContain('vertex="1"');
    expect(xml).toContain("ddocs_managed=1");
    expect(xml).toMatch(/x="100"[^>]*y="80"[^>]*width="160"[^>]*height="60"/);
  });

  it("addEdge produces mxCell with edge=1 and source/target attrs", () => {
    const w = new DrawioWriter({ diagramName: "L1" });
    w.addVertex({
      id: "a",
      value: "A",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 100, height: 60 },
    });
    w.addVertex({
      id: "b",
      value: "B",
      style: STYLES.container,
      geometry: { x: 200, y: 0, width: 100, height: 60 },
    });
    w.addEdge({
      id: "a->b-uses",
      source: "a",
      target: "b",
      value: "uses",
      style: STYLES.relationship,
    });
    const xml = w.serialise();
    expect(xml).toContain('id="a-&gt;b-uses"');
    expect(xml).toContain('edge="1"');
    expect(xml).toContain('source="a"');
    expect(xml).toContain('target="b"');
    expect(xml).toContain('value="uses"');
  });

  it("addVertex supports nested parent", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "system",
      value: "System",
      style: STYLES["system-boundary"],
      geometry: { x: 0, y: 0, width: 500, height: 300 },
    });
    w.addVertex({
      id: "auth",
      value: "Auth",
      style: STYLES.container,
      geometry: { x: 20, y: 40, width: 160, height: 60 },
      parent: "system",
    });
    const xml = w.serialise();
    expect(xml).toMatch(/id="auth"[^>]*parent="system"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/writer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the writer**

Create `src/generator/drawio/writer.ts`:

```typescript
import { XMLBuilder } from "fast-xml-parser";

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VertexCell {
  id: string;
  value: string;
  style: string;
  geometry: Geometry;
  parent?: string;
}

export interface EdgeCell {
  id: string;
  source: string;
  target: string;
  value?: string;
  style: string;
  parent?: string;
  waypoints?: Array<{ x: number; y: number }>;
}

export interface DrawioWriterOptions {
  diagramName: string;
}

type CellNode = Record<string, unknown>;

export class DrawioWriter {
  private readonly diagramName: string;
  private readonly cells: CellNode[] = [];

  constructor(options: DrawioWriterOptions) {
    this.diagramName = options.diagramName;
    this.cells.push({ "@_id": "0" });
    this.cells.push({ "@_id": "1", "@_parent": "0" });
  }

  addVertex(cell: VertexCell): this {
    this.cells.push({
      "@_id": cell.id,
      "@_value": cell.value,
      "@_style": cell.style,
      "@_vertex": "1",
      "@_parent": cell.parent ?? "1",
      mxGeometry: {
        "@_x": String(cell.geometry.x),
        "@_y": String(cell.geometry.y),
        "@_width": String(cell.geometry.width),
        "@_height": String(cell.geometry.height),
        "@_as": "geometry",
      },
    });
    return this;
  }

  addEdge(cell: EdgeCell): this {
    const geom: Record<string, unknown> = {
      "@_relative": "1",
      "@_as": "geometry",
    };
    if (cell.waypoints && cell.waypoints.length > 0) {
      geom.Array = {
        "@_as": "points",
        mxPoint: cell.waypoints.map((p) => ({
          "@_x": String(p.x),
          "@_y": String(p.y),
        })),
      };
    }
    this.cells.push({
      "@_id": cell.id,
      ...(cell.value !== undefined ? { "@_value": cell.value } : {}),
      "@_style": cell.style,
      "@_edge": "1",
      "@_parent": cell.parent ?? "1",
      "@_source": cell.source,
      "@_target": cell.target,
      mxGeometry: geom,
    });
    return this;
  }

  serialise(): string {
    const tree = {
      "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
      mxfile: {
        "@_host": "diagram-docs",
        "@_type": "device",
        diagram: {
          "@_name": this.diagramName,
          mxGraphModel: {
            "@_dx": "800",
            "@_dy": "600",
            "@_grid": "1",
            "@_gridSize": "10",
            "@_guides": "1",
            "@_tooltips": "1",
            "@_connect": "1",
            "@_arrows": "1",
            "@_fold": "1",
            "@_page": "1",
            "@_pageScale": "1",
            "@_pageWidth": "850",
            "@_pageHeight": "1100",
            "@_math": "0",
            "@_shadow": "0",
            root: { mxCell: this.cells },
          },
        },
      },
    };
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      indentBy: "  ",
      suppressEmptyNode: false,
    });
    return builder.build(tree);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/writer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/writer.ts tests/generator/drawio/writer.test.ts
git commit -m "feat(drawio): add mxGraph XML writer"
```

---

## Task 6: Layout wrapper

**Files:**
- Create: `src/generator/drawio/layout.ts`
- Test: `tests/generator/drawio/layout.test.ts`

Rationale: elkjs is deterministic given sorted input and fixed options. The wrapper returns a `Map<id, Geometry>`. Per-level algorithm is hard-coded. Spacing constants are exported so the merge's snap-back math references the same values.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  layoutGraph,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "../../../src/generator/drawio/layout.js";

describe("layoutGraph", () => {
  it("returns geometry for every node", async () => {
    const result = await layoutGraph({
      level: "context",
      nodes: [
        { id: "a", width: NODE_WIDTH, height: NODE_HEIGHT },
        { id: "b", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [{ id: "a->b", source: "a", target: "b" }],
    });
    expect(result.get("a")).toBeDefined();
    expect(result.get("b")).toBeDefined();
    expect(result.get("a")!.width).toBe(NODE_WIDTH);
  });

  it("is deterministic across repeated runs", async () => {
    const input = {
      level: "container" as const,
      nodes: ["a", "b", "c", "d"].map((id) => ({
        id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: [
        { id: "a->b", source: "a", target: "b" },
        { id: "b->c", source: "b", target: "c" },
        { id: "c->d", source: "c", target: "d" },
      ],
    };
    const first = await layoutGraph(input);
    const second = await layoutGraph(input);
    for (const id of ["a", "b", "c", "d"]) {
      expect(first.get(id)).toEqual(second.get(id));
    }
  });

  it("nests children inside groups (component level)", async () => {
    const result = await layoutGraph({
      level: "component",
      nodes: [
        { id: "boundary", width: 400, height: 300, children: ["c1", "c2"] },
        { id: "c1", width: NODE_WIDTH, height: NODE_HEIGHT },
        { id: "c2", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [{ id: "c1->c2", source: "c1", target: "c2" }],
    });
    expect(result.get("boundary")).toBeDefined();
    expect(result.get("c1")).toBeDefined();
    expect(result.get("c1")!.x).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/layout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the layout wrapper**

Create `src/generator/drawio/layout.ts`:

```typescript
import ELK from "elkjs/lib/elk.bundled.js";
import type { Geometry } from "./writer.js";

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 60;
export const NODE_SPACING_X = 200;
export const NODE_SPACING_Y = 120;

export type Level = "context" | "container" | "component" | "code";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  children?: string[];
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutInput {
  level: Level;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

const ALGORITHMS: Record<Level, string> = {
  context: "layered",
  container: "layered",
  component: "layered",
  code: "mrtree",
};

const elk = new ELK();

export async function layoutGraph(
  input: LayoutInput,
): Promise<Map<string, Geometry>> {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  const allChildIds = new Set<string>();
  for (const n of input.nodes) {
    if (n.children && n.children.length > 0) {
      childrenOf.set(n.id, [...n.children].sort());
      for (const c of n.children) allChildIds.add(c);
    }
  }

  const buildElkNode = (id: string): Record<string, unknown> => {
    const n = byId.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    return {
      id,
      width: n.width,
      height: n.height,
      ...(kids.length > 0 ? { children: kids.map(buildElkNode) } : {}),
    };
  };

  const rootIds = input.nodes
    .map((n) => n.id)
    .filter((id) => !allChildIds.has(id))
    .sort();

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": ALGORITHMS[input.level],
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": String(NODE_SPACING_Y),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(NODE_SPACING_X),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: rootIds.map(buildElkNode),
    edges: [...input.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const laidOut = await elk.layout(graph);
  const result = new Map<string, Geometry>();
  collect(laidOut, 0, 0, result);
  return result;
}

function collect(
  node: {
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: unknown[];
  },
  parentX: number,
  parentY: number,
  out: Map<string, Geometry>,
): void {
  const ax = parentX + (node.x ?? 0);
  const ay = parentY + (node.y ?? 0);
  if (node.id && node.id !== "root") {
    out.set(node.id, {
      x: Math.round(ax),
      y: Math.round(ay),
      width: Math.round(node.width ?? 0),
      height: Math.round(node.height ?? 0),
    });
  }
  for (const child of (node.children as typeof node[]) ?? []) {
    collect(child, ax, ay, out);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/layout.ts tests/generator/drawio/layout.test.ts
git commit -m "feat(drawio): add elkjs layout wrapper with per-level algorithms"
```

---

## Task 7: L1 context cell builder

**Files:**
- Create: `src/generator/drawio/context.ts`
- Test: `tests/generator/drawio/context.test.ts`

Rationale: mirrors `src/generator/d2/context.ts`. Collapses container/component relationships onto the `system` vertex, deduplicates. Emits a `DiagramCells` pair reused by all per-level builders.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildContextCells } from "../../../src/generator/drawio/context.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "An online shop" },
  actors: [{ id: "customer", name: "Customer", description: "Buys things" }],
  externalSystems: [
    {
      id: "payment-api",
      name: "Payment API",
      description: "",
      technology: "REST",
    },
  ],
  containers: [
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "",
      technology: "TS",
    },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    { sourceId: "web", targetId: "payment-api", label: "charges" },
  ],
};

describe("buildContextCells", () => {
  it("emits actor, system, external-system vertices", () => {
    const { vertices } = buildContextCells(model);
    const ids = vertices.map((v) => v.id);
    expect(ids).toContain("customer");
    expect(ids).toContain("system");
    expect(ids).toContain("payment-api");
  });

  it("collapses container refs onto the system node", () => {
    const { edges } = buildContextCells(model);
    const srcs = edges.map((e) => e.source);
    const tgts = edges.map((e) => e.target);
    expect(srcs).toContain("system");
    expect(tgts).toContain("system");
    expect(srcs).not.toContain("web");
    expect(tgts).not.toContain("web");
  });

  it("deduplicates collapsed edges", () => {
    const dup: ArchitectureModel = {
      ...model,
      relationships: [
        { sourceId: "web", targetId: "payment-api", label: "charges" },
        { sourceId: "web", targetId: "payment-api", label: "refunds" },
      ],
    };
    const { edges } = buildContextCells(dup);
    const filtered = edges.filter(
      (e) => e.source === "system" && e.target === "payment-api",
    );
    expect(filtered).toHaveLength(1);
  });

  it("libraries are excluded (tag='library')", () => {
    const withLib: ArchitectureModel = {
      ...model,
      externalSystems: [
        ...model.externalSystems,
        { id: "lodash", name: "Lodash", description: "", tags: ["library"] },
      ],
    };
    const { vertices } = buildContextCells(withLib);
    expect(vertices.map((v) => v.id)).not.toContain("lodash");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement buildContextCells**

Create `src/generator/drawio/context.ts`:

```typescript
import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";

export interface VertexSpec {
  id: string;
  value: string;
  style: string;
  parent?: string;
}

export interface EdgeSpec {
  id: string;
  source: string;
  target: string;
  value?: string;
  style: string;
  parent?: string;
}

export interface DiagramCells {
  vertices: VertexSpec[];
  edges: EdgeSpec[];
}

export function buildContextCells(model: ArchitectureModel): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  for (const a of sortById(model.actors)) {
    vertices.push({
      id: toDrawioId(a.id),
      value: `${a.name}\n[Person]\n${a.description}`,
      style: STYLES.person,
    });
  }

  vertices.push({
    id: "system",
    value: `${model.system.name}\n[Software System]\n${model.system.description}`,
    style: STYLES.system,
  });

  const externals = sortById(
    model.externalSystems.filter((e) => !e.tags?.includes("library")),
  );
  for (const e of externals) {
    vertices.push({
      id: toDrawioId(e.id),
      value: `${e.name}\n[External System]${e.technology ? `\n[${e.technology}]` : ""}\n${e.description}`,
      style: STYLES["external-system"],
    });
  }

  const actorIds = new Set(model.actors.map((a) => a.id));
  const externalIds = new Set(externals.map((e) => e.id));
  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentIds = new Set(model.components.map((c) => c.id));
  const internalIds = new Set([...containerIds, ...componentIds]);

  const contextIds = new Set([
    ...actorIds,
    "system",
    ...externalIds,
    ...containerIds,
    ...componentIds,
  ]);

  const contextRels = model.relationships.filter(
    (r) => contextIds.has(r.sourceId) && contextIds.has(r.targetId),
  );

  const seen = new Set<string>();
  for (const rel of sortRelationships(contextRels)) {
    const src = internalIds.has(rel.sourceId)
      ? "system"
      : toDrawioId(rel.sourceId);
    const tgt = internalIds.has(rel.targetId)
      ? "system"
      : toDrawioId(rel.targetId);
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: edgeId(src, tgt, rel.label),
      source: src,
      target: tgt,
      value: rel.technology ? `${rel.label} [${rel.technology}]` : rel.label,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/context.ts tests/generator/drawio/context.test.ts
git commit -m "feat(drawio): build L1 context cells from ArchitectureModel"
```

---

## Task 8: L2 container cell builder

**Files:**
- Create: `src/generator/drawio/container.ts`
- Test: `tests/generator/drawio/container.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildContainerCells } from "../../../src/generator/drawio/container.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "desc" },
  actors: [{ id: "customer", name: "Customer", description: "" }],
  externalSystems: [
    { id: "payment", name: "Payment", description: "", technology: "REST" },
  ],
  containers: [
    { id: "web", applicationId: "web", name: "Web", description: "", technology: "TS" },
    { id: "api", applicationId: "api", name: "API", description: "", technology: "Go" },
    { id: "orphan", applicationId: "orphan", name: "Orphan", description: "", technology: "?" },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    { sourceId: "web", targetId: "api", label: "calls" },
    { sourceId: "api", targetId: "payment", label: "charges" },
  ],
};

describe("buildContainerCells", () => {
  it("emits system boundary vertex with containers as children", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "system")).toBeDefined();
    expect(vertices.find((v) => v.id === "web")?.parent).toBe("system");
  });

  it("drops containers with no relationships", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "orphan")).toBeUndefined();
  });

  it("emits actor and external-system vertices at top level", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "customer")?.parent).toBeUndefined();
    expect(vertices.find((v) => v.id === "payment")?.parent).toBeUndefined();
  });

  it("edges reference containers directly (not via system)", () => {
    const { edges } = buildContainerCells(model);
    expect(edges.find((e) => e.source === "web" && e.target === "api")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/container.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement buildContainerCells**

Create `src/generator/drawio/container.ts`:

```typescript
import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

export function buildContainerCells(model: ArchitectureModel): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentToContainer = new Map(
    model.components.map((c) => [c.id, c.containerId]),
  );
  const allIds = new Set<string>([
    ...model.actors.map((a) => a.id),
    ...model.containers.map((c) => c.id),
    ...model.externalSystems.map((e) => e.id),
    ...model.components.map((c) => c.id),
  ]);

  const resolve = (id: string): string =>
    componentToContainer.get(id) ?? id;

  const connected = new Set<string>();
  const seenEdges = new Set<string>();
  interface R {
    src: string;
    tgt: string;
    label: string;
    tech?: string;
  }
  const resolved: R[] = [];

  for (const r of sortRelationships(
    model.relationships.filter(
      (r) => allIds.has(r.sourceId) && allIds.has(r.targetId),
    ),
  )) {
    const src = resolve(r.sourceId);
    const tgt = resolve(r.targetId);
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    resolved.push({ src, tgt, label: r.label, tech: r.technology });
    if (containerIds.has(src)) connected.add(src);
    if (containerIds.has(tgt)) connected.add(tgt);
  }

  for (const a of sortById(model.actors)) {
    vertices.push({
      id: toDrawioId(a.id),
      value: `${a.name}\n[Person]\n${a.description}`,
      style: STYLES.person,
    });
  }

  vertices.push({
    id: "system",
    value: `${model.system.name}\n[Software System]`,
    style: STYLES["system-boundary"],
  });

  for (const c of sortById(model.containers)) {
    if (!connected.has(c.id)) continue;
    vertices.push({
      id: toDrawioId(c.id),
      value: `${c.name}\n[Container: ${c.technology}]\n${c.description}`,
      style: STYLES.container,
      parent: "system",
    });
  }

  for (const e of sortById(model.externalSystems)) {
    const tech = e.technology ? `\n[${e.technology}]` : "";
    const isLib = e.tags?.includes("library");
    vertices.push({
      id: toDrawioId(e.id),
      value: `${e.name}\n${isLib ? "[Library]" : "[External System]"}${tech}\n${e.description}`,
      style: STYLES["external-system"],
    });
  }

  for (const r of resolved) {
    edges.push({
      id: edgeId(r.src, r.tgt, r.label),
      source: toDrawioId(r.src),
      target: toDrawioId(r.tgt),
      value: r.tech ? `${r.label} [${r.tech}]` : r.label,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/container.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/container.ts tests/generator/drawio/container.test.ts
git commit -m "feat(drawio): build L2 container cells from ArchitectureModel"
```

---

## Task 9: L3 component cell builder

**Files:**
- Create: `src/generator/drawio/component.ts`
- Test: `tests/generator/drawio/component.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildComponentCells } from "../../../src/generator/drawio/component.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    { id: "api", applicationId: "api", name: "API", description: "", technology: "Go" },
    { id: "web", applicationId: "web", name: "Web", description: "", technology: "TS" },
  ],
  components: [
    { id: "auth", containerId: "api", name: "Auth", description: "", technology: "Go", moduleIds: [] },
    { id: "user", containerId: "api", name: "User", description: "", technology: "Go", moduleIds: [] },
    { id: "ui", containerId: "web", name: "UI", description: "", technology: "TS", moduleIds: [] },
  ],
  relationships: [
    { sourceId: "auth", targetId: "user", label: "uses" },
    { sourceId: "ui", targetId: "auth", label: "calls" },
  ],
};

describe("buildComponentCells", () => {
  it("emits the container boundary and components nested inside", () => {
    const { vertices } = buildComponentCells(model, "api");
    expect(vertices.find((v) => v.id === "api")).toBeDefined();
    expect(vertices.find((v) => v.id === "auth")?.parent).toBe("api");
  });

  it("emits external component references at top level", () => {
    const { vertices } = buildComponentCells(model, "api");
    const ui = vertices.find((v) => v.id === "ui");
    expect(ui).toBeDefined();
    expect(ui?.parent).toBeUndefined();
  });

  it("throws when container not found", () => {
    expect(() => buildComponentCells(model, "missing")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/component.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement buildComponentCells**

Create `src/generator/drawio/component.ts`:

```typescript
import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

export function buildComponentCells(
  model: ArchitectureModel,
  containerId: string,
): DiagramCells {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) throw new Error(`Container not found: ${containerId}`);

  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];
  const localComponents = model.components.filter(
    (c) => c.containerId === containerId,
  );
  const localIds = new Set(localComponents.map((c) => c.id));

  vertices.push({
    id: toDrawioId(container.id),
    value: `${container.name}\n[Container: ${container.technology}]`,
    style: STYLES["system-boundary"],
  });

  for (const c of sortById(localComponents)) {
    vertices.push({
      id: toDrawioId(c.id),
      value: `${c.name}\n[Component: ${c.technology}]\n${c.description}`,
      style: STYLES.component,
      parent: toDrawioId(container.id),
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
    const ext = model.externalSystems.find((e) => e.id === rid);
    const otherContainer = model.containers.find((c) => c.id === rid);
    const otherComp = model.components.find((c) => c.id === rid);

    if (ext) {
      vertices.push({
        id: toDrawioId(rid),
        value: `${ext.name}\n[External System]`,
        style: STYLES["external-system"],
      });
    } else if (otherContainer) {
      vertices.push({
        id: toDrawioId(rid),
        value: `${otherContainer.name}\n[Container: ${otherContainer.technology}]`,
        style: STYLES.container,
      });
    } else if (otherComp) {
      vertices.push({
        id: toDrawioId(rid),
        value: `${otherComp.name}\n[Component: ${otherComp.technology}]`,
        style: STYLES.component,
      });
    } else {
      vertices.push({
        id: toDrawioId(rid),
        value: rid,
        style: STYLES.component,
      });
    }
  }

  for (const r of sortRelationships(rels)) {
    edges.push({
      id: edgeId(r.sourceId, r.targetId, r.label),
      source: toDrawioId(r.sourceId),
      target: toDrawioId(r.targetId),
      value: r.technology ? `${r.label} [${r.technology}]` : r.label,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/component.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/component.ts tests/generator/drawio/component.test.ts
git commit -m "feat(drawio): build L3 component cells per container"
```

---

## Task 10: L4 code cell builder

**Files:**
- Create: `src/generator/drawio/code.ts`
- Test: `tests/generator/drawio/code.test.ts`

Rationale: emits one vertex per `CodeElement` (class/interface/enum/struct → `code-class`; function/type/typedef → `code-fn`), nested under a component boundary. Relationships come from `model.codeRelationships`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildCodeCells } from "../../../src/generator/drawio/code.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    { id: "api", applicationId: "api", name: "API", description: "", technology: "Go" },
  ],
  components: [
    { id: "auth", containerId: "api", name: "Auth", description: "", technology: "Go", moduleIds: [] },
  ],
  relationships: [],
  codeElements: [
    { id: "User", componentId: "auth", containerId: "api", name: "User", kind: "class" },
    { id: "hashPassword", componentId: "auth", containerId: "api", name: "hashPassword", kind: "function" },
  ],
  codeRelationships: [
    { sourceId: "User", targetId: "hashPassword", kind: "uses" },
  ],
};

describe("buildCodeCells", () => {
  it("emits the component boundary and each code element", () => {
    const { vertices } = buildCodeCells(model, model.components[0]);
    expect(vertices.find((v) => v.id === "auth")).toBeDefined();
    expect(vertices.find((v) => v.id === "User")).toBeDefined();
    expect(vertices.find((v) => v.id === "hashPassword")).toBeDefined();
  });

  it("styles class kinds as code-class and function kinds as code-fn", () => {
    const { vertices } = buildCodeCells(model, model.components[0]);
    const user = vertices.find((v) => v.id === "User")!;
    const fn = vertices.find((v) => v.id === "hashPassword")!;
    expect(user.style).toContain("#dae8fc");
    expect(fn.style).toContain("#d5e8d4");
  });

  it("emits code relationships as edges", () => {
    const { edges } = buildCodeCells(model, model.components[0]);
    expect(
      edges.find((x) => x.source === "User" && x.target === "hashPassword"),
    ).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/code.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement buildCodeCells**

Create `src/generator/drawio/code.ts`:

```typescript
import type {
  ArchitectureModel,
  Component,
  CodeElement,
} from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

const CONTAINER_KINDS = new Set(["class", "interface", "enum", "struct"]);

function styleFor(el: CodeElement): string {
  return CONTAINER_KINDS.has(el.kind)
    ? STYLES["code-class"]
    : STYLES["code-fn"];
}

export function buildCodeCells(
  model: ArchitectureModel,
  component: Component,
): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  vertices.push({
    id: toDrawioId(component.id),
    value: `${component.name}\n[Component]`,
    style: STYLES["system-boundary"],
  });

  const elements = sortById(
    (model.codeElements ?? []).filter((e) => e.componentId === component.id),
  );
  const elementIds = new Set(elements.map((e) => e.id));

  for (const el of elements) {
    vertices.push({
      id: toDrawioId(el.id),
      value: `${el.name}\n[${el.kind}]`,
      style: styleFor(el),
      parent: toDrawioId(component.id),
    });
  }

  const seenExternals = new Set<string>();
  for (const r of sortRelationships(model.codeRelationships ?? [])) {
    if (!elementIds.has(r.sourceId)) continue;
    if (!elementIds.has(r.targetId) && !seenExternals.has(r.targetId)) {
      seenExternals.add(r.targetId);
      vertices.push({
        id: toDrawioId(r.targetId),
        value: r.targetName ?? r.targetId,
        style: STYLES["code-class"],
      });
    }
    edges.push({
      id: edgeId(r.sourceId, r.targetId, r.kind),
      source: toDrawioId(r.sourceId),
      target: toDrawioId(r.targetId),
      value: r.label ?? r.kind,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/code.ts tests/generator/drawio/code.test.ts
git commit -m "feat(drawio): build L4 code-level cells per component"
```

---

## Task 11: Parse existing drawio file

**Files:**
- Create: `src/generator/drawio/merge.ts`
- Test: `tests/generator/drawio/merge.test.ts`
- Create: `tests/fixtures/drawio/populated.drawio`
- Create: `tests/fixtures/drawio/corrupted.drawio`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/drawio/populated.drawio`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="diagram-docs" type="device">
  <diagram name="L2">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="auth" value="Auth Service" style="rounded=1;fillColor=#438DD5;ddocs_managed=1" vertex="1" parent="1">
          <mxGeometry x="120" y="80" width="160" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="auth-&gt;db-uses" value="uses" style="endArrow=classic;ddocs_managed=1" edge="1" parent="1" source="auth" target="db">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="my-note" value="user drew this" style="rounded=1;fillColor=#fff2cc" vertex="1" parent="1">
          <mxGeometry x="300" y="300" width="120" height="40" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

`tests/fixtures/drawio/corrupted.drawio`:

```xml
<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"
<<< unterminated
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  parseDrawioFile,
  DrawioParseError,
} from "../../../src/generator/drawio/merge.js";

const FIXTURES = path.resolve(__dirname, "../../fixtures/drawio");

describe("parseDrawioFile", () => {
  it("returns empty result when file does not exist", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "does-not-exist.drawio"));
    expect(result.cells.size).toBe(0);
  });

  it("extracts managed cells with geometry and style", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
    const auth = result.cells.get("auth");
    expect(auth).toBeDefined();
    expect(auth!.managed).toBe(true);
    expect(auth!.vertex).toBe(true);
    expect(auth!.geometry).toEqual({ x: 120, y: 80, width: 160, height: 60 });
    expect(auth!.style).toContain("ddocs_managed=1");
  });

  it("distinguishes user-freehand cells (no managed tag)", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
    const note = result.cells.get("my-note");
    expect(note?.managed).toBe(false);
  });

  it("extracts edge source/target", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
    const edge = result.cells.get("auth->db-uses");
    expect(edge?.edge).toBe(true);
    expect(edge?.source).toBe("auth");
    expect(edge?.target).toBe("db");
  });

  it("throws DrawioParseError on corrupt XML", () => {
    expect(() =>
      parseDrawioFile(path.join(FIXTURES, "corrupted.drawio")),
    ).toThrow(DrawioParseError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/merge.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement parseDrawioFile**

Create `src/generator/drawio/merge.ts`:

```typescript
import * as fs from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { Geometry } from "./writer.js";
import { isManagedStyle } from "./styles.js";

export class DrawioParseError extends Error {
  constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(
      `Unable to parse drawio file ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export interface ExistingCell {
  id: string;
  value?: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geometry?: Geometry;
  waypoints?: Array<{ x: number; y: number }>;
  managed: boolean;
}

export interface ExistingDocument {
  cells: Map<string, ExistingCell>;
}

export function parseDrawioFile(filePath: string): ExistingDocument {
  if (!fs.existsSync(filePath)) return { cells: new Map() };
  const xml = fs.readFileSync(filePath, "utf-8");
  let tree: unknown;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      allowBooleanAttributes: true,
      processEntities: true,
    });
    tree = parser.parse(xml, true);
  } catch (err) {
    throw new DrawioParseError(filePath, err);
  }

  const rootCells = extractCells(tree);
  if (rootCells === null) {
    throw new DrawioParseError(
      filePath,
      new Error("unexpected structure: no mxfile > diagram > mxGraphModel > root > mxCell"),
    );
  }

  const cells = new Map<string, ExistingCell>();
  for (const raw of rootCells) {
    const r = raw as Record<string, unknown>;
    const id = r["@_id"] as string | undefined;
    if (!id) continue;
    const style = String(r["@_style"] ?? "");
    const vertex = String(r["@_vertex"] ?? "") === "1";
    const edge = String(r["@_edge"] ?? "") === "1";
    const geometryNode = r["mxGeometry"] as Record<string, unknown> | undefined;
    cells.set(id, {
      id,
      value: r["@_value"] as string | undefined,
      style,
      vertex,
      edge,
      parent: r["@_parent"] as string | undefined,
      source: r["@_source"] as string | undefined,
      target: r["@_target"] as string | undefined,
      geometry: parseGeometry(geometryNode),
      waypoints: parseWaypoints(geometryNode),
      managed: isManagedStyle(style),
    });
  }
  return { cells };
}

function extractCells(tree: unknown): unknown[] | null {
  const mxfile = (tree as Record<string, unknown>)?.mxfile as
    | Record<string, unknown>
    | undefined;
  if (!mxfile) return null;
  const diag = mxfile.diagram as Record<string, unknown> | undefined;
  if (!diag) return null;
  const model = diag.mxGraphModel as Record<string, unknown> | undefined;
  if (!model) return null;
  const root = model.root as Record<string, unknown> | undefined;
  if (!root) return null;
  const cells = root.mxCell;
  if (!cells) return null;
  return Array.isArray(cells) ? cells : [cells];
}

function parseGeometry(
  geom?: Record<string, unknown>,
): Geometry | undefined {
  if (!geom) return undefined;
  const x = Number(geom["@_x"] ?? NaN);
  const y = Number(geom["@_y"] ?? NaN);
  const w = Number(geom["@_width"] ?? NaN);
  const h = Number(geom["@_height"] ?? NaN);
  if ([x, y, w, h].some((n) => Number.isNaN(n))) return undefined;
  return { x, y, width: w, height: h };
}

function parseWaypoints(
  geom?: Record<string, unknown>,
): Array<{ x: number; y: number }> | undefined {
  if (!geom) return undefined;
  const arr = geom["Array"] as Record<string, unknown> | undefined;
  if (!arr) return undefined;
  const points = arr.mxPoint;
  if (!points) return undefined;
  const list = Array.isArray(points) ? points : [points];
  const out: Array<{ x: number; y: number }> = [];
  for (const p of list) {
    const x = Number((p as Record<string, unknown>)["@_x"] ?? NaN);
    const y = Number((p as Record<string, unknown>)["@_y"] ?? NaN);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    out.push({ x, y });
  }
  return out.length > 0 ? out : undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/merge.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/generator/drawio/merge.ts tests/generator/drawio/merge.test.ts tests/fixtures/drawio/
git commit -m "feat(drawio): parse existing drawio file with fast-xml-parser"
```

---

## Task 12: Reconcile existing + fresh cells

**Files:**
- Modify: `src/generator/drawio/merge.ts`
- Modify: `tests/generator/drawio/merge.test.ts`

Rationale: takes `ExistingDocument` + fresh `DiagramCells` + layout result, returns resolved cell lists. Preserves geometry/style on matched cells; lays out new cells; drops stale managed cells; preserves user freehand.

- [ ] **Step 1: Append failing tests**

Append to `tests/generator/drawio/merge.test.ts`:

```typescript
import { reconcile } from "../../../src/generator/drawio/merge.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

describe("reconcile", () => {
  const layoutGeom = (x: number, y: number) => ({
    x,
    y,
    width: 160,
    height: 60,
  });

  it("preserves saved geometry and style for matched managed cells", () => {
    const existing = {
      cells: new Map([
        [
          "auth",
          {
            id: "auth",
            value: "old label",
            style: "rounded=1;fillColor=#ff0000;ddocs_managed=1",
            vertex: true,
            edge: false,
            parent: "1",
            geometry: { x: 500, y: 500, width: 200, height: 80 },
            managed: true,
          },
        ],
      ]),
    };
    const fresh = {
      vertices: [
        { id: "auth", value: "new label", style: STYLES.container },
      ],
      edges: [],
    };
    const layout = new Map([["auth", layoutGeom(0, 0)]]);
    const result = reconcile({ existing, fresh, layout });
    const auth = result.vertices.find((v) => v.id === "auth")!;
    expect(auth.style).toBe("rounded=1;fillColor=#ff0000;ddocs_managed=1");
    expect(auth.geometry).toEqual({ x: 500, y: 500, width: 200, height: 80 });
    expect(auth.value).toBe("new label");
  });

  it("places new cells using layout coords", () => {
    const existing = { cells: new Map() };
    const fresh = {
      vertices: [{ id: "a", value: "A", style: STYLES.container }],
      edges: [],
    };
    const layout = new Map([["a", layoutGeom(42, 99)]]);
    const result = reconcile({ existing, fresh, layout });
    expect(result.vertices[0].geometry).toEqual({
      x: 42,
      y: 99,
      width: 160,
      height: 60,
    });
  });

  it("drops stale managed cells and orphan edges", () => {
    const existing = {
      cells: new Map([
        [
          "gone",
          {
            id: "gone",
            style: STYLES.container,
            vertex: true,
            edge: false,
            geometry: { x: 0, y: 0, width: 10, height: 10 },
            managed: true,
          },
        ],
        [
          "a->gone-uses",
          {
            id: "a->gone-uses",
            style: STYLES.relationship,
            vertex: false,
            edge: true,
            source: "a",
            target: "gone",
            managed: true,
          },
        ],
      ]),
    };
    const fresh = { vertices: [], edges: [] };
    const layout = new Map();
    const result = reconcile({ existing, fresh, layout });
    expect(result.vertices.find((v) => v.id === "gone")).toBeUndefined();
    expect(result.edges.find((e) => e.id === "a->gone-uses")).toBeUndefined();
  });

  it("preserves user freehand (unmanaged) cells verbatim", () => {
    const existing = {
      cells: new Map([
        [
          "my-note",
          {
            id: "my-note",
            value: "note",
            style: "rounded=1;fillColor=#fff2cc",
            vertex: true,
            edge: false,
            geometry: { x: 300, y: 300, width: 120, height: 40 },
            managed: false,
          },
        ],
      ]),
    };
    const fresh = { vertices: [], edges: [] };
    const layout = new Map();
    const result = reconcile({ existing, fresh, layout });
    const note = result.vertices.find((v) => v.id === "my-note");
    expect(note).toBeDefined();
    expect(note!.style).toBe("rounded=1;fillColor=#fff2cc");
    expect(note!.geometry).toEqual({ x: 300, y: 300, width: 120, height: 40 });
  });

  it("reparents to layer 1 when saved parent is now stale", () => {
    const existing = {
      cells: new Map([
        [
          "kept",
          {
            id: "kept",
            style: STYLES.component,
            vertex: true,
            edge: false,
            parent: "gone",
            geometry: { x: 50, y: 50, width: 160, height: 60 },
            managed: true,
          },
        ],
      ]),
    };
    const fresh = {
      vertices: [{ id: "kept", value: "Kept", style: STYLES.component }],
      edges: [],
    };
    const layout = new Map([["kept", layoutGeom(0, 0)]]);
    const result = reconcile({ existing, fresh, layout });
    const kept = result.vertices.find((v) => v.id === "kept")!;
    expect(kept.parent).toBe("1");
    expect(result.warnings.some((w) => w.includes("kept"))).toBe(true);
  });

  it("drops edge waypoints when either endpoint is new", () => {
    const existing = {
      cells: new Map([
        [
          "a->b-uses",
          {
            id: "a->b-uses",
            style: STYLES.relationship,
            vertex: false,
            edge: true,
            source: "a",
            target: "b",
            waypoints: [{ x: 100, y: 100 }],
            managed: true,
          },
        ],
      ]),
    };
    const fresh = {
      vertices: [
        { id: "a", value: "A", style: STYLES.container },
        { id: "b", value: "B", style: STYLES.container },
      ],
      edges: [
        {
          id: "a->b-uses",
          source: "a",
          target: "b",
          value: "uses",
          style: STYLES.relationship,
        },
      ],
    };
    const layout = new Map([
      ["a", layoutGeom(0, 0)],
      ["b", layoutGeom(200, 0)],
    ]);
    const result = reconcile({ existing, fresh, layout });
    const edge = result.edges.find((e) => e.id === "a->b-uses")!;
    expect(edge.waypoints).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/merge.test.ts -t reconcile`
Expected: FAIL.

- [ ] **Step 3: Implement reconcile**

Append to `src/generator/drawio/merge.ts`:

```typescript
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

export interface ResolvedVertex extends VertexSpec {
  geometry: Geometry;
}

export interface ResolvedEdge extends EdgeSpec {
  waypoints?: Array<{ x: number; y: number }>;
}

export interface ReconcileInput {
  existing: ExistingDocument;
  fresh: DiagramCells;
  layout: Map<string, Geometry>;
}

export interface ReconcileResult {
  vertices: ResolvedVertex[];
  edges: ResolvedEdge[];
  warnings: string[];
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { existing, fresh, layout } = input;
  const warnings: string[] = [];

  const freshVertexIds = new Set(fresh.vertices.map((v) => v.id));
  const freshEdgeIds = new Set(fresh.edges.map((e) => e.id));
  const preservedGeometry = new Set<string>();

  const vertices: ResolvedVertex[] = [];

  for (const v of fresh.vertices) {
    const prior = existing.cells.get(v.id);
    const priorParentStale =
      prior?.parent !== undefined &&
      prior.parent !== "1" &&
      !freshVertexIds.has(prior.parent);

    if (
      prior &&
      prior.vertex &&
      prior.managed &&
      prior.geometry &&
      !priorParentStale
    ) {
      vertices.push({
        ...v,
        style: prior.style,
        geometry: prior.geometry,
        parent:
          prior.parent && freshVertexIds.has(prior.parent)
            ? prior.parent
            : v.parent,
      });
      preservedGeometry.add(v.id);
    } else {
      if (prior && prior.managed && priorParentStale) {
        warnings.push(
          `Cell "${v.id}" parent "${prior.parent}" no longer exists; reparented to layer 1.`,
        );
      }
      const geom = layout.get(v.id);
      if (!geom) {
        warnings.push(`No layout assigned for vertex "${v.id}"; placing at origin.`);
      }
      vertices.push({
        ...v,
        parent: v.parent ?? "1",
        geometry: geom ?? { x: 0, y: 0, width: 160, height: 60 },
      });
    }
  }

  for (const [id, cell] of existing.cells) {
    if (freshVertexIds.has(id)) continue;
    if (!cell.vertex) continue;
    if (cell.managed) continue;
    if (!cell.geometry) continue;
    vertices.push({
      id: cell.id,
      value: cell.value ?? "",
      style: cell.style,
      parent: cell.parent,
      geometry: cell.geometry,
    });
  }

  const edges: ResolvedEdge[] = [];
  for (const e of fresh.edges) {
    const prior = existing.cells.get(e.id);
    const bothPreserved =
      preservedGeometry.has(e.source) && preservedGeometry.has(e.target);
    const waypoints =
      prior && prior.edge && prior.managed && bothPreserved
        ? prior.waypoints
        : undefined;
    edges.push({ ...e, waypoints });
  }

  for (const [id, cell] of existing.cells) {
    if (freshEdgeIds.has(id)) continue;
    if (!cell.edge) continue;
    if (cell.managed) continue;
    if (!cell.source || !cell.target) continue;
    edges.push({
      id,
      source: cell.source,
      target: cell.target,
      value: cell.value,
      style: cell.style,
      parent: cell.parent,
    });
  }

  return { vertices, edges, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/merge.test.ts -t reconcile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/merge.ts tests/generator/drawio/merge.test.ts
git commit -m "feat(drawio): reconcile fresh cells against existing file, preserving geometry"
```

---

## Task 13: Orchestrator — generateDrawioFile

**Files:**
- Create: `src/generator/drawio/index.ts`
- Test: `tests/generator/drawio/index.test.ts`

Rationale: composes parse → layout → reconcile → write for a single diagram file. Aborts with an error on corrupt existing XML (file untouched).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../src/generator/drawio/index.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-drawio-"));
}

describe("generateDrawioFile", () => {
  it("writes a .drawio file with the fresh cells", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells: {
        vertices: [{ id: "a", value: "A", style: STYLES.container }],
        edges: [],
      },
    });
    const xml = fs.readFileSync(out, "utf-8");
    expect(xml).toContain('id="a"');
    expect(xml).toContain("mxGraphModel");
  });

  it("is byte-identical across two runs with unchanged input", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    const cells = {
      vertices: [
        { id: "a", value: "A", style: STYLES.container },
        { id: "b", value: "B", style: STYLES.container },
      ],
      edges: [
        {
          id: "a->b-uses",
          source: "a",
          target: "b",
          value: "uses",
          style: STYLES.relationship,
        },
      ],
    };
    await generateDrawioFile({ filePath: out, diagramName: "L1", level: "context", cells });
    const first = fs.readFileSync(out, "utf-8");
    await generateDrawioFile({ filePath: out, diagramName: "L1", level: "context", cells });
    const second = fs.readFileSync(out, "utf-8");
    expect(second).toBe(first);
  });

  it("aborts and leaves the file intact on corrupt existing XML", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    const corrupt = "<not xml";
    fs.writeFileSync(out, corrupt, "utf-8");
    await expect(
      generateDrawioFile({
        filePath: out,
        diagramName: "L1",
        level: "context",
        cells: { vertices: [], edges: [] },
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(out, "utf-8")).toBe(corrupt);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement generateDrawioFile**

Create `src/generator/drawio/index.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { DiagramCells } from "./context.js";
import { DrawioWriter } from "./writer.js";
import { parseDrawioFile, reconcile } from "./merge.js";
import {
  layoutGraph,
  NODE_WIDTH,
  NODE_HEIGHT,
  type Level,
  type LayoutNode,
} from "./layout.js";

export interface GenerateDrawioFileInput {
  filePath: string;
  diagramName: string;
  level: Level;
  cells: DiagramCells;
}

export async function generateDrawioFile(
  input: GenerateDrawioFileInput,
): Promise<void> {
  const existing = parseDrawioFile(input.filePath);

  const childrenOf = new Map<string, string[]>();
  for (const v of input.cells.vertices) {
    if (!v.parent) continue;
    const list = childrenOf.get(v.parent) ?? [];
    list.push(v.id);
    childrenOf.set(v.parent, list);
  }

  const layoutNodes: LayoutNode[] = input.cells.vertices.map((v) => {
    const kids = childrenOf.get(v.id);
    return {
      id: v.id,
      width:
        kids && kids.length > 0
          ? Math.max(NODE_WIDTH * 2, kids.length * NODE_WIDTH)
          : NODE_WIDTH,
      height: kids && kids.length > 0 ? NODE_HEIGHT * 3 : NODE_HEIGHT,
      children: kids,
    };
  });

  const layout = await layoutGraph({
    level: input.level,
    nodes: layoutNodes,
    edges: input.cells.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  });

  const result = reconcile({ existing, fresh: input.cells, layout });
  for (const w of result.warnings) console.error(`Warning: drawio merge: ${w}`);

  const writer = new DrawioWriter({ diagramName: input.diagramName });
  for (const v of result.vertices) {
    writer.addVertex({
      id: v.id,
      value: v.value,
      style: v.style,
      geometry: v.geometry,
      parent: v.parent,
    });
  }
  for (const e of result.edges) {
    writer.addEdge({
      id: e.id,
      source: e.source,
      target: e.target,
      value: e.value,
      style: e.style,
      parent: e.parent,
      waypoints: e.waypoints,
    });
  }

  fs.mkdirSync(path.dirname(input.filePath), { recursive: true });
  fs.writeFileSync(input.filePath, writer.serialise(), "utf-8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/index.ts tests/generator/drawio/index.test.ts
git commit -m "feat(drawio): orchestrate parse/layout/reconcile/write per diagram"
```

---

## Task 14: Drift detection

**Files:**
- Create: `src/generator/drawio/drift.ts`
- Test: `tests/generator/drawio/drift.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkDrawioDrift } from "../../../src/generator/drawio/drift.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    { id: "api", applicationId: "api", name: "API", description: "", technology: "" },
  ],
  components: [],
  relationships: [],
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-drift-"));
}

describe("checkDrawioDrift", () => {
  it("reports user-drawn edges that reference stale ids", () => {
    const dir = tmpDir();
    const file = path.join(dir, "c2-container.drawio");
    fs.writeFileSync(
      file,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="my-edge" style="endArrow=classic" edge="1" parent="1" source="api" target="removed-svc"/>
</root></mxGraphModel></diagram></mxfile>`,
      "utf-8",
    );
    const warns = checkDrawioDrift(dir, model);
    expect(warns.some((w) => w.id === "removed-svc")).toBe(true);
  });

  it("ignores freehand vertices not referenced by any edge", () => {
    const dir = tmpDir();
    const file = path.join(dir, "c2-container.drawio");
    fs.writeFileSync(
      file,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="my-note" value="note" style="rounded=1" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="100" height="40" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
      "utf-8",
    );
    const warns = checkDrawioDrift(dir, model);
    expect(warns).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/drift.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement checkDrawioDrift**

Create `src/generator/drawio/drift.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import { parseDrawioFile, DrawioParseError } from "./merge.js";
import { toDrawioId } from "./stability.js";

export interface DriftWarning {
  file: string;
  line: number;
  id: string;
  message: string;
}

export function checkDrawioDrift(
  outputDir: string,
  model: ArchitectureModel,
): DriftWarning[] {
  const valid = buildValidIdSet(model);
  const out: DriftWarning[] = [];
  for (const f of collectDrawioFiles(outputDir)) {
    out.push(...checkFile(f, valid));
  }
  return out;
}

function buildValidIdSet(model: ArchitectureModel): Set<string> {
  const s = new Set<string>();
  s.add("system");
  for (const a of model.actors) s.add(toDrawioId(a.id));
  for (const e of model.externalSystems) s.add(toDrawioId(e.id));
  for (const c of model.containers) s.add(toDrawioId(c.id));
  for (const c of model.components) s.add(toDrawioId(c.id));
  for (const el of model.codeElements ?? []) s.add(toDrawioId(el.id));
  return s;
}

function collectDrawioFiles(outputDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(outputDir)) return files;
  const stack = [outputDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) stack.push(p);
      else if (entry.endsWith(".drawio")) files.push(p);
    }
  }
  return files;
}

function checkFile(filePath: string, valid: Set<string>): DriftWarning[] {
  let doc;
  try {
    doc = parseDrawioFile(filePath);
  } catch (err) {
    if (err instanceof DrawioParseError) {
      return [
        {
          file: filePath,
          line: 0,
          id: "",
          message: `drawio parse failed: ${err.message}`,
        },
      ];
    }
    throw err;
  }
  const out: DriftWarning[] = [];
  for (const cell of doc.cells.values()) {
    if (!cell.edge) continue;
    for (const endpoint of [cell.source, cell.target]) {
      if (!endpoint) continue;
      if (valid.has(endpoint)) continue;
      const target = doc.cells.get(endpoint);
      if (target && !target.managed) continue;
      out.push({
        file: filePath,
        line: 0,
        id: endpoint,
        message: `Reference to "${endpoint}" not found in architecture model`,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/drift.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/drift.ts tests/generator/drawio/drift.test.ts
git commit -m "feat(drawio): drift detection for stale model references"
```

---

## Task 15: Cleanup — remove stale drawio files

**Files:**
- Create: `src/generator/drawio/cleanup.ts`
- Test: `tests/generator/drawio/cleanup.test.ts`

Rationale: deletes `.drawio` files for containers/components no longer in the model, unless the file contains any unmanaged (freehand) cell.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeStaleDrawioFiles } from "../../../src/generator/drawio/cleanup.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const emptyModel: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [],
  components: [],
  relationships: [],
};

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-dw-clean-"));
}

describe("removeStaleDrawioFiles", () => {
  it("removes container .drawio files when the container is gone", () => {
    const dir = tmp();
    const stale = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(
      stale,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="gone" style="ddocs_managed=1" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
    );
    removeStaleDrawioFiles(dir, emptyModel);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("preserves file when it contains any unmanaged cell", () => {
    const dir = tmp();
    const preserved = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(preserved), { recursive: true });
    fs.writeFileSync(
      preserved,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="note" style="fillColor=#fff2cc" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
    );
    removeStaleDrawioFiles(dir, emptyModel);
    expect(fs.existsSync(preserved)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/cleanup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement removeStaleDrawioFiles**

Create `src/generator/drawio/cleanup.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import { parseDrawioFile } from "./merge.js";
import { toDrawioId } from "./stability.js";

export function removeStaleDrawioFiles(
  outputDir: string,
  model: ArchitectureModel,
): void {
  const validContainerIds = new Set(
    model.containers.map((c) => toDrawioId(c.id)),
  );
  const validComponentIds = new Set(
    model.components.map((c) => toDrawioId(c.id)),
  );
  walk(outputDir, (file) => {
    const rel = path.relative(outputDir, file);
    const match =
      /^containers[/\\]([^/\\]+)(?:[/\\]components[/\\]([^/\\]+))?/.exec(rel);
    if (!match) return;
    const [, container, component] = match;
    const isStaleContainer = container && !validContainerIds.has(container);
    const isStaleComponent = component && !validComponentIds.has(component);
    if (!isStaleContainer && !isStaleComponent) return;
    if (hasUserContent(file)) {
      console.error(
        `Warning: ${rel} contains user-edited cells — preserved; remove manually if no longer needed.`,
      );
      return;
    }
    fs.rmSync(file);
    console.error(`Removed: ${rel}`);
  });
}

function walk(root: string, visit: (file: string) => void): void {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) stack.push(p);
      else if (entry.endsWith(".drawio")) visit(p);
    }
  }
}

function hasUserContent(file: string): boolean {
  try {
    const doc = parseDrawioFile(file);
    for (const cell of doc.cells.values()) {
      if (cell.id === "0" || cell.id === "1") continue;
      if (!cell.managed) return true;
    }
    return false;
  } catch {
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/cleanup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/cleanup.ts tests/generator/drawio/cleanup.test.ts
git commit -m "feat(drawio): remove stale .drawio files for deleted containers/components"
```

---

## Task 16: Submodule orchestration

**Files:**
- Create: `src/generator/drawio/submodule.ts`
- Test: `tests/generator/drawio/submodule.test.ts`

Rationale: emits per-submodule `c3-component.drawio` and per-component `c4-code.drawio`. Reuses `collectAggregatorIds` and `resolveSubmodulePaths` from the D2 submodule scaffold so aggregator-skip logic stays single-sourced.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSubmoduleDrawio } from "../../../src/generator/drawio/submodule.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import { configSchema } from "../../../src/config/schema.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-dw-sub-"));
}

describe("generateSubmoduleDrawio", () => {
  it("writes a c3-component.drawio per non-aggregator container", async () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, "services/auth"), { recursive: true });
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "auth",
          applicationId: "auth",
          name: "Auth",
          description: "",
          technology: "",
          path: "services/auth",
        },
      ],
      components: [
        {
          id: "h",
          containerId: "auth",
          name: "Handler",
          description: "",
          technology: "",
          moduleIds: [],
        },
      ],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: true, docsDir: "docs" },
    });
    await generateSubmoduleDrawio(repo, model, cfg);
    expect(
      fs.existsSync(
        path.join(repo, "services/auth/docs/architecture/c3-component.drawio"),
      ),
    ).toBe(true);
  });

  it("skips aggregator containers", async () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, "apps/parent/child"), { recursive: true });
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "parent",
          applicationId: "parent",
          name: "Parent",
          description: "",
          technology: "",
          path: "apps/parent",
        },
        {
          id: "child",
          applicationId: "child",
          name: "Child",
          description: "",
          technology: "",
          path: "apps/parent/child",
        },
      ],
      components: [],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: true, docsDir: "docs" },
    });
    await generateSubmoduleDrawio(repo, model, cfg);
    expect(
      fs.existsSync(
        path.join(repo, "apps/parent/docs/architecture/c3-component.drawio"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          repo,
          "apps/parent/child/docs/architecture/c3-component.drawio",
        ),
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/submodule.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement generateSubmoduleDrawio**

Create `src/generator/drawio/submodule.ts`:

```typescript
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import {
  collectAggregatorIds,
  resolveSubmodulePaths,
} from "../d2/submodule-scaffold.js";
import { buildComponentCells } from "./component.js";
import { buildCodeCells } from "./code.js";
import { generateDrawioFile } from "./index.js";

export async function generateSubmoduleDrawio(
  repoRoot: string,
  model: ArchitectureModel,
  config: Config,
): Promise<void> {
  const aggregators = collectAggregatorIds(model);
  for (const container of model.containers) {
    if (config.submodules.overrides[container.applicationId]?.exclude) continue;
    if (aggregators.has(container.id)) continue;
    if (container.path === ".") continue;

    const { architectureDir } = resolveSubmodulePaths(
      repoRoot,
      container,
      config,
    );

    if (config.levels.component) {
      const cells = buildComponentCells(model, container.id);
      await generateDrawioFile({
        filePath: path.join(architectureDir, "c3-component.drawio"),
        diagramName: `L3 - ${container.name}`,
        level: "component",
        cells,
      });
    }

    if (config.levels.code) {
      const counts = new Map<string, number>();
      for (const e of model.codeElements ?? []) {
        if (e.containerId !== container.id) continue;
        counts.set(e.componentId, (counts.get(e.componentId) ?? 0) + 1);
      }
      for (const comp of model.components.filter(
        (c) => c.containerId === container.id,
      )) {
        if ((counts.get(comp.id) ?? 0) < config.code.minElements) continue;
        const cells = buildCodeCells(model, comp);
        await generateDrawioFile({
          filePath: path.join(
            architectureDir,
            "components",
            comp.id,
            "c4-code.drawio",
          ),
          diagramName: `L4 - ${comp.name}`,
          level: "code",
          cells,
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/submodule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/submodule.ts tests/generator/drawio/submodule.test.ts
git commit -m "feat(drawio): emit per-submodule .drawio files"
```

---

## Task 17: Wire into the `generate` command

**Files:**
- Modify: `src/cli/commands/generate.ts`

Rationale: `config.output.generators` drives dispatch. D2 path stays unchanged; drawio path runs its own cleanup, builders, orchestrator, and drift. Rendering via the D2 CLI only fires when `d2` is in the list.

- [ ] **Step 1: Add drawio imports**

At the top of `src/cli/commands/generate.ts`, add:

```typescript
import { buildContextCells } from "../../generator/drawio/context.js";
import { buildContainerCells } from "../../generator/drawio/container.js";
import { buildComponentCells } from "../../generator/drawio/component.js";
import { buildCodeCells } from "../../generator/drawio/code.js";
import { generateDrawioFile } from "../../generator/drawio/index.js";
import { removeStaleDrawioFiles } from "../../generator/drawio/cleanup.js";
import { checkDrawioDrift } from "../../generator/drawio/drift.js";
import { generateSubmoduleDrawio } from "../../generator/drawio/submodule.js";
```

- [ ] **Step 2: Branch cleanup by generator**

Replace the three existing cleanup calls
```typescript
removeStaleContainerDirs(outputDir, model);
removeStaleComponentDirs(outputDir, model);
removeStaleSubmoduleComponentDirs(configDir, config, model);
```
with:

```typescript
const generators = config.output.generators;
const runD2 = generators.includes("d2");
const runDrawio = generators.includes("drawio");

if (runD2) {
  removeStaleContainerDirs(outputDir, model);
  removeStaleComponentDirs(outputDir, model);
  removeStaleSubmoduleComponentDirs(configDir, config, model);
}
if (runDrawio) {
  removeStaleDrawioFiles(outputDir, model);
}
```

- [ ] **Step 3: Gate the existing D2 block**

Wrap the existing body — from the `// Ensure output directories exist` mkdir through `scaffoldUserFiles(outputDir, model, config)`, the existing `filesWritten/filesUnchanged` summary logging, `checkDrift(...)`, the `d2Files` collection, `validateD2Files`, `renderD2Files`, and `postProcessSVGs` — inside `if (runD2) { ... }`. Also gate the `if (submodulesOn)` block that calls `removeStaleSubmoduleDirs` and `generateSubmoduleDocs` inside `if (runD2 && submodulesOn)`.

- [ ] **Step 4: Add a parallel drawio block**

Immediately after the D2 block, before `console.error(\`Done in ...\`)`:

```typescript
if (runDrawio) {
  if (config.levels.context) {
    await generateDrawioFile({
      filePath: path.join(outputDir, "c1-context.drawio"),
      diagramName: "L1 - Context",
      level: "context",
      cells: buildContextCells(model),
    });
  }
  if (config.levels.container) {
    await generateDrawioFile({
      filePath: path.join(outputDir, "c2-container.drawio"),
      diagramName: "L2 - Containers",
      level: "container",
      cells: buildContainerCells(model),
    });
  }
  if (config.levels.component && !submodulesOn) {
    for (const container of model.containers) {
      await generateDrawioFile({
        filePath: path.join(
          outputDir,
          "containers",
          container.id,
          "c3-component.drawio",
        ),
        diagramName: `L3 - ${container.name}`,
        level: "component",
        cells: buildComponentCells(model, container.id),
      });
    }
  }
  if (config.levels.code && !submodulesOn) {
    const elemCountByComponent = new Map<string, number>();
    for (const e of model.codeElements ?? []) {
      elemCountByComponent.set(
        e.componentId,
        (elemCountByComponent.get(e.componentId) ?? 0) + 1,
      );
    }
    for (const container of model.containers) {
      for (const component of model.components.filter(
        (c) => c.containerId === container.id,
      )) {
        if (
          (elemCountByComponent.get(component.id) ?? 0) <
          config.code.minElements
        )
          continue;
        await generateDrawioFile({
          filePath: path.join(
            outputDir,
            "containers",
            container.id,
            "components",
            component.id,
            "c4-code.drawio",
          ),
          diagramName: `L4 - ${component.name}`,
          level: "code",
          cells: buildCodeCells(model, component),
        });
      }
    }
  }
  if (submodulesOn) {
    await generateSubmoduleDrawio(configDir, model, config);
  }
  for (const w of checkDrawioDrift(outputDir, model)) {
    console.error(`Warning: ${w.file}: ${w.message}`);
  }
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: mostly pass. Any broken test is likely because `output.generators` now defaults to `["drawio"]`. Fix those tests: if the test asserts D2 output, its fixture config must explicitly set `output.generators: ["d2"]`.

- [ ] **Step 6: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/generate.ts
git commit -m "feat(cli): dispatch drawio generator from generate command"
```

---

## Task 18: End-to-end integration

**Files:**
- Create: `tests/generator/drawio/integration/end-to-end.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import { parseDrawioFile } from "../../../../src/generator/drawio/merge.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

const MODEL: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "" },
  actors: [{ id: "customer", name: "Customer", description: "" }],
  externalSystems: [
    { id: "payments", name: "Payments", description: "", technology: "REST" },
  ],
  containers: [
    { id: "web", applicationId: "web", name: "Web", description: "", technology: "TS" },
    { id: "api", applicationId: "api", name: "API", description: "", technology: "Go" },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    { sourceId: "web", targetId: "api", label: "calls" },
    { sourceId: "api", targetId: "payments", label: "charges" },
  ],
};

describe("drawio end-to-end", () => {
  it("emits a parseable L2 diagram with all expected cell ids", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-e2e-"));
    const out = path.join(dir, "c2-container.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(MODEL),
    });
    const doc = parseDrawioFile(out);
    expect(doc.cells.has("customer")).toBe(true);
    expect(doc.cells.has("system")).toBe(true);
    expect(doc.cells.has("web")).toBe(true);
    expect(doc.cells.has("api")).toBe(true);
    expect(doc.cells.has("payments")).toBe(true);
    const edges = [...doc.cells.values()].filter((c) => c.edge);
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/integration/end-to-end.test.ts`
Expected: PASS (building on earlier tasks).

- [ ] **Step 3: Commit**

```bash
git add tests/generator/drawio/integration/end-to-end.test.ts
git commit -m "test(drawio): end-to-end L2 diagram fixture test"
```

---

## Task 19: Regeneration determinism

**Files:**
- Create: `tests/generator/drawio/integration/regen-determinism.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

const MODEL: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    { id: "a", applicationId: "a", name: "A", description: "", technology: "" },
    { id: "b", applicationId: "b", name: "B", description: "", technology: "" },
  ],
  components: [],
  relationships: [{ sourceId: "a", targetId: "b", label: "uses" }],
};

describe("drawio regen determinism", () => {
  it("produces byte-identical output across two runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-regen-"));
    const out = path.join(dir, "c2-container.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(MODEL),
    });
    const first = fs.readFileSync(out, "utf-8");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(MODEL),
    });
    const second = fs.readFileSync(out, "utf-8");
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/integration/regen-determinism.test.ts`
Expected: PASS. If it fails, inspect the diff — common non-determinism sources are iteration order (use `.sort()` as in `layout.ts` / `stability.ts`) or embedded timestamps (writer must not emit any).

- [ ] **Step 3: Commit**

```bash
git add tests/generator/drawio/integration/regen-determinism.test.ts
git commit -m "test(drawio): assert byte-identical output across reruns"
```

---

## Task 20: User-edit preservation

**Files:**
- Create: `tests/generator/drawio/integration/user-edit-preservation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import { parseDrawioFile } from "../../../../src/generator/drawio/merge.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

const BASE: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    { id: "a", applicationId: "a", name: "A", description: "first", technology: "" },
    { id: "b", applicationId: "b", name: "B", description: "", technology: "" },
  ],
  components: [],
  relationships: [{ sourceId: "a", targetId: "b", label: "uses" }],
};

describe("user-edit preservation", () => {
  it("preserves hand-edited geometry and style across regeneration", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-pres-"));
    const out = path.join(dir, "c2-container.drawio");

    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(BASE),
    });

    let xml = fs.readFileSync(out, "utf-8");
    xml = xml.replace(
      /(id="a"[^>]*style=")[^"]*(")/,
      `$1rounded=1;fillColor=#ff0000;ddocs_managed=1$2`,
    );
    xml = xml.replace(
      /(id="a"[\s\S]*?<mxGeometry )[^>]*(\/>)/,
      `$1x="999" y="777" width="200" height="80" as="geometry"$2`,
    );
    xml = xml.replace(
      /(<\/root>)/,
      `<mxCell id="user-note" value="my note" style="rounded=1;fillColor=#fff2cc" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>$1`,
    );
    fs.writeFileSync(out, xml);

    const updated: ArchitectureModel = {
      ...BASE,
      containers: [
        { ...BASE.containers[0], description: "updated" },
        BASE.containers[1],
      ],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(updated),
    });

    const doc = parseDrawioFile(out);
    const a = doc.cells.get("a")!;
    expect(a.style).toBe("rounded=1;fillColor=#ff0000;ddocs_managed=1");
    expect(a.geometry).toEqual({ x: 999, y: 777, width: 200, height: 80 });
    expect(a.value).toContain("updated");
    const note = doc.cells.get("user-note")!;
    expect(note.managed).toBe(false);
    expect(note.geometry).toEqual({ x: 10, y: 10, width: 120, height: 40 });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/integration/user-edit-preservation.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/generator/drawio/integration/user-edit-preservation.test.ts
git commit -m "test(drawio): preserve user geometry/style and freehand cells across regen"
```

---

## Task 21: Stale deletion integration

**Files:**
- Create: `tests/generator/drawio/integration/stale-deletion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import { parseDrawioFile } from "../../../../src/generator/drawio/merge.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

describe("drawio stale-deletion", () => {
  it("drops removed containers and their edges, keeps freehand", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-stale-"));
    const out = path.join(dir, "c2-container.drawio");

    const full: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "a", applicationId: "a", name: "A", description: "", technology: "" },
        { id: "b", applicationId: "b", name: "B", description: "", technology: "" },
      ],
      components: [],
      relationships: [{ sourceId: "a", targetId: "b", label: "uses" }],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(full),
    });

    let xml = fs.readFileSync(out, "utf-8");
    xml = xml.replace(
      /(<\/root>)/,
      `<mxCell id="note" value="note" style="rounded=1;fillColor=#fff2cc" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>$1`,
    );
    fs.writeFileSync(out, xml);

    const shrunk: ArchitectureModel = {
      ...full,
      containers: [full.containers[0]],
      relationships: [],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(shrunk),
    });

    const doc = parseDrawioFile(out);
    expect(doc.cells.has("b")).toBe(false);
    expect(
      [...doc.cells.values()].some(
        (c) => c.source === "a" && c.target === "b",
      ),
    ).toBe(false);
    expect(doc.cells.has("note")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/integration/stale-deletion.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/generator/drawio/integration/stale-deletion.test.ts
git commit -m "test(drawio): delete stale managed cells and orphan edges, keep freehand"
```

---

## Task 22: Pipeline-level CLI integration

**Files:**
- Create: `tests/integration/drawio-pipeline.test.ts`

Rationale: the Task 17 changes touch the CLI's dispatch logic. A test matching the style of `tests/integration/pipeline.test.ts` drives the real code path, not the generator in isolation.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configSchema } from "../../src/config/schema.js";
import { buildModel } from "../../src/core/model-builder.js";
import type {
  RawStructure,
  ScannedApplication,
} from "../../src/analyzers/types.js";
import { generateDrawioFile } from "../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../src/generator/drawio/container.js";

// Minimal in-memory raw structure (bypasses scanner to keep the test hermetic).
const raw: RawStructure = {
  version: 1,
  scannedAt: "2026-04-20T00:00:00Z",
  checksum: "x",
  applications: [
    {
      id: "web",
      path: "web",
      name: "web",
      language: "typescript",
      buildFile: "package.json",
      modules: [],
      externalDependencies: [],
      internalImports: [],
    } satisfies ScannedApplication,
  ],
};

describe("drawio pipeline integration", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-pipeline-"));
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("generates a drawio file end-to-end through buildModel", async () => {
    const config = configSchema.parse({
      output: { generators: ["drawio"] },
    });
    const model = buildModel({ config, rawStructure: raw });
    await generateDrawioFile({
      filePath: path.join(out, "c2-container.drawio"),
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(model),
    });
    const xml = fs.readFileSync(path.join(out, "c2-container.drawio"), "utf-8");
    expect(xml).toContain("mxfile");
    expect(xml).toContain("ddocs_managed=1");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/integration/drawio-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/drawio-pipeline.test.ts
git commit -m "test(drawio): pipeline integration via buildModel + generateDrawioFile"
```

---

## Task 23: Docs — README and CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md**

Find the section describing output/rendering. Add:

```markdown
### Output generators

diagram-docs can emit diagrams as D2 source or drawio (`.drawio` / mxGraph XML).
The default is **drawio**.

- Stay on D2: `output.generators: ["d2"]` in `diagram-docs.yaml`.
- Run both: `output.generators: ["d2", "drawio"]`.

#### Editing drawio output

Drawio files are written once and then preserved across regenerations:

- Node positions, sizes, colours, and shapes you set in drawio are kept.
- Labels and edge endpoints are refreshed from the model on every run.
- Cells you add by hand (freehand) are kept untouched.
- Cells for containers/components removed from the model are deleted, along
  with any edges that referenced them.

If you rename the auto-generated id of a managed cell by hand, diagram-docs
treats the renamed cell as freehand and re-emits a fresh cell for the
original id. Manage ids through the model, not the drawio editor.

Corrupt drawio files abort the merge and are left untouched — fix the XML
by hand before regenerating.
```

- [ ] **Step 2: Update CLAUDE.md**

In `## What This Is`, change the first sentence to:

```
diagram-docs is a TypeScript CLI that generates C4 architecture diagrams — as drawio (default) or D2 — from source code.
```

In `### Key Modules`, add:

```
- **`src/generator/drawio/`** — Parallel generator emitting `.drawio` (mxGraph XML). Id-based merge preserves hand-edited geometry, style, and freehand cells across regenerations. Uses `fast-xml-parser` for round-trip and `elkjs` for deterministic layout.
```

- [ ] **Step 3: Final validation**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document drawio generator default, merge policy, and D2 opt-out"
```

---

## Self-review checklist

- Spec "Goals" → Tasks 7–10 (per-level builders), Task 12 (merge preserves geometry/style), Task 19 (byte-identical), Task 17 (D2 still runs when configured).
- Spec "File layout" → Tasks 17, 16 emit at the exact paths described.
- Spec "First run and missing files" → Task 11 (`returns empty result when file does not exist`) + Task 13.
- Spec "Regeneration / merge policy" → Task 12 covers matched/new/stale/freehand/parent-reparent/edge-waypoint. Corrupt-XML abort: Task 13.
- Spec "Styles" → Task 4.
- Spec "Merge algorithm" (8 steps) → Tasks 11–13 collectively.
- Spec "Layout strategy" → Task 6 (per-level algorithm, spacing constants).
- Spec "File cleanup and drift" → Tasks 14 (drift) and 15 (cleanup).
- Spec "Submodule mode" → Task 16 + wiring in Task 17.
- Spec "Testing" → Tasks 3–16 unit; Tasks 18–22 integration; Task 11 fixtures.
- Spec "Rollout" → Task 23.
- Spec open questions:
  - **Managed-tag durability**: tag lives inside `style`. First manual round-trip through drawio desktop/web should verify the tag survives save. If stripped, fall back per spec to a sidecar `.drawio-meta` JSON — follow-up task, not in this plan.
  - **Layout library**: elkjs committed in Task 2. `@maxgraph/core` fallback deferred.
- Placeholder scan: no `TBD`, no "add error handling", no "similar to Task N".
- Type consistency: `DiagramCells` / `VertexSpec` / `EdgeSpec` defined in `context.ts` (Task 7); `buildContainerCells` / `buildComponentCells` / `buildCodeCells` (Tasks 8–10) return the same shape; `ResolvedVertex` / `ResolvedEdge` introduced in Task 12 and consumed in Task 13.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-drawio-generator.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
