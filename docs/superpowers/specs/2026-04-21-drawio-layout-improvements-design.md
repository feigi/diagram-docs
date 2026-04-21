# drawio Layout Improvements

**Date:** 2026-04-21
**Status:** Draft
**Scope:** `src/generator/drawio/` only — no model-builder or schema changes.

## Motivation

L2 drawio output currently has several rendering problems, visible in the `charging-triad` sample:

- **Actors stretch.** `umlActor` is forced to `160×60`. The vector stick-figure scales to those bounds and renders as an oval-with-wings.
- **Descriptions overflow.** Every container/external uses a fixed `160×60` geometry with the full C4 description crammed into the label, producing text spillover and sibling collision.
- **Edge labels pile up.** Verb + full tech tag (`"Consumes charging-static.v2 events from [Apache Kafka / AWS MSK IAM]"`) plus diagonal routing plus stacked y-bands near externals produces unreadable label overlap.
- **Externals drift off-page.** ELK's `layered` layout with oversized labels pushes external systems to `y=646` and `x=1132`, beyond the default page bounds.

The goal is to fix these inside the generator without touching the architecture model.

## Decisions (from brainstorm)

1. **Scope:** generator-only.
2. **Target medium:** multi-page drawio canvas. Users pan/zoom; fitting a single page is not a requirement.
3. **Boxes:** compact shapes. Name and tech tag in the label; description moves to drawio tooltip.
4. **Actors:** keep `umlActor`. Geometry is `48×80` — the stick-figure occupies roughly the top 60px (native aspect), and 20px of gutter below gives `verticalLabelPosition=bottom` room to render the label without colliding with neighbours.
5. **Edge labels:** verb only in label. Tech tag (`[protocol]`) moves to edge tooltip.
6. **Edge routing:** orthogonal (`edgeStyle=orthogonalEdgeStyle`, `curved=0`).
7. **Implementation approach:** "surgical + sizing refactor" — shortest path to fix, plus replacing the uniform `NODE_WIDTH/HEIGHT` constants with a per-style-kind `nodeSize()` function so future tuning is principled.

## Architecture

Six modules in `src/generator/drawio/` change:

| File                      | Change                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.ts`               | Add `edgeStyle=orthogonalEdgeStyle;curved=0;labelBackgroundColor=#ffffff;labelBorderColor=none` to `relationship`. No actor style change.                     |
| `layout.ts`               | Replace `NODE_WIDTH`/`NODE_HEIGHT` constants with `nodeSize(kind: StyleKey)`. Add `elk.edgeRouting=ORTHOGONAL` and extra edge-spacing options.                |
| `writer.ts`               | Extend `VertexCell`/`EdgeCell` with optional `tooltip`. When set, emit a `UserObject` wrapper around the `mxCell` carrying `@_tooltip` and `@_ddocs_managed`. |
| `container.ts`            | Shorten `value` to `{name}\n[Container: {tech}]`. Move description to `tooltip`. Shorten edge `value` to the label only; move `[tech]` to edge tooltip.       |
| `context.ts`              | Same treatment for context level.                                                                                                                             |
| `component.ts`, `code.ts` | Same treatment for L3/L4 for consistency.                                                                                                                     |
| `merge.ts`                | Read `id` from either `UserObject@id` or `mxCell@id`. Treat cells as managed if `UserObject@ddocs_managed="1"` OR style contains `ddocs_managed=1`.           |

No model-builder change. No schema change. No new dependencies.

## Sizing Model

`layout.ts` currently exports `NODE_WIDTH=160` and `NODE_HEIGHT=60`. Replace with:

```ts
export interface NodeSize {
  width: number;
  height: number;
}

export function nodeSize(kind: StyleKey): NodeSize {
  switch (kind) {
    case "person":
      return { width: 48, height: 80 }; // 60 shape + 20 gutter for label below
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
      return { width: 0, height: 0 }; // system-boundary is sized by ELK from children; relationship is never a node
  }
}
```

`LayoutNode` gains a `kind: StyleKey` field. All callers (`container.ts`, `context.ts`, `component.ts`, `code.ts`) already know the style key and pass it through. `layout.ts` derives ELK node width/height from `kind` instead of the removed constants. `NODE_SPACING_X` and `NODE_SPACING_Y` remain.

**Actor gutter rationale:** drawio renders the `umlActor` stick figure within the cell's geometry bounds. `verticalLabelPosition=bottom` places the label _outside_ those bounds. ELK, working from geometry alone, packs the next node against the shape edge and the label collides with it. Reserving 20px of vertical gutter in the geometry pushes the next node far enough down for the label to fit. Width 48 matches the native head/torso ratio and prevents stretching.

