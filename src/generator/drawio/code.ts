import type { ArchitectureModel, Component } from "../../analyzers/types.js";
import type { DiagramSpec, VertexSpec } from "../projection/types.js";
import { projectCode } from "../projection/code.js";
import { flushProjectionWarnings } from "../projection/index.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import { toDrawioId, edgeId } from "./stability.js";
import type {
  DiagramCells,
  VertexSpec as DrawioVertex,
  EdgeSpec as DrawioEdge,
} from "./context.js";

const CONTAINER_ELEMENT_KINDS = new Set([
  "class",
  "interface",
  "enum",
  "struct",
]);

function styleKeyFor(elementKind: string | undefined): StyleKey {
  return CONTAINER_ELEMENT_KINDS.has(elementKind ?? "")
    ? "code-class"
    : "code-fn";
}

export function emitCodeCells(spec: DiagramSpec): DiagramCells {
  const vertices: DrawioVertex[] = [];
  const edges: DrawioEdge[] = [];

  for (const v of spec.vertices) {
    if (v.kind === "component") {
      vertices.push({
        id: toDrawioId(v.id),
        value: `${v.name}\n[Component]`,
        style: STYLES["system-boundary"],
        kind: "system-boundary",
        parent: v.parentId ? toDrawioId(v.parentId) : undefined,
      });
      continue;
    }
    if (v.kind === "code-element") {
      vertices.push(toCodeCell(v));
      continue;
    }
    throw new Error(
      `drawio L4 emitter: unexpected vertex kind "${v.kind}" for id "${v.id}"`,
    );
  }

  for (const e of spec.edges) {
    edges.push({
      id: edgeId(e.sourceId, e.targetId, e.label),
      source: toDrawioId(e.sourceId),
      target: toDrawioId(e.targetId),
      value: e.label,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}

function toCodeCell(v: VertexSpec): DrawioVertex {
  const styleKey = styleKeyFor(v.elementKind);
  return {
    id: toDrawioId(v.id),
    value: `${v.name}\n[${v.elementKind ?? "type"}]`,
    style: STYLES[styleKey],
    kind: styleKey,
    parent: v.parentId ? toDrawioId(v.parentId) : undefined,
  };
}

/** Public wrapper preserved for cli/commands/generate.ts. */
export function buildCodeCells(
  model: ArchitectureModel,
  component: Component,
): DiagramCells {
  const spec = projectCode(model, component.id);
  flushProjectionWarnings(spec.warnings);
  return emitCodeCells(spec);
}
