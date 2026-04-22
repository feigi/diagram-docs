import ELKModule from "elkjs/lib/elk.bundled.js";
import type {
  ELK as ElkInstance,
  ELKConstructorArguments,
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkLabel,
  ElkNode,
} from "elkjs/lib/elk-api.js";
import type { Geometry } from "./writer.js";
import type { StyleKey } from "./styles.js";

export interface Point {
  x: number;
  y: number;
}

export interface EdgeRoute {
  waypoints: Point[];
  labelOffset?: Point;
}

export interface LayoutResult {
  nodes: Map<string, Geometry>;
  edges: Map<string, EdgeRoute>;
}

const ELK = ELKModule as unknown as new (
  args?: ELKConstructorArguments,
) => ElkInstance;

export const NODE_SPACING_X = 80;
export const NODE_SPACING_Y = 50;

export interface NodeSize {
  width: number;
  height: number;
}

/**
 * Intrinsic drawio shape aspect per kind — person/umlActor is a tall, narrow
 * stick figure; containers/components/externals need width for a two-line
 * label + `[Type: tech]`; code boxes pack tighter.
 *
 * Returns `{0,0}` for boundary/edge kinds so ELK `INCLUDE_CHILDREN` sizes
 * `system-boundary` from its contents. `system` itself is a real vertex in L1
 * (it has no children), so it receives a container-sized footprint.
 */
