# drawio Layout Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix drawio L1–L4 rendering issues (stretched actors, overflowing descriptions, diagonal edges with piled-up labels, externals drifting off-page) by sizing nodes per kind, moving descriptions and edge tech tags into drawio tooltips, and switching edges to orthogonal routing.

**Architecture:** Generator-only change inside `src/generator/drawio/`. Introduces a `kind`-driven `nodeSize()` function replacing uniform `NODE_WIDTH/HEIGHT`, a `UserObject` wrapper around `mxCell` for tooltip-carrying nodes, and new ELK/style hints for orthogonal routing with opaque label backgrounds. Merge continues to preserve hand edits by id; detection of managed cells now accepts either the style tag or a `UserObject@ddocs_managed="1"` attribute.

**Tech Stack:** TypeScript (Node16 ESM, `.js` imports), `fast-xml-parser`, `elkjs`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-04-21-drawio-layout-improvements-design.md`

---

## File Structure

| File                                     | Change                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/generator/drawio/styles.ts`         | Extend `relationship` style with orthogonal edgeStyle + opaque label bg.                                                                                                                                    |
| `src/generator/drawio/layout.ts`         | Replace `NODE_WIDTH`/`NODE_HEIGHT` constants with `nodeSize(kind)`; add ELK edge-routing options.                                                                                                           |
| `src/generator/drawio/context.ts`        | Extend `VertexSpec` with `tooltip?` and `kind: StyleKey`; extend `EdgeSpec` with `tooltip?`. Shorten content (description→tooltip).                                                                         |
| `src/generator/drawio/container.ts`      | Set `kind`, move descriptions to `tooltip`, move edge `[tech]` to edge tooltip.                                                                                                                             |
| `src/generator/drawio/component.ts`      | Same treatment for L3.                                                                                                                                                                                      |
| `src/generator/drawio/code.ts`           | Same treatment for L4.                                                                                                                                                                                      |
| `src/generator/drawio/writer.ts`         | Add `tooltip?` to `VertexCell`/`EdgeCell`; emit `<UserObject>` wrapper around the `<mxCell>` when a tooltip is set.                                                                                         |
| `src/generator/drawio/merge.ts`          | Parse `UserObject` wrappers; treat a cell as managed when `UserObject@ddocs_managed="1"` OR style contains `ddocs_managed=1`; propagate `tooltip` through `ExistingCell`, `ResolvedVertex`, `ResolvedEdge`. |
| `src/generator/drawio/drift.ts`          | Escalate a `UserObject` without a child `mxCell` via the existing corrupt-XML path.                                                                                                                         |
| `src/generator/drawio/index.ts`          | Drop `NODE_WIDTH/NODE_HEIGHT` usage; compute each `LayoutNode` width/height from `nodeSize(vertex.kind)`; forward `tooltip` into writer calls.                                                              |
| `tests/generator/drawio/*.test.ts`       | Extend affected tests; add new coverage per spec.                                                                                                                                                           |
| `tests/fixtures/drawio/populated.drawio` | Add a `UserObject` sample so merge/drift tests round-trip both forms.                                                                                                                                       |

---

## Task 1: Prototype UserObject emission (de-risk fast-xml-parser grouping)

**Why first:** Spec calls out fast-xml-parser mixed-element grouping under `<root>` as the primary open risk. Prototype the writer-side emission before the rest of the wiring is built on top of it.

**Files:**

- Modify: `src/generator/drawio/writer.ts`
- Modify: `tests/generator/drawio/writer.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/generator/drawio/writer.test.ts` (append inside `describe("DrawioWriter", ...)`):

```ts
it("wraps vertex in UserObject when tooltip is set", () => {
  const w = new DrawioWriter({ diagramName: "L2" });
  w.addVertex({
    id: "auth",
    value: "Auth",
    tooltip: "JWT-based auth service",
    style: STYLES.container,
    geometry: { x: 0, y: 0, width: 180, height: 70 },
  });
  const xml = w.serialise();
  expect(xml).toContain("<UserObject");
  expect(xml).toContain('id="auth"');
  expect(xml).toContain('label="Auth"');
  expect(xml).toContain('tooltip="JWT-based auth service"');
  expect(xml).toContain('ddocs_managed="1"');
  expect(xml).toMatch(/<UserObject[^>]*>\s*<mxCell[^>]*vertex="1"/);
  expect(xml).not.toMatch(/<mxCell[^>]*value="Auth"/);
});

it("emits plain mxCell when no tooltip is set", () => {
  const w = new DrawioWriter({ diagramName: "L2" });
  w.addVertex({
    id: "auth",
    value: "Auth",
    style: STYLES.container,
    geometry: { x: 0, y: 0, width: 180, height: 70 },
  });
  const xml = w.serialise();
  expect(xml).not.toContain("<UserObject");
  expect(xml).toMatch(/<mxCell[^>]*id="auth"[^>]*value="Auth"/);
});

it("wraps edge in UserObject when tooltip is set", () => {
  const w = new DrawioWriter({ diagramName: "L2" });
  w.addVertex({
    id: "a",
    value: "A",
    style: STYLES.container,
    geometry: { x: 0, y: 0, width: 180, height: 70 },
  });
  w.addVertex({
    id: "b",
    value: "B",
    style: STYLES.container,
    geometry: { x: 300, y: 0, width: 180, height: 70 },
  });
  w.addEdge({
    id: "a->b-uses",
    source: "a",
    target: "b",
    value: "uses",
    tooltip: "[HTTPS/REST]",
    style: STYLES.relationship,
  });
  const xml = w.serialise();
  expect(xml).toMatch(/<UserObject[^>]*id="a-&gt;b-uses"/);
  expect(xml).toContain('label="uses"');
  expect(xml).toContain('tooltip="[HTTPS/REST]"');
  expect(xml).toMatch(/<UserObject[^>]*>\s*<mxCell[^>]*edge="1"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/generator/drawio/writer.test.ts`
Expected: the three new tests FAIL (`<UserObject` not found); the existing four pass.

- [ ] **Step 3: Implement the writer change**

Replace `src/generator/drawio/writer.ts` with:

```ts
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
  tooltip?: string;
  style: string;
  geometry: Geometry;
  parent?: string;
}

export interface EdgeCell {
  id: string;
  source: string;
  target: string;
  value?: string;
  tooltip?: string;
  style: string;
  parent?: string;
  waypoints?: Array<{ x: number; y: number }>;
}

export interface DrawioWriterOptions {
  diagramName: string;
}

type CellNode = Record<string, unknown>;

interface RootChildren {
  mxCell: CellNode[];
  UserObject: CellNode[];
}

export class DrawioWriter {
  private readonly diagramName: string;
  private readonly plainCells: CellNode[] = [];
  private readonly userObjects: CellNode[] = [];

  constructor(options: DrawioWriterOptions) {
    this.diagramName = options.diagramName;
    this.plainCells.push({ "@_id": "0" });
    this.plainCells.push({ "@_id": "1", "@_parent": "0" });
  }

  addVertex(cell: VertexCell): this {
    const geometry = {
      "@_x": String(cell.geometry.x),
      "@_y": String(cell.geometry.y),
      "@_width": String(cell.geometry.width),
      "@_height": String(cell.geometry.height),
      "@_as": "geometry",
    };
    if (cell.tooltip !== undefined) {
      this.userObjects.push({
        "@_id": cell.id,
        "@_label": cell.value,
        "@_tooltip": cell.tooltip,
        "@_ddocs_managed": "1",
        mxCell: {
          "@_style": cell.style,
          "@_vertex": "1",
          "@_parent": cell.parent ?? "1",
          mxGeometry: geometry,
        },
      });
    } else {
      this.plainCells.push({
        "@_id": cell.id,
        "@_value": cell.value,
        "@_style": cell.style,
        "@_vertex": "1",
        "@_parent": cell.parent ?? "1",
        mxGeometry: geometry,
      });
    }
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
    const inner: CellNode = {
      "@_style": cell.style,
      "@_edge": "1",
      "@_parent": cell.parent ?? "1",
      "@_source": cell.source,
      "@_target": cell.target,
      mxGeometry: geom,
    };
    if (cell.tooltip !== undefined) {
      this.userObjects.push({
        "@_id": cell.id,
        "@_label": cell.value ?? "",
        "@_tooltip": cell.tooltip,
        "@_ddocs_managed": "1",
        mxCell: inner,
      });
    } else {
      this.plainCells.push({
        "@_id": cell.id,
        ...(cell.value !== undefined ? { "@_value": cell.value } : {}),
        ...inner,
      });
    }
    return this;
  }

  serialise(): string {
    const root: RootChildren = {
      mxCell: this.plainCells,
      UserObject: this.userObjects,
    };
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
            root,
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

Note: `fast-xml-parser` emits the `mxCell` array first, then the `UserObject` array, so the output groups plain cells ahead of wrapped ones. drawio does not require a specific sibling order inside `<root>`; order is stable run-to-run because both arrays preserve push order. If empty, an array key still serialises to nothing because there are no entries.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/writer.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Manually inspect the emitted XML structure**

Run: `npx vitest run tests/generator/drawio/writer.test.ts -t "wraps vertex in UserObject"` and open the test output in the Vitest reporter. Confirm the nested `<UserObject>` contains exactly one child `<mxCell>` with its `<mxGeometry>` intact. If `fast-xml-parser` emits the `UserObject` at the wrong depth or merges attributes, stop and adjust the tree shape before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/generator/drawio/writer.ts tests/generator/drawio/writer.test.ts
git commit -m "feat(drawio): emit UserObject wrapper when tooltip is set"
```

---

## Task 2: Introduce `nodeSize()` per kind (layout.ts)

**Files:**

- Modify: `src/generator/drawio/layout.ts`
- Modify: `tests/generator/drawio/layout.test.ts`

- [ ] **Step 1: Write the failing test**

Prepend to `tests/generator/drawio/layout.test.ts` (inside the existing file, at the top of the file after the imports):

```ts
import { nodeSize } from "../../../src/generator/drawio/layout.js";

describe("nodeSize", () => {
  it("returns 48x80 for person (narrow shape + label gutter)", () => {
    expect(nodeSize("person")).toEqual({ width: 48, height: 80 });
  });

  it("returns 180x70 for containers, components and externals", () => {
    expect(nodeSize("container")).toEqual({ width: 180, height: 70 });
    expect(nodeSize("component")).toEqual({ width: 180, height: 70 });
    expect(nodeSize("external-system")).toEqual({ width: 180, height: 70 });
  });

  it("returns 160x60 for code kinds (L4 compact)", () => {
    expect(nodeSize("code-class")).toEqual({ width: 160, height: 60 });
    expect(nodeSize("code-fn")).toEqual({ width: 160, height: 60 });
  });

  it("returns 0x0 for boundary/container-like placeholders sized by ELK", () => {
    expect(nodeSize("system")).toEqual({ width: 0, height: 0 });
    expect(nodeSize("system-boundary")).toEqual({ width: 0, height: 0 });
    expect(nodeSize("relationship")).toEqual({ width: 0, height: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/generator/drawio/layout.test.ts`
Expected: new `nodeSize` tests FAIL (`nodeSize` is not exported).

- [ ] **Step 3: Implement `nodeSize()` and remove the constants**

Replace `src/generator/drawio/layout.ts` with:

```ts
import ELKModule from "elkjs/lib/elk.bundled.js";
import type {
  ELK as ElkInstance,
  ELKConstructorArguments,
  ElkNode,
} from "elkjs/lib/elk-api.js";
import type { Geometry } from "./writer.js";
import type { StyleKey } from "./styles.js";

const ELK = ELKModule as unknown as new (
  args?: ELKConstructorArguments,
) => ElkInstance;

export const NODE_SPACING_X = 200;
export const NODE_SPACING_Y = 120;

export interface NodeSize {
  width: number;
  height: number;
}

export function nodeSize(kind: StyleKey): NodeSize {
  switch (kind) {
    case "person":
      return { width: 48, height: 80 };
    case "container":
    case "component":
    case "external-system":
      return { width: 180, height: 70 };
    case "code-class":
    case "code-fn":
      return { width: 160, height: 60 };
    case "system":
    case "system-boundary":
    case "relationship":
      return { width: 0, height: 0 };
  }
}

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

  const buildElkNode = (id: string): ElkNode => {
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
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(NODE_SPACING_Y),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(NODE_SPACING_X),
      "elk.layered.spacing.edgeNodeBetweenLayers": "40",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "30",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: rootIds.map(buildElkNode),
    edges: [...input.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const laidOut = await elk.layout(graph);
  const result = new Map<string, Geometry>();
  collect(laidOut, result);
  return result;
}

/**
 * Walk the ELK layout tree and emit one {@link Geometry} per node.
 *
 * ELK already reports each child's x/y relative to its immediate parent's
 * origin. In drawio/mxGraph XML, an {@code mxCell} whose {@code parent}
 * attribute references another vertex is likewise rendered with its
 * {@code mxGeometry} x/y interpreted relative to the parent's origin. So we
 * emit ELK's parent-relative coordinates verbatim and let the writer/merger
 * pass them through unchanged.
 *
 * Top-level ELK children (whose parent is the synthetic {@code "root"}) end
 * up as direct children of the drawio background layer (mxCell id="1"),
 * which has origin (0, 0); relative and absolute coincide for them.
 */
function collect(node: ElkNode, out: Map<string, Geometry>): void {
  if (node.id && node.id !== "root") {
    out.set(node.id, {
      x: Math.round(node.x ?? 0),
      y: Math.round(node.y ?? 0),
      width: Math.round(node.width ?? 0),
      height: Math.round(node.height ?? 0),
    });
  }
  for (const child of node.children ?? []) {
    collect(child, out);
  }
}
```

