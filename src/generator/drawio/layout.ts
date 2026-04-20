import ELKModule from "elkjs/lib/elk.bundled.js";
import type { Geometry } from "./writer.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ELK = (ELKModule as any).default ?? ELKModule;

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

 
const elk = new ELK() as {
  layout: (graph: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

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
  for (const child of (node.children as (typeof node)[]) ?? []) {
    collect(child, ax, ay, out);
  }
}