## UserObject Tooltip Wrapper

drawio's tooltip mechanism for per-cell descriptions wraps the `mxCell` in a `UserObject` element. The id and label move to the wrapper; style, vertex flag, geometry, parent, source, target stay on the inner `mxCell`.

**Without tooltip (unchanged):**

```xml
<mxCell id="los-cha-app"
        value="Charging App&#10;[Container: Java]"
        style="rounded=1;...;ddocs_managed=1"
        vertex="1" parent="system">
  <mxGeometry x="12" y="12" width="180" height="70" as="geometry"/>
</mxCell>
```

**With tooltip (new):**

```xml
<UserObject id="los-cha-app"
            label="Charging App&#10;[Container: Java]"
            tooltip="Spring Boot service that orchestrates EV charging station search..."
            ddocs_managed="1">
  <mxCell style="rounded=1;..." vertex="1" parent="system">
    <mxGeometry x="12" y="12" width="180" height="70" as="geometry"/>
  </mxCell>
</UserObject>
```

Edges follow the same pattern: `label` and `tooltip` on `UserObject`; `source`, `target`, `edge="1"`, `style`, and geometry on the inner `mxCell`.

**Writer change:**

```ts
addVertex(cell: VertexCell): this {
  const inner = {
    "@_style": cell.style,
    "@_vertex": "1",
    "@_parent": cell.parent ?? "1",
    mxGeometry: { /* unchanged */ },
  };
  if (cell.tooltip) {
    this.cells.push({
      "@_id": cell.id,
      "@_label": cell.value,
      "@_tooltip": cell.tooltip,
      "@_ddocs_managed": "1",
      "#userObject": true,
      mxCell: inner,
    });
  } else {
    this.cells.push({ "@_id": cell.id, "@_value": cell.value, ...inner });
  }
  return this;
}
```

`#userObject` is a sentinel interpreted by the serialise step to emit `<UserObject>` rather than `<mxCell>` around this node. Exact wiring into fast-xml-parser's element-grouping mechanism is a small implementation detail and must be prototyped before the rest lands.

The `ddocs_managed=1` style segment is dropped from the style string on wrapped cells — the attribute on `UserObject` becomes the source of truth. Unwrapped cells (no tooltip) keep the style-based tag unchanged.

## Content Construction

**Vertices (container.ts; mirror in context/component/code):**

```ts
// Actor
vertices.push({
  id: toDrawioId(a.id),
  value: `${a.name}\n[Person]`,
  tooltip: a.description,
  style: STYLES.person,
  kind: "person",
});

// Container
vertices.push({
  id: toDrawioId(c.id),
  value: `${c.name}\n[Container: ${c.technology}]`,
  tooltip: c.description,
  style: STYLES.container,
  kind: "container",
  parent: "system",
});

// External system / library
const typeTag = e.tags?.includes("library") ? "[Library]" : "[External System]";
const techLine = e.technology ? `\n[${e.technology}]` : "";
vertices.push({
  id: toDrawioId(e.id),
  value: `${e.name}\n${typeTag}${techLine}`,
  tooltip: e.description,
  style: STYLES["external-system"],
  kind: "external-system",
});

// System boundary — no tooltip
vertices.push({
  id: "system",
  value: `${model.system.name}\n[Software System]`,
  style: STYLES["system-boundary"],
  kind: "system-boundary",
});
```

**Edges:**

```ts
edges.push({
  id: edgeId(r.src, r.tgt, r.label),
  source: toDrawioId(r.src),
  target: toDrawioId(r.tgt),
  value: r.label,
  tooltip: r.tech ? `[${r.tech}]` : undefined,
  style: STYLES.relationship,
});
```

**Spec types:**

```ts
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
}
```

**Edge label length:** pass labels through unchanged post-strip. If pile-up persists after orthogonal routing + shortened labels, fall back to truncating labels longer than 40 characters with `…`, placing the full label text in the tooltip. Decide during manual-verification pass; not in initial implementation.

## Edge Routing

**Style (`styles.ts`):**

```ts
relationship:
  "endArrow=classic;html=1;rounded=0;strokeColor=#707070;fontSize=11;" +
  "edgeStyle=orthogonalEdgeStyle;curved=0;" +
  "labelBackgroundColor=#ffffff;labelBorderColor=none",
```

| Property                        | Purpose                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `edgeStyle=orthogonalEdgeStyle` | Right-angle routing; drawio computes waypoints.                                                 |
| `curved=0`                      | Sharp corners (C4 convention).                                                                  |
| `labelBackgroundColor=#ffffff`  | Opaque label background; labels don't bleed through crossing edges. Main fix for label pile-up. |