- [ ] **Step 4: Update the existing layout tests that reference `NODE_WIDTH`/`NODE_HEIGHT`**

In `tests/generator/drawio/layout.test.ts`, replace the `import { layoutGraph, NODE_WIDTH, NODE_HEIGHT }` line with:

```ts
import { layoutGraph, nodeSize } from "../../../src/generator/drawio/layout.js";

const NODE_W = nodeSize("container").width;
const NODE_H = nodeSize("container").height;
```

Then `sed`-style replace every `NODE_WIDTH` with `NODE_W` and every `NODE_HEIGHT` with `NODE_H` in that file (use Edit `replace_all: true` twice). This keeps the existing tests valid while the public constants go away.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/layout.test.ts`
Expected: all tests (old and new) PASS.

- [ ] **Step 6: Commit**

```bash
git add src/generator/drawio/layout.ts tests/generator/drawio/layout.test.ts
git commit -m "refactor(drawio): replace uniform node size with nodeSize(kind)"
```

---

## Task 3: Wire `kind` through `VertexSpec` and `index.ts`

**Files:**

- Modify: `src/generator/drawio/context.ts`
- Modify: `src/generator/drawio/index.ts`
- Modify: `src/generator/drawio/merge.ts`
- Modify: `tests/generator/drawio/index.test.ts`

- [ ] **Step 1: Write the failing test**

Inspect `tests/generator/drawio/index.test.ts` and add this test at the bottom (inside the existing `describe`):

```ts
it("sizes person vertex at 48x80 via nodeSize(kind)", async () => {
  const filePath = path.join(tmpDir, "size-test.drawio");
  await generateDrawioFile({
    filePath,
    diagramName: "L1",
    level: "context",
    cells: {
      vertices: [
        {
          id: "user",
          value: "User\n[Person]",
          style: STYLES.person,
          kind: "person",
        },
        {
          id: "svc",
          value: "Svc\n[Container: Go]",
          style: STYLES.container,
          kind: "container",
        },
      ],
      edges: [
        {
          id: "user->svc-uses",
          source: "user",
          target: "svc",
          value: "uses",
          style: STYLES.relationship,
        },
      ],
    },
  });
  const xml = fs.readFileSync(filePath, "utf-8");
  expect(xml).toMatch(/id="user"[\s\S]*?width="48"[^>]*height="80"/);
  expect(xml).toMatch(/id="svc"[\s\S]*?width="180"[^>]*height="70"/);
});
```

If the file doesn't already import `STYLES`/`fs`/`path`, add them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/index.test.ts`
Expected: either a type error about missing `kind`, or the width/height assertions FAIL (currently everything is 160x60).

- [ ] **Step 3: Add `kind` to `VertexSpec` and propagate**

Edit `src/generator/drawio/context.ts`. Import `StyleKey` and extend `VertexSpec`:

```ts
import type { StyleKey } from "./styles.js";

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
```

Leave the existing context-level construction as-is for now — the next task fills in tooltips; this task only fixes the compile.

In `buildContextCells`, add `kind` to every `vertices.push({...})` site without other changes. The existing three sites map to:

```ts
// actor
vertices.push({
  id: toDrawioId(a.id),
  value: `${a.name}\n[Person]\n${a.description}`,
  style: STYLES.person,
  kind: "person",
});

// system
vertices.push({
  id: "system",
  value: `${model.system.name}\n[Software System]\n${model.system.description}`,
  style: STYLES.system,
  kind: "system",
});

// external
vertices.push({
  id: toDrawioId(e.id),
  value: `${e.name}\n[External System]${e.technology ? `\n[${e.technology}]` : ""}\n${e.description}`,
  style: STYLES["external-system"],
  kind: "external-system",
});
```

- [ ] **Step 4: Update container/component/code builders**

In `src/generator/drawio/container.ts`, add `kind` to every `vertices.push({...})`:

- actor push → `kind: "person"`
- system-boundary push (id `"system"`) → `kind: "system-boundary"`
- container push → `kind: "container"`
- external push → `kind: "external-system"`

In `src/generator/drawio/component.ts`:

- container boundary push → `kind: "system-boundary"`
- component push → `kind: "component"`
- external ref push → `kind: "external-system"`
- container ref push → `kind: "container"`
- component ref push → `kind: "component"`
- fallback push → `kind: "component"`

In `src/generator/drawio/code.ts`:

- component boundary push → `kind: "system-boundary"`
- element push → `kind: styleFor(el) === STYLES["code-class"] ? "code-class" : "code-fn"` — implemented by introducing a helper:

```ts
function kindFor(el: CodeElement): StyleKey {
  return CONTAINER_KINDS.has(el.kind) ? "code-class" : "code-fn";
}
```

and a `StyleKey` import; then use `kind: kindFor(el)`.

- external code ref push → `kind: "code-class"`.

- [ ] **Step 5: Consume `kind` in `index.ts`**

Replace the `layoutNodes` block in `src/generator/drawio/index.ts`:

```ts
import {
  layoutGraph,
  nodeSize,
  type Level,
  type LayoutNode,
} from "./layout.js";

// ...

const layoutNodes: LayoutNode[] = input.cells.vertices.map((v) => {
  const kids = childrenOf.get(v.id);
  const base = nodeSize(v.kind);
  const { width: baseW, height: baseH } =
    base.width > 0 ? base : nodeSize("container");
  return {
    id: v.id,
    width:
      kids && kids.length > 0
        ? Math.max(baseW * 2, kids.length * baseW)
        : baseW,
    height: kids && kids.length > 0 ? baseH * 3 : baseH,
    children: kids,
  };
});
```

The `base.width > 0` branch keeps container-like placeholders (system, system-boundary) sized by ELK from their children via the fallback; `nodeSize("container")` is only used to compute the minimum envelope when ELK needs a seed size.

Also remove the `NODE_WIDTH`/`NODE_HEIGHT` imports from `index.ts`.

- [ ] **Step 6: Propagate `kind` through reconcile**

In `src/generator/drawio/merge.ts`, the `ResolvedVertex` extends `VertexSpec`, which already gains the `kind` field. The fallback path (unmanaged freehand cells revived from existing XML) currently pushes a cell without a `kind`. Fix that by tagging freehand vertices as `"container"` (any non-zero kind works because freehand geometry is preserved verbatim and never re-sized):

```ts
vertices.push({
  id: cell.id,
  value: cell.value ?? "",
  style: cell.style,
  parent: cell.parent,
  geometry: cell.geometry,
  kind: "container",
});
```

- [ ] **Step 7: Run full drawio test suite**

