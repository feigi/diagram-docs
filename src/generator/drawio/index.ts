import * as fs from "node:fs";
import * as path from "node:path";
import type { DiagramCells } from "./context.js";
import { DrawioWriter } from "./writer.js";
import { parseDrawioFile, reconcile } from "./merge.js";
import {
  layoutGraph,
  nodeSize,
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

  // Degree map used to widen hub nodes. A hub that keeps the base container
  // width crams all exit ports into that narrow band, forcing long
  // horizontal detours to reach wide-spread targets. Widening proportional
  // to fanout spreads the ports so each edge can drop roughly straight down.
  const degree = new Map<string, number>();
  for (const e of input.cells.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const layoutNodes: LayoutNode[] = input.cells.vertices.map((v) => {
    const kids = childrenOf.get(v.id);
    const base = nodeSize(v.kind);
    // Boundary/edge kinds return {0,0} (ELK INCLUDE_CHILDREN sizes them from
    // their contents). Fall back to a container footprint so the child-count
    // scaling below has a non-zero seed. `nodeSize` is exhaustive over
    // `StyleKey`, so adding a new kind without a size forces a compile error.
    const { width: baseW, height: baseH } =
      base.width > 0 ? base : nodeSize("container");
    // Pin actors to the first layer and externals to the last layer at
    // context/container/component levels. Without this, edge direction
    // determines layering, so an external that publishes *to* the system
    // ends up in a different layer than one the system publishes *to*,
    // scattering externals across multiple rows.
    let layerConstraint: LayoutNode["layerConstraint"];
    if (input.level !== "code") {
      if (v.kind === "person") layerConstraint = "FIRST";
      else if (v.kind === "external-system") layerConstraint = "LAST";
    }
    // Give the system-boundary title (`verticalAlign=top` in styles.ts)
    // vertical breathing room so it doesn't overlap the first row of nested
    // containers/components.
    const layoutOptions: Record<string, string> =
      v.kind === "system-boundary"
        ? { "elk.padding": "[top=32,left=16,right=16,bottom=16]" }
        : {};
    const fanout = degree.get(v.id) ?? 0;
    // Width needed so ports spread over roughly the same horizontal band as
    // their targets. Each port needs ~baseW/2 of side real estate to avoid
    // clustering at the node center. Threshold 2 so even nodes with a small
    // fan-in/out get separated entry points, which keeps parallel segments
    // from piling up on the same routing band.
    const hubWidth = fanout >= 2 ? Math.round(fanout * (baseW * 0.55)) : 0;
    const childWidth =
      kids && kids.length > 0
        ? Math.max(baseW * 2, kids.length * baseW)
        : baseW;
    return {
      id: v.id,
      width: Math.max(childWidth, hubWidth),
      height: kids && kids.length > 0 ? baseH * 3 : baseH,
      children: kids,
      layerConstraint,
      layoutOptions:
        Object.keys(layoutOptions).length > 0 ? layoutOptions : undefined,
    };
  });

  const { nodes: layout, edges: edgeRoutes } = await layoutGraph({
    level: input.level,
    nodes: layoutNodes,
    edges: input.cells.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.value,
    })),
  });

  const result = reconcile({
    existing,
    fresh: input.cells,
    layout,
    edgeRoutes,
  });
  for (const w of result.warnings) console.error(`Warning: drawio merge: ${w}`);

  const writer = new DrawioWriter({ diagramName: input.diagramName });
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
      labelOffset: e.labelOffset,
    });
  }

  fs.mkdirSync(path.dirname(input.filePath), { recursive: true });
  const tmpPath = `${input.filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, writer.serialise(), "utf-8");
    fs.renameSync(tmpPath, input.filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}
