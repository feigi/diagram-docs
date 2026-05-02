import type { ArchitectureModel } from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type { DiagramSpec, EdgeSpec, VertexSpec } from "./types.js";

/**
 * Projects an ArchitectureModel down to the L1 (Context) view.
 *
 * Drift verdicts applied:
 * - external↔external relationships dropped — they scatter the layout and
 *   add no information at L1.
 *
 * Internal (container/component) endpoints collapse into the synthetic
 * "system" vertex; many component→external edges therefore deduplicate into
 * one system→external edge.
 */
export function projectContext(model: ArchitectureModel): DiagramSpec {
  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];

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

  const externals = sortById(
    model.externalSystems.filter((e) => !e.tags?.includes("library")),
  );
  for (const e of externals) {
    vertices.push({
      id: e.id,
      name: e.name,
      kind: "external-system",
      technology: e.technology || undefined,
      description: e.description || undefined,
      tags: e.tags,
    });
  }

  const externalIds = new Set(externals.map((e) => e.id));
  const containerIds = new Set(model.containers.map((c) => c.id));
  const componentIds = new Set((model.components ?? []).map((c) => c.id));
  const internalIds = new Set([...containerIds, ...componentIds]);
  const visibleIds = new Set([
    ...model.actors.map((a) => a.id),
    "system",
    ...externalIds,
    ...containerIds,
    ...componentIds,
  ]);

  const seen = new Set<string>();
  for (const r of sortRelationships(model.relationships)) {
    if (!visibleIds.has(r.sourceId) || !visibleIds.has(r.targetId)) continue;
    if (externalIds.has(r.sourceId) && externalIds.has(r.targetId)) continue;
    const src = internalIds.has(r.sourceId) ? "system" : r.sourceId;
    const tgt = internalIds.has(r.targetId) ? "system" : r.targetId;
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
  }

  return { vertices, edges };
}
