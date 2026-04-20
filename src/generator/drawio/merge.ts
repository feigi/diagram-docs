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
      new Error(
        "unexpected structure: no mxfile > diagram > mxGraphModel > root > mxCell",
      ),
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
        warnings.push(
          `No layout assigned for vertex "${v.id}"; placing at origin.`,
        );
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

function parseGeometry(geom?: Record<string, unknown>): Geometry | undefined {
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
