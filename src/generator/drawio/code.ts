import type {
  ArchitectureModel,
  Component,
  CodeElement,
} from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

const CONTAINER_KINDS = new Set(["class", "interface", "enum", "struct"]);

function styleFor(el: CodeElement): string {
  return CONTAINER_KINDS.has(el.kind)
    ? STYLES["code-class"]
    : STYLES["code-fn"];
}

function kindFor(el: CodeElement): StyleKey {
  return CONTAINER_KINDS.has(el.kind) ? "code-class" : "code-fn";
}

export function buildCodeCells(
  model: ArchitectureModel,
  component: Component,
): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  vertices.push({
    id: toDrawioId(component.id),
    value: `${component.name}\n[Component]`,
    style: STYLES["system-boundary"],
    kind: "system-boundary",
  });

  const elements = sortById(
    (model.codeElements ?? []).filter((e) => e.componentId === component.id),
  );
  const elementIds = new Set(elements.map((e) => e.id));

  for (const el of elements) {
    vertices.push({
      id: toDrawioId(el.id),
      value: `${el.name}\n[${el.kind}]`,
      style: styleFor(el),
      kind: kindFor(el),
      parent: toDrawioId(component.id),
    });
  }

  const seenExternals = new Set<string>();
  for (const r of sortRelationships(model.codeRelationships ?? [])) {
    if (!elementIds.has(r.sourceId)) continue;
    if (!elementIds.has(r.targetId) && !seenExternals.has(r.targetId)) {
      seenExternals.add(r.targetId);
      vertices.push({
        id: toDrawioId(r.targetId),
        value: r.targetName ?? r.targetId,
        style: STYLES["code-class"],
        kind: "code-class",
      });
    }
    edges.push({
      id: edgeId(r.sourceId, r.targetId, r.kind),
      source: toDrawioId(r.sourceId),
      target: toDrawioId(r.targetId),
      value: r.label ?? r.kind,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
