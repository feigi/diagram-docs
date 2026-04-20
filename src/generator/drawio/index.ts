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