**ELK hints (`layout.ts`):**

```ts
layoutOptions: {
  "elk.algorithm": ALGORITHMS[input.level],
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": String(NODE_SPACING_Y),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(NODE_SPACING_X),
  "elk.layered.spacing.edgeNodeBetweenLayers": "40",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "30",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
}
```

The generator does not emit explicit waypoints. `EdgeCell.waypoints` remains an optional field but is unused; drawio computes routing at render time using the orthogonal style.

## Testing

**Unit tests:**

| Test file                                  | Coverage                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/generator/drawio/writer.test.ts`    | `addVertex`/`addEdge` with and without `tooltip`; `<UserObject>` appears only when tooltip set; inner `<mxCell>` carries geometry/style.           |
| `tests/generator/drawio/layout.test.ts`    | `nodeSize` returns expected per-kind dimensions; ELK receives accurate per-node sizes; person nodes get the 80-high gutter.                        |
| `tests/generator/drawio/container.test.ts` | Value excludes description; tooltip equals description. Edge value excludes `[tech]`; edge tooltip equals `[tech]`. Actor narrow.                  |
| `tests/generator/drawio/merge.test.ts`     | Hand-edited `UserObject` cell round-trips across regen. A previously-managed plain `mxCell` is upgraded to `UserObject` without losing hand edits. |

**Snapshot / golden output:** regenerate drawio snapshots for `tests/fixtures/monorepo` at all levels (context, container, component, and L4 where enabled). Commit updated snapshots in the same PR.

## Merge & Backwards Compatibility

- `merge.ts` ID extraction: read from `UserObject@id` when the cell is a UserObject, else `mxCell@id`. Canonicalise to a single id string.
- Managed detection: cell counts as managed if `UserObject@ddocs_managed="1"` is present OR its style string contains `ddocs_managed=1`. Both checks run for one release window so diagrams generated before this change remain recognised.
- On re-emit, always write the `UserObject` form for vertices/edges that carry a tooltip; plain `mxCell` otherwise. Consistent rules keep drift detection stable.
- Hand-added (unmanaged) cells pass through verbatim in both forms.
- First regen after upgrade produces a one-time structural diff in every managed drawio file as plain `mxCell` entries become `UserObject` wrappers. Call out in release notes.
- Hand-edited geometry, style overrides, and freehand cells on managed ids carry forward unchanged — merge.ts's id-based preservation continues to operate; it just sees the wrapper element instead of the cell directly.

## Drift Detection

`drift.ts` already escalates corrupt XML to a non-zero exit (recent commit). Add one case:

- A `UserObject` element present without a child `mxCell` is structurally invalid and should trigger the same escalation path.

Stable-reference detection operates on ids and is unaffected by the wrapper change.

## Manual Verification

After regenerating diagrams for the `charging-triad` sample and the in-tree fixtures, open the L2 drawio file in drawio desktop and confirm:

- Actors render as narrow stick figures with legible labels below.
- Containers are compact (180×70) with name and tech tag only.
- Hovering a container/external surfaces the full description as a tooltip.
- Edges route orthogonally with readable, non-overlapping labels on opaque white backgrounds.
- Externals sit near the system boundary without the ~200px vertical gap.
- PNG export does not show descriptions (expected — tooltips are interactive-only).

## Open Risks

1. **fast-xml-parser element grouping.** Mixed element names (`UserObject` and `mxCell`) under `<root>` require a grouping mechanism the current writer doesn't exercise. Prototype end-to-end before the rest of the work lands; if it can't emit clean `UserObject` siblings to `mxCell` siblings, fall back to a custom serialiser for the handful of diverging nodes.
2. **drawio Edit-Geometry behaviour.** When a user drags a `UserObject`-wrapped cell in drawio and the app rewrites its geometry, confirm the wrapper survives round-trip. Verify in drawio desktop on a regenerated fixture.
3. **ELK orthogonal routing + hierarchy.** `INCLUDE_CHILDREN` with cross-parent edges (actor outside system boundary → container inside) combined with `ORTHOGONAL` edgeRouting can produce awkward waypoints. Manually inspect the charging-triad output and the monorepo fixture; tune `elk.layered.spacing.edgeNodeBetweenLayers` if routes bunch.

## Non-Goals

- Model-side changes: duplicate-container consolidation, library-as-container reclassification, description length enforcement. These were flagged during diagnosis but are out of scope.
- Single-page layout constraint.
- New diagram formats or generators.
- Interactive browser viewer beyond drawio's own tooltip mechanism.
