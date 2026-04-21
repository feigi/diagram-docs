import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

export function buildContainerCells(model: ArchitectureModel): DiagramCells {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentToContainer = new Map(
    model.components.map((c) => [c.id, c.containerId]),
  );
  const allIds = new Set<string>([
    ...model.actors.map((a) => a.id),
    ...model.containers.map((c) => c.id),
    ...model.externalSystems.map((e) => e.id),
    ...model.components.map((c) => c.id),
  ]);

  const resolve = (id: string): string => componentToContainer.get(id) ?? id;

  const connected = new Set<string>();
  const seenEdges = new Set<string>();
  interface R {
    src: string;
    tgt: string;
    label: string;
    tech?: string;
  }
  const resolved: R[] = [];

  for (const r of sortRelationships(
    model.relationships.filter(
      (r) => allIds.has(r.sourceId) && allIds.has(r.targetId),
    ),
  )) {
    const src = resolve(r.sourceId);
    const tgt = resolve(r.targetId);
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    resolved.push({ src, tgt, label: r.label, tech: r.technology });
    if (containerIds.has(src)) connected.add(src);
    if (containerIds.has(tgt)) connected.add(tgt);
  }

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
    style: STYLES["system-boundary"],
    kind: "system-boundary",
  });

  for (const c of sortById(model.containers)) {
    if (!connected.has(c.id)) continue;
    vertices.push({
      id: toDrawioId(c.id),
      value: `${c.name}\n[Container: ${c.technology}]`,
      tooltip: c.description || undefined,
      style: STYLES.container,
      kind: "container",
      parent: "system",
    });
  }

  for (const e of sortById(model.externalSystems)) {
    const typeTag = e.tags?.includes("library")
      ? "[Library]"
      : "[External System]";
    const techLine = e.technology ? `\n[${e.technology}]` : "";
    vertices.push({
      id: toDrawioId(e.id),
      value: `${e.name}\n${typeTag}${techLine}`,
      tooltip: e.description || undefined,
      style: STYLES["external-system"],
      kind: "external-system",
    });
  }

  for (const r of resolved) {
    edges.push({
      id: edgeId(r.src, r.tgt, r.label),
      source: toDrawioId(r.src),
      target: toDrawioId(r.tgt),
      value: r.label,
      tooltip: r.tech ? `[${r.tech}]` : undefined,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
