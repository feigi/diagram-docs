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

export const NODE_SPACING_X = 320;
export const NODE_SPACING_Y = 160;

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
const LABEL_FONT_PX = 6;
const LABEL_MAX_WIDTH = 180;
const LABEL_HEIGHT = 16;
const LABEL_PADDING = 8;

function labelBounds(text: string): { width: number; height: number } {
  const width = Math.min(
    text.length * LABEL_FONT_PX + LABEL_PADDING,
    LABEL_MAX_WIDTH,
  );
  return { width, height: LABEL_HEIGHT };
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
      // Orthogonal routing matches the `orthogonalEdgeStyle` set on
      // relationship cells in styles.ts, so ELK's planned segments align
      // with drawio's rendered lines instead of drawio re-routing on open.
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(NODE_SPACING_Y),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(NODE_SPACING_X),
      // Reserve gutters between edges and edges/nodes so labels don't pile
      // up when several relationships share the same pair of layers.
      "elk.layered.spacing.edgeNodeBetweenLayers": "60",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "40",
      "elk.spacing.edgeEdge": "30",
      "elk.spacing.edgeNode": "40",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // More optimization passes + straighter edges → ORTHOGONAL routing
      // has a better chance of steering around nodes instead of cutting
      // corners on dense L3 component graphs.
      "elk.layered.thoroughness": "10",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.edgeStraightening": "IMPROVE_STRAIGHTNESS",
      // Route labels off the line and give each a generous gutter so two
      // adjacent "Uses"-style labels don't settle on top of each other.
      // drawio draws the label at the edge midpoint regardless of what
      // ELK planned, so the label-spacing value is effectively lower-bound
      // slack — increasing it pushes ELK to separate edges further, which
      // in turn pulls their midpoints apart.
      "elk.edgeLabels.inline": "false",
      "elk.layered.edgeLabels.sideSelection": "SMART_UP",
      "elk.spacing.edgeLabel": "24",
    },
    children: rootIds.map(buildElkNode),
    edges: [...input.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => {
        const base = { id: e.id, sources: [e.source], targets: [e.target] };
        if (!e.label) return base;
        return {
          ...base,
          labels: [{ text: e.label, ...labelBounds(e.label) }],
        };
      }),
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
