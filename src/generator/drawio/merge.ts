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