Run: `npx vitest run tests/generator/drawio/`
Expected: all tests pass, including the new size assertion from Step 1.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/generator/drawio/ tests/generator/drawio/
git commit -m "refactor(drawio): pass StyleKey through VertexSpec and index.ts"
```

---

## Task 4: Orthogonal edge style + opaque label backgrounds

**Files:**

- Modify: `src/generator/drawio/styles.ts`
- Modify: `tests/generator/drawio/styles.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/generator/drawio/styles.test.ts`:

```ts
it("relationship style enables orthogonal routing with opaque labels", () => {
  expect(STYLES.relationship).toContain("edgeStyle=orthogonalEdgeStyle");
  expect(STYLES.relationship).toContain("curved=0");
  expect(STYLES.relationship).toContain("labelBackgroundColor=#ffffff");
  expect(STYLES.relationship).toContain("labelBorderColor=none");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/styles.test.ts`
Expected: FAIL — `edgeStyle=orthogonalEdgeStyle` not present.

- [ ] **Step 3: Update the `relationship` style**

In `src/generator/drawio/styles.ts`, replace the `relationship` entry of `BASE` with:

```ts
relationship:
  "endArrow=classic;html=1;rounded=0;strokeColor=#707070;fontSize=11;" +
  "edgeStyle=orthogonalEdgeStyle;curved=0;" +
  "labelBackgroundColor=#ffffff;labelBorderColor=none",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/generator/drawio/styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/styles.ts tests/generator/drawio/styles.test.ts
git commit -m "style(drawio): orthogonal edge routing + opaque label backgrounds"
```

---

## Task 5: Flow tooltips through reconcile into the writer

**Files:**

- Modify: `src/generator/drawio/merge.ts`
- Modify: `src/generator/drawio/index.ts`
- Modify: `tests/generator/drawio/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/generator/drawio/index.test.ts`:

```ts
it("propagates vertex and edge tooltips through to the serialised XML", async () => {
  const filePath = path.join(tmpDir, "tooltip-flow.drawio");
  await generateDrawioFile({
    filePath,
    diagramName: "L2",
    level: "container",
    cells: {
      vertices: [
        {
          id: "svc",
          value: "Svc\n[Container: Go]",
          tooltip: "HTTP API over Postgres",
          style: STYLES.container,
          kind: "container",
        },
        {
          id: "db",
          value: "DB\n[Container: Postgres]",
          tooltip: "Primary relational store",
          style: STYLES.container,
          kind: "container",
        },
      ],
      edges: [
        {
          id: "svc->db-reads",
          source: "svc",
          target: "db",
          value: "reads",
          tooltip: "[JDBC]",
          style: STYLES.relationship,
        },
      ],
    },
  });
  const xml = fs.readFileSync(filePath, "utf-8");
  expect(xml).toContain('tooltip="HTTP API over Postgres"');
  expect(xml).toContain('tooltip="Primary relational store"');
  expect(xml).toContain('tooltip="[JDBC]"');
  expect(xml).toMatch(/<UserObject[^>]*id="svc-&gt;db-reads"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/index.test.ts -t "propagates vertex and edge tooltips"`
Expected: FAIL — no `tooltip="..."` attributes appear yet.

- [ ] **Step 3: Extend `ExistingCell`, `ResolvedVertex`, `ResolvedEdge` with `tooltip`**

In `src/generator/drawio/merge.ts`:

```ts
export interface ExistingCell {
  id: string;
  value?: string;
  tooltip?: string;
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

export interface ResolvedVertex extends VertexSpec {
  geometry: Geometry;
}

export interface ResolvedEdge extends EdgeSpec {
  waypoints?: Array<{ x: number; y: number }>;
}
```

(`VertexSpec`/`EdgeSpec` already carry `tooltip?` after Task 3, so `ResolvedVertex`/`ResolvedEdge` inherit it automatically.)

Inside `reconcile`, pass fresh tooltips through unchanged. The existing `...v` spread in the freshly placed branch already carries `tooltip`. In the preserved-managed branch (where `prior.style` and `prior.geometry` are reused), the fresh `tooltip` also needs to win:

```ts
vertices.push({
  ...v, // carries fresh value, tooltip, kind
  style: prior.style,
  geometry: prior.geometry,
  parent:
    prior.parent && freshVertexIds.has(prior.parent) ? prior.parent : v.parent,
});
```

This is already correct; no change needed as long as `...v` is used first.

For the unmanaged-freehand revival branch at the bottom, preserve any `tooltip` the existing cell already had (parsed later in Task 7):

```ts
vertices.push({
  id: cell.id,
  value: cell.value ?? "",
  tooltip: cell.tooltip,
  style: cell.style,
  parent: cell.parent,
  geometry: cell.geometry,
  kind: "container",
});
```

Edges need the same `tooltip` passthrough in the fresh loop; it is already carried by `...e`.

For the unmanaged edge revival path:

```ts
edges.push({
  id,
  source: cell.source,
  target: cell.target,
  value: cell.value,
  tooltip: cell.tooltip,
  style: cell.style,
  parent: cell.parent,
});
```

- [ ] **Step 4: Forward `tooltip` in `index.ts`**

In `src/generator/drawio/index.ts`, adjust the two writer loops:

```ts
for (const v of result.vertices) {
  writer.addVertex({
    id: v.id,
    value: v.value,
    tooltip: v.tooltip,
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
    tooltip: e.tooltip,
    style: e.style,
    parent: e.parent,
    waypoints: e.waypoints,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/index.test.ts`
Expected: PASS including the new tooltip assertion.

- [ ] **Step 6: Commit**

```bash
git add src/generator/drawio/merge.ts src/generator/drawio/index.ts tests/generator/drawio/index.test.ts
git commit -m "feat(drawio): thread tooltip through reconcile and writer wiring"
```

---

## Task 6: Parse `UserObject` wrappers in merge.ts

**Files:**

- Modify: `src/generator/drawio/merge.ts`
- Modify: `tests/fixtures/drawio/populated.drawio`
- Modify: `tests/generator/drawio/merge.test.ts`

- [ ] **Step 1: Extend the fixture**

Edit `tests/fixtures/drawio/populated.drawio`. Add a `<UserObject>` sibling to the existing `<root>` (just before the `my-note` freehand cell):

```xml
<UserObject id="orders" label="Orders" tooltip="Main orders service" ddocs_managed="1">
  <mxCell style="rounded=1;fillColor=#438DD5" vertex="1" parent="1">
    <mxGeometry x="200" y="200" width="180" height="70" as="geometry"/>
  </mxCell>
</UserObject>
```

Note: the inner `<mxCell>` deliberately omits `ddocs_managed=1` from the style string — the `UserObject@ddocs_managed` attribute is the source of truth on wrapped cells.

- [ ] **Step 2: Write the failing tests**

Append to `tests/generator/drawio/merge.test.ts`:

```ts
it("extracts UserObject-wrapped cells as managed with tooltip preserved", () => {
  const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
  const orders = result.cells.get("orders");
  expect(orders).toBeDefined();
  expect(orders!.managed).toBe(true);
  expect(orders!.vertex).toBe(true);
  expect(orders!.value).toBe("Orders");
  expect(orders!.tooltip).toBe("Main orders service");
  expect(orders!.geometry).toEqual({ x: 200, y: 200, width: 180, height: 70 });
});

it("treats attribute-based ddocs_managed as managed even when style lacks the tag", () => {
  const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
  const orders = result.cells.get("orders")!;
  expect(orders.style).not.toContain("ddocs_managed=1");
  expect(orders.managed).toBe(true);
});
```

And to the `reconcile` `describe`, add:

```ts
it("round-trips a UserObject-managed cell across regen without losing overrides", () => {
  const existing = {
    cells: new Map([
      [
        "orders",
        {
          id: "orders",
          value: "Orders",
          tooltip: "Saved tooltip",
          style: "rounded=1;fillColor=#aa0000",
          vertex: true,
          edge: false,
          parent: "1",
          geometry: { x: 500, y: 500, width: 220, height: 90 },
          managed: true,
        },
      ],
    ]),
  } as ExistingDocument;
  const fresh = {
    vertices: [
      {
        id: "orders",
        value: "Orders v2",
        tooltip: "Fresh tooltip",
        style: STYLES.container,
        kind: "container" as const,
      },
    ],
    edges: [],
  };
  const layout = new Map([["orders", layoutGeom(0, 0)]]);
  const result = reconcile({ existing, fresh, layout });
  const orders = result.vertices[0];
  expect(orders.value).toBe("Orders v2");
  expect(orders.tooltip).toBe("Fresh tooltip");
  expect(orders.style).toBe("rounded=1;fillColor=#aa0000");
  expect(orders.geometry).toEqual({
    x: 500,
    y: 500,
    width: 220,
    height: 90,
  });
});
```

Also update any existing `reconcile` test fixtures where `fresh.vertices` entries lack `kind` — add `kind: "container" as const` to each.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/generator/drawio/merge.test.ts`
Expected: new UserObject tests FAIL; type errors may also block `kind:` updates until applied.

- [ ] **Step 4: Implement UserObject parsing**

Rewrite `parseDrawioFile` and the helpers in `src/generator/drawio/merge.ts`:

```ts
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

  const rootNode = extractRootNode(tree);
  if (!rootNode) {
    throw new DrawioParseError(
      filePath,
      new Error(
        "unexpected structure: no mxfile > diagram > mxGraphModel > root",
      ),
    );
  }

  const cells = new Map<string, ExistingCell>();
  for (const raw of iteratePlainCells(rootNode)) {
    const cell = toExistingCellFromPlain(raw);
    if (cell) cells.set(cell.id, cell);
  }
  for (const raw of iterateUserObjects(rootNode)) {
    const cell = toExistingCellFromUserObject(raw, filePath);
    if (cell) cells.set(cell.id, cell);
  }
  return { cells };
}

function extractRootNode(tree: unknown): Record<string, unknown> | null {
  const mxfile = (tree as Record<string, unknown>)?.mxfile as
    | Record<string, unknown>
    | undefined;
  const diag = mxfile?.diagram as Record<string, unknown> | undefined;
  const model = diag?.mxGraphModel as Record<string, unknown> | undefined;
  const root = model?.root as Record<string, unknown> | undefined;
  return root ?? null;
}

function iteratePlainCells(root: Record<string, unknown>): unknown[] {
  const cells = root.mxCell;
  if (!cells) return [];
  return Array.isArray(cells) ? cells : [cells];
}

function iterateUserObjects(root: Record<string, unknown>): unknown[] {
  const objs = root.UserObject;
  if (!objs) return [];
  return Array.isArray(objs) ? objs : [objs];
}

function toExistingCellFromPlain(raw: unknown): ExistingCell | null {
  const r = raw as Record<string, unknown>;
  const id = r["@_id"] as string | undefined;
  if (!id) return null;
  const style = String(r["@_style"] ?? "");
  const vertex = String(r["@_vertex"] ?? "") === "1";
  const edge = String(r["@_edge"] ?? "") === "1";
  const geometryNode = r["mxGeometry"] as Record<string, unknown> | undefined;
  return {
    id,
    value: r["@_value"] as string | undefined,
    tooltip: r["@_tooltip"] as string | undefined,
    style,
    vertex,
    edge,
    parent: r["@_parent"] as string | undefined,
    source: r["@_source"] as string | undefined,
    target: r["@_target"] as string | undefined,
    geometry: parseGeometry(geometryNode),
    waypoints: parseWaypoints(geometryNode),
    managed: isManagedStyle(style),
  };
}

function toExistingCellFromUserObject(
  raw: unknown,
  filePath: string,
): ExistingCell | null {
  const r = raw as Record<string, unknown>;
  const id = r["@_id"] as string | undefined;
  if (!id) return null;
  const inner = r.mxCell as Record<string, unknown> | undefined;
  if (!inner) {
    throw new DrawioParseError(
      filePath,
      new Error(`UserObject "${id}" is missing child mxCell`),
    );
  }
  const style = String(inner["@_style"] ?? "");
  const vertex = String(inner["@_vertex"] ?? "") === "1";
  const edge = String(inner["@_edge"] ?? "") === "1";
  const geometryNode = inner["mxGeometry"] as
    | Record<string, unknown>
    | undefined;
  const attrManaged = String(r["@_ddocs_managed"] ?? "") === "1";
  return {
    id,
    value: r["@_label"] as string | undefined,
    tooltip: r["@_tooltip"] as string | undefined,
    style,
    vertex,
    edge,
    parent: inner["@_parent"] as string | undefined,
    source: inner["@_source"] as string | undefined,
    target: inner["@_target"] as string | undefined,
    geometry: parseGeometry(geometryNode),
    waypoints: parseWaypoints(geometryNode),
    managed: attrManaged || isManagedStyle(style),
  };
}
```

Delete the old `extractCells` helper now that `extractRootNode` + `iteratePlainCells` replace it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/merge.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full drawio suite**

Run: `npx vitest run tests/generator/drawio/`
Expected: PASS across the board.

- [ ] **Step 7: Commit**

```bash
git add src/generator/drawio/merge.ts tests/fixtures/drawio/populated.drawio tests/generator/drawio/merge.test.ts
git commit -m "feat(drawio): parse UserObject wrappers and attribute-based managed flag"
```

---

## Task 7: Escalate invalid `UserObject` in drift.ts

**Files:**

- Modify: `src/generator/drawio/drift.ts` (no code change expected — verify existing escalation path covers the new case)
- Modify: `tests/generator/drawio/drift.test.ts`
- Modify: `tests/fixtures/drawio/` — add a `userobject-missing-mxcell.drawio` fixture

- [ ] **Step 1: Add the bad fixture**

Create `tests/fixtures/drawio/userobject-missing-mxcell.drawio`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="diagram-docs" type="device">
  <diagram name="broken">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <UserObject id="orphan" label="Orphan" tooltip="no child" ddocs_managed="1"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

- [ ] **Step 2: Write the failing test**

Append to `tests/generator/drawio/drift.test.ts`:

```ts
it("emits an error-severity warning when a UserObject has no child mxCell", () => {
  const fixtureDir = path.resolve(__dirname, "../../fixtures/drawio");
  const warnings = checkDrawioDrift(fixtureDir, {
    version: 1,
    system: { name: "S", description: "" },
    actors: [],
    externalSystems: [],
    containers: [],
    components: [],
    relationships: [],
  });
  const bad = warnings.find((w) =>
    w.file.endsWith("userobject-missing-mxcell.drawio"),
  );
  expect(bad).toBeDefined();
  expect(bad!.severity).toBe("error");
  expect(bad!.message).toContain("missing child mxCell");
});
```

Depending on the existing test scaffolding you may need to isolate the new fixture so unrelated fixtures don't trip assertions. If the existing drift tests also walk `tests/fixtures/drawio/`, move the new file under a subdirectory `tests/fixtures/drawio/drift-invalid/` and adjust the `fixtureDir` path accordingly.

- [ ] **Step 3: Run test to verify it fails, or confirm it already passes**

Run: `npx vitest run tests/generator/drawio/drift.test.ts`

The current `drift.ts` catches `DrawioParseError` and emits `severity: "error"` with `err.detail` as the message. Task 6's `parseDrawioFile` throws a `DrawioParseError` whose detail reads `UserObject "orphan" is missing child mxCell`. The test should therefore PASS without additional code changes. If it fails, audit the drift path (`checkFile` in `drift.ts`) and make sure it propagates the parse error the same way the corrupt-XML case does.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/drawio/ tests/generator/drawio/drift.test.ts
git commit -m "test(drawio): verify drift flags UserObject without child mxCell"
```

---

## Task 8: Shorten content + set tooltip in `container.ts`

**Files:**

- Modify: `src/generator/drawio/container.ts`
- Modify: `tests/generator/drawio/container.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `tests/generator/drawio/container.test.ts` with an expanded version. Extend the fixture model so descriptions and technology are populated, then add assertions:

```ts
import { describe, it, expect } from "vitest";
import { buildContainerCells } from "../../../src/generator/drawio/container.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "desc" },
  actors: [
    { id: "customer", name: "Customer", description: "A paying customer" },
  ],
  externalSystems: [
    {
      id: "payment",
      name: "Payment",
      description: "Stripe adapter",
      technology: "REST",
    },
  ],
  containers: [
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "Storefront UI",
      technology: "TS",
    },
    {
      id: "api",
      applicationId: "api",
      name: "API",
      description: "Public HTTP API",
      technology: "Go",
    },
    {
      id: "orphan",
      applicationId: "orphan",
      name: "Orphan",
      description: "unused",
      technology: "?",
    },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    {
      sourceId: "web",
      targetId: "api",
      label: "calls",
      technology: "JSON over HTTPS",
    },
    {
      sourceId: "api",
      targetId: "payment",
      label: "charges",
      technology: "REST",
    },
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
    expect(
      edges.find((e) => e.source === "web" && e.target === "api"),
    ).toBeDefined();
  });

  it("keeps description out of vertex value and surfaces it as tooltip", () => {
    const { vertices } = buildContainerCells(model);
    const web = vertices.find((v) => v.id === "web")!;
    expect(web.value).toBe("Web\n[Container: TS]");
    expect(web.tooltip).toBe("Storefront UI");
    const customer = vertices.find((v) => v.id === "customer")!;
    expect(customer.value).toBe("Customer\n[Person]");
    expect(customer.tooltip).toBe("A paying customer");
    const payment = vertices.find((v) => v.id === "payment")!;
    expect(payment.value).toBe("Payment\n[External System]\n[REST]");
    expect(payment.tooltip).toBe("Stripe adapter");
  });

  it("keeps edge labels short and moves [tech] into edge tooltip", () => {
    const { edges } = buildContainerCells(model);
    const webToApi = edges.find(
      (e) => e.source === "web" && e.target === "api",
    )!;
    expect(webToApi.value).toBe("calls");
    expect(webToApi.tooltip).toBe("[JSON over HTTPS]");
  });

  it("tags every vertex with the matching StyleKey", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "customer")?.kind).toBe("person");
    expect(vertices.find((v) => v.id === "system")?.kind).toBe(
      "system-boundary",
    );
    expect(vertices.find((v) => v.id === "web")?.kind).toBe("container");
    expect(vertices.find((v) => v.id === "payment")?.kind).toBe(
      "external-system",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/generator/drawio/container.test.ts`
Expected: the new assertions FAIL — current code embeds `description` in `value` and the tech tag in edge `value`.

- [ ] **Step 3: Update `src/generator/drawio/container.ts`**

Replace the actor / container / external / edge emission blocks with:

```ts
for (const a of sortById(model.actors)) {
  vertices.push({
    id: toDrawioId(a.id),
    value: `${a.name}\n[Person]`,
    tooltip: a.description || undefined,
    style: STYLES.person,
    kind: "person",
  });
}

vertices.push({
  id: "system",
  value: `${model.system.name}\n[Software System]`,
  style: STYLES["system-boundary"],
  kind: "system-boundary",
});

for (const c of sortById(model.containers)) {
  if (!connected.has(c.id)) continue;
  vertices.push({
    id: toDrawioId(c.id),
    value: `${c.name}\n[Container: ${c.technology}]`,
    tooltip: c.description || undefined,
    style: STYLES.container,
    kind: "container",
    parent: "system",
  });
}

for (const e of sortById(model.externalSystems)) {
  const typeTag = e.tags?.includes("library")
    ? "[Library]"
    : "[External System]";
  const techLine = e.technology ? `\n[${e.technology}]` : "";
  vertices.push({
    id: toDrawioId(e.id),
    value: `${e.name}\n${typeTag}${techLine}`,
    tooltip: e.description || undefined,
    style: STYLES["external-system"],
    kind: "external-system",
  });
}

for (const r of resolved) {
  edges.push({
    id: edgeId(r.src, r.tgt, r.label),
    source: toDrawioId(r.src),
    target: toDrawioId(r.tgt),
    value: r.label,
    tooltip: r.tech ? `[${r.tech}]` : undefined,
    style: STYLES.relationship,
  });
}
```

The `|| undefined` guard keeps empty descriptions from producing empty-string tooltips (which would still emit a `tooltip=""` attribute on the UserObject and confuse drawio). When the description is empty, no `UserObject` wrapper is emitted — the cell falls back to a plain `<mxCell>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/container.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/container.ts tests/generator/drawio/container.test.ts
git commit -m "feat(drawio): move container descriptions and edge tech to tooltips"
```

---

## Task 9: Shorten content + set tooltip in `context.ts`

**Files:**

- Modify: `src/generator/drawio/context.ts`
- Modify: `tests/generator/drawio/context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/generator/drawio/context.test.ts`:

```ts
it("keeps descriptions out of the actor/system/external values and uses tooltips", () => {
  const { vertices } = buildContextCells(model);
  const actor = vertices.find((v) => v.id === "customer")!;
  expect(actor.value).toBe("Customer\n[Person]");
  expect(actor.tooltip).toBe("A paying customer");
  const system = vertices.find((v) => v.id === "system")!;
  expect(system.value).toBe("Shop\n[Software System]");
  expect(system.tooltip).toBe("desc");
  const external = vertices.find((v) => v.id === "payment")!;
  expect(external.value).toBe("Payment\n[External System]\n[REST]");
  expect(external.tooltip).toBe("Stripe adapter");
});

it("moves edge tech tag into the edge tooltip and keeps the value to the label", () => {
  const { edges } = buildContextCells(model);
  const [edge] = edges;
  expect(edge.value).toBe("uses");
  expect(edge.tooltip).toBeUndefined();
});
```

Update the fixture `model` at the top of `tests/generator/drawio/context.test.ts` so `actors`, `externalSystems`, and `system` have non-empty descriptions, and at least one relationship carries `technology`. (Follow the shape from Task 8's container fixture.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/generator/drawio/context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `src/generator/drawio/context.ts`**

Rewrite each emission site:

```ts
for (const a of sortById(model.actors)) {
  vertices.push({
    id: toDrawioId(a.id),
    value: `${a.name}\n[Person]`,
    tooltip: a.description || undefined,
    style: STYLES.person,
    kind: "person",
  });
}

vertices.push({
  id: "system",
  value: `${model.system.name}\n[Software System]`,
  tooltip: model.system.description || undefined,
  style: STYLES.system,
  kind: "system",
});

for (const e of externals) {
  const techLine = e.technology ? `\n[${e.technology}]` : "";
  vertices.push({
    id: toDrawioId(e.id),
    value: `${e.name}\n[External System]${techLine}`,
    tooltip: e.description || undefined,
    style: STYLES["external-system"],
    kind: "external-system",
  });
}
```

Edge emission:

```ts
edges.push({
  id: edgeId(src, tgt, rel.label),
  source: src,
  target: tgt,
  value: rel.label,
  tooltip: rel.technology ? `[${rel.technology}]` : undefined,
  style: STYLES.relationship,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/context.ts tests/generator/drawio/context.test.ts
git commit -m "feat(drawio): move context-level descriptions and edge tech to tooltips"
```

---

## Task 10: Shorten content + set tooltip in `component.ts`

**Files:**

- Modify: `src/generator/drawio/component.ts`
- Modify: `tests/generator/drawio/component.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/generator/drawio/component.test.ts`:

```ts
it("moves component description to tooltip and keeps value compact", () => {
  // Replace or augment the existing fixture with at least one component that
  // has a non-empty description and a tech-tagged relationship to an external.
  const { vertices, edges } = buildComponentCells(model, "api");
  const comp = vertices.find((v) => v.kind === "component")!;
  expect(comp.value).toBe(
    `${comp.value.split("\n")[0]}\n[Component: ${
      model.components.find((c) => c.id === comp.id)!.technology
    }]`,
  );
  expect(comp.tooltip).toBe(
    model.components.find((c) => c.id === comp.id)!.description,
  );
  const extEdge = edges.find((e) => e.tooltip !== undefined);
  expect(extEdge?.value).not.toContain("[");
});
```

If the existing `component.test.ts` fixture lacks a component with a description and a tech relationship, extend it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/generator/drawio/component.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `src/generator/drawio/component.ts`**

Rewrite each emission:

```ts
vertices.push({
  id: toDrawioId(container.id),
  value: `${container.name}\n[Container: ${container.technology}]`,
  style: STYLES["system-boundary"],
  kind: "system-boundary",
});

for (const c of sortById(localComponents)) {
  vertices.push({
    id: toDrawioId(c.id),
    value: `${c.name}\n[Component: ${c.technology}]`,
    tooltip: c.description || undefined,
    style: STYLES.component,
    kind: "component",
    parent: toDrawioId(container.id),
  });
}

for (const rid of [...refIds].sort()) {
  const ext = model.externalSystems.find((e) => e.id === rid);
  const otherContainer = model.containers.find((c) => c.id === rid);
  const otherComp = model.components.find((c) => c.id === rid);

  if (ext) {
    vertices.push({
      id: toDrawioId(rid),
      value: `${ext.name}\n[External System]`,
      tooltip: ext.description || undefined,
      style: STYLES["external-system"],
      kind: "external-system",
    });
  } else if (otherContainer) {
    vertices.push({
      id: toDrawioId(rid),
      value: `${otherContainer.name}\n[Container: ${otherContainer.technology}]`,
      tooltip: otherContainer.description || undefined,
      style: STYLES.container,
      kind: "container",
    });
  } else if (otherComp) {
    vertices.push({
      id: toDrawioId(rid),
      value: `${otherComp.name}\n[Component: ${otherComp.technology}]`,
      tooltip: otherComp.description || undefined,
      style: STYLES.component,
      kind: "component",
    });
  } else {
    vertices.push({
      id: toDrawioId(rid),
      value: rid,
      style: STYLES.component,
      kind: "component",
    });
  }
}

for (const r of sortRelationships(rels)) {
  edges.push({
    id: edgeId(r.sourceId, r.targetId, r.label),
    source: toDrawioId(r.sourceId),
    target: toDrawioId(r.targetId),
    value: r.label,
    tooltip: r.technology ? `[${r.technology}]` : undefined,
    style: STYLES.relationship,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/component.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/component.ts tests/generator/drawio/component.test.ts
git commit -m "feat(drawio): move component descriptions and edge tech to tooltips"
```

---

## Task 11: Shorten content + set tooltip in `code.ts`

**Files:**

- Modify: `src/generator/drawio/code.ts`
- Modify: `tests/generator/drawio/code.test.ts`

**Note:** `CodeElement` (in `src/analyzers/types.ts`) has no `description` field — it carries `id`, `name`, `kind`, optional `qualifiedName`, `visibility`, `tags`, and kind-specific `members`/`signature`. So code-level vertices do NOT gain a tooltip; this task only propagates `kind` through code vertices for layout sizing.

- [ ] **Step 1: Write the failing test**

Append to `tests/generator/drawio/code.test.ts`:

```ts
it("tags code-element vertices with code-class or code-fn kind", () => {
  const { vertices } = buildCodeCells(model, component);
  const classVertex = vertices.find((v) => v.kind === "code-class");
  const fnVertex = vertices.find((v) => v.kind === "code-fn");
  expect(classVertex).toBeDefined();
  expect(fnVertex).toBeDefined();
  // boundary for the component itself still tags as system-boundary
  expect(
    vertices.find(
      (v) => v.id === `${component.id}` || v.style.includes("dashed=1"),
    )?.kind,
  ).toBe("system-boundary");
});
```

If the existing `code.test.ts` fixture doesn't contain both a container-kind and a signature-kind code element, extend it so both kinds are covered.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/drawio/code.test.ts`
Expected: FAIL (no `kind` field today — may also type-error until Task 3's `kind` propagation lands, which happened earlier in this plan).

- [ ] **Step 3: Update `src/generator/drawio/code.ts`**

```ts
import type { StyleKey } from "./styles.js";

function kindFor(el: CodeElement): StyleKey {
  return CONTAINER_KINDS.has(el.kind) ? "code-class" : "code-fn";
}

// component boundary
vertices.push({
  id: toDrawioId(component.id),
  value: `${component.name}\n[Component]`,
  style: STYLES["system-boundary"],
  kind: "system-boundary",
});

for (const el of elements) {
  vertices.push({
    id: toDrawioId(el.id),
    value: `${el.name}\n[${el.kind}]`,
    style: styleFor(el),
    kind: kindFor(el),
    parent: toDrawioId(component.id),
  });
}

// external code ref
vertices.push({
  id: toDrawioId(r.targetId),
  value: r.targetName ?? r.targetId,
  style: STYLES["code-class"],
  kind: "code-class",
});

// edge
edges.push({
  id: edgeId(r.sourceId, r.targetId, r.kind),
  source: toDrawioId(r.sourceId),
  target: toDrawioId(r.targetId),
  value: r.label ?? r.kind,
  style: STYLES.relationship,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/generator/drawio/code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/drawio/code.ts tests/generator/drawio/code.test.ts
git commit -m "feat(drawio): tag code-level vertices with kind and optional tooltip"
```

---

## Task 12: End-to-end integration coverage

**Files:**

- Modify: `tests/generator/drawio/integration/*.test.ts` (look for the existing integration file in that directory)

- [ ] **Step 1: Inspect existing integration tests**

Run: `ls tests/generator/drawio/integration`
Read the largest file there — likely an L1/L2/L3 end-to-end test that drives `generateDrawioFile` against the monorepo fixture.

- [ ] **Step 2: Add assertions for the new behaviour**

At the end of the L2 integration test:

```ts
const xml = fs.readFileSync(/* the generated L2 drawio file */, "utf-8");
// Descriptions no longer live in <mxCell value="...">.
expect(xml).not.toMatch(/<mxCell[^>]*value="[^"]*Spring Boot/);
// A sample container surfaces its description through a UserObject tooltip.
expect(xml).toMatch(/<UserObject[^>]*tooltip="[^"]*Spring Boot/);
// Person vertices emit narrow geometry.
expect(xml).toMatch(/id="[^"]*customer[^"]*"[\s\S]*?width="48"[^>]*height="80"/);
// Orthogonal routing is requested on managed edges via the relationship style.
expect(xml).toMatch(/style="[^"]*edgeStyle=orthogonalEdgeStyle/);
```

Adapt the matchers to the actual ids and technology strings in the monorepo fixture — run the test once, see what gets produced, then tighten the strings.

- [ ] **Step 3: Run integration tests**

Run: `npx vitest run tests/generator/drawio/integration`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/generator/drawio/integration
git commit -m "test(drawio): integration assertions for UserObject tooltips and orthogonal routing"
```

---

## Task 13: Regenerate the charging-triad sample and in-tree fixtures; manual drawio verification

**Files:**

- Modify: `tests/fixtures/monorepo/docs/architecture/*.drawio` (regenerated)
- Optional: any snapshot files the test suite writes

- [ ] **Step 1: Regenerate drawio output for the monorepo fixture**

Run:

```bash
cd tests/fixtures/monorepo
npx -y tsx ../../../src/cli/index.ts generate
cd -
```

(Or use whatever command the project uses to rerun the generator against the fixture — check the `npm run` scripts in `package.json` if the direct call doesn't cover it.)

- [ ] **Step 2: Visually inspect in drawio desktop**

Open one of the regenerated `.drawio` files in drawio desktop (https://www.drawio.com/). Confirm:

- Actors render as narrow stick figures with the label legible below the body.
- Containers are compact (180×70) with name + `[Container: Tech]` only; hover shows the full description.
- Edges route orthogonally, labels have opaque white backgrounds, and the `[tech]` tag appears on hover rather than next to the label.
- Externals sit close to the system boundary instead of ~200px below it.
- PNG export (File → Export As → PNG) does NOT render tooltips — this is expected.

If the orthogonal routing produces ugly waypoints near cross-parent edges (actor → inside-system container), tune `elk.layered.spacing.edgeNodeBetweenLayers` in `layout.ts` — bumping it to `60` or `80` usually spreads the routing out.

- [ ] **Step 3: Regenerate the charging-triad sample**

Run the generator against `/Users/chris/Downloads/charging-triad` (or whichever path the user provides). Open the produced `c2-container.drawio` and repeat the inspection checklist.

- [ ] **Step 4: Decide on edge-label truncation**

If, after orthogonal routing and the tech-tag move, labels still pile up (observed on charging-triad, not the in-tree fixture): truncate labels longer than 40 chars with `…` inside the relevant builder, moving the full label into the edge tooltip. Otherwise skip — the spec treats this as a conditional fallback, not default behaviour.

- [ ] **Step 5: Commit regenerated fixtures**

```bash
git add tests/fixtures/monorepo
git commit -m "chore(drawio): regenerate monorepo fixture for layout improvements"
```

---

## Task 14: Final type/test sweep

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: all green. Pay attention to `correctness`, `drift`, and `tokens` quality suites — the content-shortening change should not move any of them, but run them to confirm.

- [ ] **Step 4: Commit any last fix-ups**

If anything drifted (snapshots, lint), bundle into a final commit:

```bash
git commit -am "chore(drawio): sweep lint/typecheck/snapshots after layout refactor"
```

---

## Summary of commits (target shape)

1. `feat(drawio): emit UserObject wrapper when tooltip is set`
2. `refactor(drawio): replace uniform node size with nodeSize(kind)`
3. `refactor(drawio): pass StyleKey through VertexSpec and index.ts`
4. `style(drawio): orthogonal edge routing + opaque label backgrounds`
5. `feat(drawio): thread tooltip through reconcile and writer wiring`
6. `feat(drawio): parse UserObject wrappers and attribute-based managed flag`
7. `test(drawio): verify drift flags UserObject without child mxCell`
8. `feat(drawio): move container descriptions and edge tech to tooltips`
9. `feat(drawio): move context-level descriptions and edge tech to tooltips`
10. `feat(drawio): move component descriptions and edge tech to tooltips`
11. `feat(drawio): tag code-level vertices with kind for layout sizing`
12. `test(drawio): integration assertions for UserObject tooltips and orthogonal routing`
13. `chore(drawio): regenerate monorepo fixture for layout improvements`
14. `chore(drawio): sweep lint/typecheck/snapshots after layout refactor` (optional)
