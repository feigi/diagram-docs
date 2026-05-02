import type { ArchitectureModel } from "../../analyzers/types.js";
import type {
  DiagramSpec,
  VertexSpec as PVertex,
} from "../projection/types.js";
import { projectContext } from "../projection/context.js";
import { flushProjectionWarnings } from "../projection/index.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import { toDrawioId, edgeId, wrapEdgeLabel } from "./stability.js";

/** Drawio cell representation (style-aware, kept stable for L4 + layout). */
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

export interface DiagramCells {
  vertices: VertexSpec[];
  edges: EdgeSpec[];
}

/**
 * Map a projection vertex to a drawio cell. Boundary detection is structural:
 * any vertex with a child (another vertex names it as parentId) is rendered
 * with the system-boundary style.
 */
function toCell(v: PVertex, hasChildren: boolean): VertexSpec {
  switch (v.kind) {
    case "actor":
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n[Person]`,
        tooltip: v.description || undefined,
        style: STYLES.person,
        kind: "person",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    case "system":
      return {
        id: toDrawioId(v.id) === "system" ? "system" : toDrawioId(v.id),
        value: `${v.name}\n[Software System]`,
        tooltip: v.description || undefined,
        style: hasChildren ? STYLES["system-boundary"] : STYLES.system,
        kind: hasChildren ? "system-boundary" : "system",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    case "container": {
      const techLine = v.technology ? `: ${v.technology}` : "";
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n[Container${techLine}]`,
        tooltip: v.description || undefined,
        style: hasChildren ? STYLES["system-boundary"] : STYLES.container,
        kind: hasChildren ? "system-boundary" : "container",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    }
    case "component": {
      const techLine = v.technology ? `: ${v.technology}` : "";
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n[Component${techLine}]`,
        tooltip: v.description || undefined,
        style: STYLES.component,
        kind: "component",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    }
    case "external-system": {
      const isLib = v.tags?.includes("library") ?? false;
      const techLine = v.technology ? `\n[${v.technology}]` : "";
      const typeTag = isLib ? "[Library]" : "[External System]";
      return {
        id: toDrawioId(v.id),
        value: `${v.name}\n${typeTag}${techLine}`,
        tooltip: v.description || undefined,
        style: STYLES["external-system"],
        kind: "external-system",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      };
    }
    default: {
      const exhaustive: never = v.kind;
      throw new Error(`drawio: unhandled VertexKind "${exhaustive}"`);
    }
  }
}

/** Convert any DiagramSpec to drawio cells. Shared across L1/L2/L3. */
export function cellsFromSpec(spec: DiagramSpec): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const childCount = new Map<string, number>();
  for (const v of spec.vertices) {
    if (v.parentId) {
      childCount.set(v.parentId, (childCount.get(v.parentId) ?? 0) + 1);
    }
  }

  for (const v of spec.vertices) {
    vertices.push(toCell(v, (childCount.get(v.id) ?? 0) > 0));
  }

  for (const e of spec.edges) {
    edges.push({
      id: edgeId(e.sourceId, e.targetId, e.label),
      source: toDrawioId(e.sourceId),
      target: toDrawioId(e.targetId),
      value: wrapEdgeLabel(e.label),
      tooltip: e.technology ? `[${e.technology}]` : undefined,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}

export function emitContextCells(spec: DiagramSpec): DiagramCells {
  return cellsFromSpec(spec);
}

/** Public wrapper preserved for cli/commands/generate.ts. */
export function buildContextCells(model: ArchitectureModel): DiagramCells {
  const spec = projectContext(model);
  flushProjectionWarnings(spec.warnings);
  return emitContextCells(spec);
}
