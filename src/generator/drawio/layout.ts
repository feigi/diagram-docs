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