export function nodeSize(kind: StyleKey): NodeSize {
  switch (kind) {
    case "person":
      return { width: 48, height: 80 };
    case "system":
    case "container":
    case "component":
    case "external-system":
      return { width: 220, height: 80 };
    case "code-class":
    case "code-fn":
      return { width: 160, height: 60 };
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
  /**
   * Optional ELK `layered.layering.layerConstraint`. Use to pin a node to the
   * first or last layer regardless of edge direction (e.g. keep all external
   * systems together at the bottom of an L1 context diagram).
   */
  layerConstraint?: "FIRST" | "LAST" | "FIRST_SEPARATE" | "LAST_SEPARATE";
  /**
   * Extra ELK layout options applied to this node (merged on top of the
   * constraint above). Use for per-node tweaks like `elk.padding` on the
   * system boundary so its title has room above nested containers.
   */
  layoutOptions?: Record<string, string>;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/**
 * Approximate label bounds for ELK so it reserves space per edge label. ELK
 * needs explicit width/height — without them labels default to size 0 and
 * stack on the same routing band, which triggers the white-bg mask-over-text
 * pileup we see with orthogonal routing.
 */
// Rough px/char for the font drawio uses on relationship cells (see
// `styles.ts` — `fontSize=11`). Lower bound for the ELK estimate; under-
// estimating causes sibling edges' labels to land on the same routing band
// and overlap horizontally.
const LABEL_FONT_PX = 7;
const LABEL_MAX_WIDTH = 240;
const LABEL_HEIGHT = 18;
const LABEL_PADDING = 8;

function labelBounds(text: string): { width: number; height: number } {
  // Split on both `<br>` (wrapped edge labels, see stability.ts) and raw
  // newlines so bounds scale with line count regardless of which the caller
  // uses.
  const lines = text.split(/<br\s*\/?>|\n/i);
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const width = Math.min(
    longest * LABEL_FONT_PX + LABEL_PADDING,
    LABEL_MAX_WIDTH,
  );
  return { width, height: LABEL_HEIGHT * lines.length };
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

export async function layoutGraph(input: LayoutInput): Promise<LayoutResult> {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  const allChildIds = new Set<string>();
  for (const n of input.nodes) {
    if (n.children && n.children.length > 0) {
      childrenOf.set(n.id, [...n.children].sort());
      for (const c of n.children) allChildIds.add(c);
    }
  }

  // Parent chain for each node: ["node", "parent", "grandparent", ...].
  // Used to find the lowest common ancestor of an edge's endpoints so edges
  // between nested siblings get declared on their shared parent instead of
  // the root. Root-declared edges get routed outside the parent's boundary,
  // which produced U-shaped detours between nested containers in L2.
  const parentOf = new Map<string, string>();
  for (const [parent, kids] of childrenOf) {
    for (const k of kids) parentOf.set(k, parent);
  }
  const ancestorsOf = (id: string): string[] => {
    const chain = [id];
    let cur = id;
    while (parentOf.has(cur)) {
      cur = parentOf.get(cur)!;
      chain.push(cur);
    }
    return chain;
  };
  const lcaOf = (a: string, b: string): string | null => {
    const aChain = new Set(ancestorsOf(a));
    for (const ancestor of ancestorsOf(b)) {
      if (aChain.has(ancestor)) return ancestor;
    }
    return null;
  };

  const edgesByOwner = new Map<string, LayoutEdge[]>();
  for (const e of input.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      console.error(
        `Warning: drawio layout: edge "${e.id}" references unknown node(s) ` +
          `(source="${e.source}", target="${e.target}") — attached to root; ` +
          `ELK will likely reject it`,
      );
    }
    const lca = lcaOf(e.source, e.target);
    // Attach to the LCA when both endpoints are nested siblings under a
    // non-root ancestor. Ancestor-descendant edges go to the ancestor itself
    // (ELK INCLUDE_CHILDREN requires the edge to be declared on or above the
    // ancestor). Cross-hierarchy edges (lca === null) fall back to root.
    let owner: string;
    if (lca === e.source || lca === e.target) {
      owner = lca;
    } else if (lca !== null) {
      owner = lca;
    } else {
      owner = "root";
    }
    const list = edgesByOwner.get(owner) ?? [];
    list.push(e);
    edgesByOwner.set(owner, list);
  }

  const elkEdgesFor = (ownerId: string) =>
    [...(edgesByOwner.get(ownerId) ?? [])]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => {
        const base = { id: e.id, sources: [e.source], targets: [e.target] };
        if (!e.label) return base;
        return {
          ...base,
          labels: [{ text: e.label, ...labelBounds(e.label) }],
        };
      });

  const buildElkNode = (id: string): ElkNode => {
    const n = byId.get(id);
    if (!n) {
      throw new Error(
        `drawio layout: child "${id}" referenced by parent but missing from input.nodes`,
      );
    }
    const kids = childrenOf.get(id) ?? [];
    const nodeLayoutOptions: Record<string, string> = {
      ...(n.layoutOptions ?? {}),
    };
    if (n.layerConstraint) {
      nodeLayoutOptions["elk.layered.layering.layerConstraint"] =
        n.layerConstraint;
    }
    const ownedEdges = elkEdgesFor(id);
    return {
      id,
      width: n.width,
      height: n.height,
      ...(Object.keys(nodeLayoutOptions).length > 0
        ? { layoutOptions: nodeLayoutOptions }
        : {}),
      ...(kids.length > 0 ? { children: kids.map(buildElkNode) } : {}),
      ...(ownedEdges.length > 0 ? { edges: ownedEdges } : {}),
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
      // Orthogonal routing matches the `orthogonalEdgeStyle` set on
      // relationship cells in styles.ts, so ELK's planned segments align
      // with drawio's rendered lines instead of drawio re-routing on open.
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(NODE_SPACING_Y),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(NODE_SPACING_X),
      // Reserve gutters between edges and edges/nodes so labels don't pile
      // up when several relationships share the same pair of layers.
      "elk.layered.spacing.edgeNodeBetweenLayers": "35",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "25",
      "elk.spacing.edgeEdge": "25",
      "elk.spacing.edgeNode": "30",
      // Nodes with many incident edges (e.g. the central orchestration hub
      // in L3) get special pre-processing so their fanout doesn't pile up
      // parallel edges on a single routing band.
      "elk.layered.highDegreeNodes.treatment": "true",
      "elk.layered.highDegreeNodes.threshold": "4",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // FREE lets ELK choose left/right exits when that's the shorter path —
      // FIXED_SIDE (top/bottom only) was forcing hierarchy-crossing edges
      // (e.g. internal component → external system off to the side) to wrap
      // around the container boundary because the bottom-exit port was far
      // from the target, producing big U-shaped detours.
      "elk.portConstraints": "FREE",
      // More optimization passes + straighter edges → ORTHOGONAL routing
      // has a better chance of steering around nodes instead of cutting
      // corners on dense L3 component graphs.
      "elk.layered.thoroughness": "25",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.edgeStraightening": "IMPROVE_STRAIGHTNESS",
      // Route labels off the line and give each a generous gutter so two
      // adjacent "Uses"-style labels don't settle on top of each other.
      // drawio draws the label at the edge midpoint regardless of what
      // ELK planned, so the label-spacing value is effectively lower-bound
      // slack — increasing it pushes ELK to separate edges further, which
      // in turn pulls their midpoints apart.
      "elk.edgeLabels.inline": "false",
      "elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      // Generous label gutter so ELK separates edges whose labels would
      // otherwise stack on the same band between two layers.
      "elk.spacing.edgeLabel": "20",
      // Strip redundant bendpoints introduced by side-biased label routing.
      "elk.layered.unnecessaryBendpoints": "true",
    },
    children: rootIds.map(buildElkNode),
    edges: elkEdgesFor("root"),
  };

  const laidOut = await elk.layout(graph);
  const nodes = new Map<string, Geometry>();
  collect(laidOut, nodes);
  const edges = collectEdges(laidOut);
  return { nodes, edges };
}

function collectEdges(root: ElkNode): Map<string, EdgeRoute> {
  const out = new Map<string, EdgeRoute>();
  visitEdges(root, out, 0, 0);
  return out;
}

function visitEdges(
  node: ElkNode,
  out: Map<string, EdgeRoute>,
  parentX: number,
  parentY: number,
): void {
  // ELK reports child positions relative to their immediate parent. When an
  // edge lives on a nested parent, its bendpoints are in that parent's
  // coordinate system — we project them to absolute coords here so the
  // drawio writer can emit edges at the default layer (parent="1") without
  // separate per-edge parent handling.
  const absX = parentX + (node.x ?? 0);
  const absY = parentY + (node.y ?? 0);
  for (const edge of (node.edges as ElkExtendedEdge[] | undefined) ?? []) {
    const route = edgeRoute(edge, absX, absY);
    if (route) out.set(edge.id, route);
  }
  for (const child of node.children ?? []) visitEdges(child, out, absX, absY);
}

/**
 * Turn an ELK edge into the drawio-friendly route used by the writer:
 *
 * - `waypoints` = interior bend points of the first section, which drawio
 *   emits as `<mxPoint>` children inside `<Array as="points">`. We drop
 *   ELK's startPoint/endPoint because drawio computes those from the
 *   source/target cell positions at render time.
 * - `labelOffset` = pixel delta from the polyline midpoint to the center
 *   of the first label. Emitted as `<mxPoint as="offset">` so drawio
 *   places the label where ELK planned instead of defaulting to the
 *   geometric midpoint (which is how two parallel edges' labels end up
 *   stacked on the same spot).
 */
function edgeRoute(
  edge: ElkExtendedEdge,
  offsetX: number,
  offsetY: number,
): EdgeRoute | null {
  const section = edge.sections?.[0] as ElkEdgeSection | undefined;
  if (!section) {
    console.error(
      `Warning: drawio layout: ELK returned no route for edge "${edge.id}"; ` +
        `drawio will fall back to its default auto-routing`,
    );
    return null;
  }
  const waypoints = (section.bendPoints ?? []).map((p) => ({
    x: Math.round(p.x + offsetX),
    y: Math.round(p.y + offsetY),
  }));
  const label = edge.labels?.[0] as ElkLabel | undefined;
  let labelOffset: Point | undefined;
  if (label && label.x !== undefined && label.y !== undefined) {
    // Build the parent-relative polyline only with defined endpoints — ELK
    // types leave startPoint/endPoint optional; a missing end would produce
    // NaN midpoints and corrupt the XML with `x="NaN" y="NaN"`.
    const path: Array<{ x: number; y: number }> = [];
    if (section.startPoint) path.push(section.startPoint);
    for (const p of section.bendPoints ?? []) path.push(p);
    if (section.endPoint) path.push(section.endPoint);
    const mid = polylineMidpoint(path);
    if (mid) {
      // Label coords are parent-relative; compare against the parent-relative
      // polyline midpoint so the computed delta is frame-agnostic.
      const labelCenter = {
        x: label.x + (label.width ?? 0) / 2,
        y: label.y + (label.height ?? 0) / 2,
      };
      const dx = Math.round(labelCenter.x - mid.x);
      const dy = Math.round(labelCenter.y - mid.y);
      if (
        Number.isFinite(dx) &&
        Number.isFinite(dy) &&
        (Math.abs(dx) > 1 || Math.abs(dy) > 1)
      ) {
        labelOffset = { x: dx, y: dy };
      }
    }
  }
  return { waypoints, labelOffset };
}

function polylineMidpoint(
  points: Array<{ x: number; y: number }>,
): Point | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
    segs.push(d);
    total += d;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] === 0 ? 0 : half / segs[i];
      return {
        x: points[i].x + t * (points[i + 1].x - points[i].x),
        y: points[i].y + t * (points[i + 1].y - points[i].y),
      };
    }
    half -= segs[i];
  }
  return points[points.length - 1];
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
