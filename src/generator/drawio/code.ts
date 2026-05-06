import type { ArchitectureModel, Component } from "../../analyzers/types.js";
import { projectCode } from "../projection/code.js";
import { flushProjectionWarnings } from "../projection/index.js";
import type {
  CodeVertexElementKind,
  CodeVertexSpec,
  DiagramSpec,
  StructuralVertexSpec,
} from "../projection/types.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import { toDrawioId, edgeId } from "./stability.js";
import type {
  DiagramCells,
  VertexSpec as DrawioVertex,
  EdgeSpec as DrawioEdge,
} from "./context.js";

const CONTAINER_ELEMENT_KINDS: ReadonlySet<CodeVertexElementKind> =
  new Set<CodeVertexElementKind>(["class", "interface", "enum", "struct"]);

function styleKeyFor(elementKind: CodeVertexElementKind): StyleKey {
  return CONTAINER_ELEMENT_KINDS.has(elementKind) ? "code-class" : "code-fn";
}

const CROSS_COMPONENT = "cross-component";

// `dashed=2` is drawio's "dotted" stroke — visually distinct from the
// `dashed=1` already on system-boundary, so a foreign-component cell
// reads as cross-component without color changes.
function withDottedStroke(style: string): string {
  return style.includes("dashed=2") ? style : `${style};dashed=2`;
}

export function emitCodeCells(spec: DiagramSpec): DiagramCells {
  const vertices: DrawioVertex[] = [];
  const edges: DrawioEdge[] = [];

  for (const v of spec.vertices) {
    if (v.kind === "component") {
      vertices.push(toBoundaryCell(v));
      continue;
    }
    if (v.kind === "code-element") {
      vertices.push(toCodeCell(v));
      continue;
    }
    throw new Error(
      `drawio L4 emitter: unexpected vertex kind "${(v as { kind: string }).kind}" for id "${(v as { id: string }).id}"`,
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

function toBoundaryCell(v: StructuralVertexSpec): DrawioVertex {
  const isCrossComponent = v.tags?.includes(CROSS_COMPONENT) ?? false;
  const baseStyle = STYLES["system-boundary"];
  return {
    id: toDrawioId(v.id),
    value: isCrossComponent
      ? `${v.name}\n[External Component]`
      : `${v.name}\n[Component]`,
    style: isCrossComponent ? withDottedStroke(baseStyle) : baseStyle,
    kind: "system-boundary",
    parent: v.parentId ? toDrawioId(v.parentId) : undefined,
  };
}

function toCodeCell(v: CodeVertexSpec): DrawioVertex {
  const styleKey = styleKeyFor(v.elementKind);
  const isCrossComponent = v.tags?.includes(CROSS_COMPONENT) ?? false;
  const baseStyle = STYLES[styleKey];
  return {
    id: toDrawioId(v.id),
    value: `${v.name}\n[${v.elementKind}]`,
    style: isCrossComponent ? withDottedStroke(baseStyle) : baseStyle,
    kind: styleKey,
    parent: v.parentId ? toDrawioId(v.parentId) : undefined,
  };
}

/** Convenience wrapper: project then emit cells. Flushes warnings to stderr. */
export function buildCodeCells(
  model: ArchitectureModel,
  component: Component,
): DiagramCells {
  const spec = projectCode(model, component.id);
  flushProjectionWarnings(spec.warnings);
  return emitCodeCells(spec);
}
