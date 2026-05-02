import type { ArchitectureModel } from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type { DiagramSpec, EdgeSpec, VertexSpec } from "./types.js";

/**
 * Projects an ArchitectureModel down to the L2 (Container) view.
 *
 * Component endpoints collapse to their parent container; many cross-component
 * edges therefore deduplicate to one edge per container-pair. Containers
 * with no remaining edge participation are dropped (dangling).
 */
export function projectContainer(model: ArchitectureModel): DiagramSpec {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentToContainer = new Map(
    (model.components ?? []).map((c) => [c.id, c.containerId]),
  );
  const allIds = new Set<string>([
    ...model.actors.map((a) => a.id),
    ...model.containers.map((c) => c.id),
    ...model.externalSystems.map((e) => e.id),
    ...(model.components ?? []).map((c) => c.id),
  ]);

  const resolve = (id: string): string => componentToContainer.get(id) ?? id;

  const seen = new Set<string>();
  const connected = new Set<string>();

  for (const r of sortRelationships(
    model.relationships.filter(
      (r) => allIds.has(r.sourceId) && allIds.has(r.targetId),
    ),
  )) {
    const src = resolve(r.sourceId);
    const tgt = resolve(r.targetId);
    if (src === tgt) continue;
    const key = `${src}->${tgt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: key,
      sourceId: src,
      targetId: tgt,
      label: r.label,
      technology: r.technology || undefined,
    });
    if (containerIds.has(src)) connected.add(src);
    if (containerIds.has(tgt)) connected.add(tgt);
  }

  for (const a of sortById(model.actors)) {
    vertices.push({
      id: a.id,
      name: a.name,
      kind: "actor",
      description: a.description || undefined,
    });
  }

  vertices.push({
    id: "system",
    name: model.system.name,
    kind: "system",
    description: model.system.description || undefined,
  });

  for (const c of sortById(model.containers)) {
    if (!connected.has(c.id)) continue;
    vertices.push({
      id: c.id,
      name: c.name,
      kind: "container",
      technology: c.technology || undefined,
      description: c.description || undefined,
      parentId: "system",
    });
  }

  for (const e of sortById(model.externalSystems)) {
    vertices.push({
      id: e.id,
      name: e.name,
      kind: "external-system",
      technology: e.technology || undefined,
      description: e.description || undefined,
      tags: e.tags,
    });
  }

  return { vertices, edges };
}
