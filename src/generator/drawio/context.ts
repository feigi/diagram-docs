import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import type { StyleKey } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
  wrapEdgeLabel,
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
      value: `${a.name}\n[Person]`,
      tooltip: a.description || undefined,
      style: STYLES.person,
      kind: "person",
    });
  }

  vertices.push({
    id: "system",
    value: `${model.system.name}\n[Software System]`,
    tooltip: model.system.description || undefined,
    style: STYLES.system,
    kind: "system",
  });

  const externals = sortById(
    model.externalSystems.filter((e) => !e.tags?.includes("library")),
  );
  for (const e of externals) {
    const techLine = e.technology ? `\n[${e.technology}]` : "";
    vertices.push({
      id: toDrawioId(e.id),
      value: `${e.name}\n[External System]${techLine}`,
      tooltip: e.description || undefined,
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
  // Drop external↔external relationships from the L1 context view. C4 Level 1
  // documents how actors and external systems interact with the target system,
  // not how externals wire to each other; keeping them forces ELK to allocate
  // extra layers and scatters externals across the diagram.
  const contextRelsFiltered = contextRels.filter(
    (r) => !(externalIds.has(r.sourceId) && externalIds.has(r.targetId)),
  );

  const seen = new Set<string>();
  for (const rel of sortRelationships(contextRelsFiltered)) {
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
      value: wrapEdgeLabel(rel.label),
      tooltip: rel.technology ? `[${rel.technology}]` : undefined,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
