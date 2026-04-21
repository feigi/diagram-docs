import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";

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

export function buildContextCells(model: ArchitectureModel): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  for (const a of sortById(model.actors)) {
    vertices.push({
      id: toDrawioId(a.id),
      value: `${a.name}\n[Person]\n${a.description}`,
      style: STYLES.person,
      kind: "person",
    });
  }

  vertices.push({
    id: "system",
    value: `${model.system.name}\n[Software System]\n${model.system.description}`,
    style: STYLES.system,
    kind: "system",
  });

  const externals = sortById(
    model.externalSystems.filter((e) => !e.tags?.includes("library")),
  );
  for (const e of externals) {
    vertices.push({
      id: toDrawioId(e.id),
      value: `${e.name}\n[External System]${e.technology ? `\n[${e.technology}]` : ""}\n${e.description}`,
      style: STYLES["external-system"],
      kind: "external-system",
    });
  }

  const actorIds = new Set(model.actors.map((a) => a.id));
  const externalIds = new Set(externals.map((e) => e.id));
  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentIds = new Set(model.components.map((c) => c.id));
  const internalIds = new Set([...containerIds, ...componentIds]);

  const contextIds = new Set([
    ...actorIds,
    "system",
    ...externalIds,
    ...containerIds,
    ...componentIds,
  ]);

  const contextRels = model.relationships.filter(
    (r) => contextIds.has(r.sourceId) && contextIds.has(r.targetId),
  );

  const seen = new Set<string>();
  for (const rel of sortRelationships(contextRels)) {
    const src = internalIds.has(rel.sourceId)
      ? "system"
      : toDrawioId(rel.sourceId);
    const tgt = internalIds.has(rel.targetId)
      ? "system"
      : toDrawioId(rel.targetId);
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: edgeId(src, tgt, rel.label),
      source: src,
      target: tgt,
      value: rel.technology ? `${rel.label} [${rel.technology}]` : rel.label,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
