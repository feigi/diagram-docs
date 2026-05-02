import type { ArchitectureModel } from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type { DiagramSpec, EdgeSpec, VertexSpec, VertexKind } from "./types.js";

/**
 * Projects an ArchitectureModel down to the L3 (Component) view for one
 * container.
 *
 * Drift verdicts applied:
 * - Actors that participate in an in-container relationship render as
 *   cross-container references (the drawio emitter already did this; D2
 *   used to drop them).
 * - Cross-container references carry only their plain name — no debug
 *   "| refId" suffix on the label.
 * - External-system cross-container references include their `technology`
 *   line and a "[Library]" type tag when tagged `library`. The shared
 *   `cellsFromSpec` path makes this consistent across L1/L2/L3 (L3 drawio
 *   used to render externals as a bare `name\n[External System]`).
 */
export function projectComponent(
  model: ArchitectureModel,
  containerId: string,
): DiagramSpec {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) {
    throw new Error(`Container not found: ${containerId}`);
  }

  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];
  const warnings: string[] = [];

  const localComponents = (model.components ?? []).filter(
    (c) => c.containerId === containerId,
  );
  const localIds = new Set(localComponents.map((c) => c.id));

  vertices.push({
    id: container.id,
    name: container.name,
    kind: "container",
    technology: container.technology || undefined,
    description: container.description || undefined,
  });

  for (const c of sortById(localComponents)) {
    vertices.push({
      id: c.id,
      name: c.name,
      kind: "component",
      technology: c.technology || undefined,
      description: c.description || undefined,
      parentId: container.id,
    });
  }

  const refIds = new Set<string>();
  const rels = model.relationships.filter((r) => {
    const si = localIds.has(r.sourceId);
    const ti = localIds.has(r.targetId);
    if (si || ti) {
      if (!si) refIds.add(r.sourceId);
      if (!ti) refIds.add(r.targetId);
      return true;
    }
    return false;
  });

  const droppedRefs = new Set<string>();
  for (const rid of [...refIds].sort()) {
    const actor = model.actors.find((a) => a.id === rid);
    const ext = model.externalSystems.find((e) => e.id === rid);
    const otherContainer = model.containers.find((c) => c.id === rid);
    const otherComp = (model.components ?? []).find((c) => c.id === rid);
    let kind: VertexKind | undefined;
    let name: string | undefined;
    let technology: string | undefined;
    let description: string | undefined;
    let tags: string[] | undefined;
    if (actor) {
      kind = "actor";
      name = actor.name;
      description = actor.description || undefined;
    } else if (ext) {
      kind = "external-system";
      name = ext.name;
      technology = ext.technology || undefined;
      description = ext.description || undefined;
      tags = ext.tags;
    } else if (otherContainer) {
      kind = "container";
      name = otherContainer.name;
      technology = otherContainer.technology || undefined;
      description = otherContainer.description || undefined;
    } else if (otherComp) {
      kind = "component";
      name = otherComp.name;
      technology = otherComp.technology || undefined;
      description = otherComp.description || undefined;
    }
    if (kind && name) {
      vertices.push({ id: rid, name, kind, technology, description, tags });
    } else {
      warnings.push(
        `L3 (${containerId}): cross-container ref "${rid}" matches no actor, external system, container, or component; dropping it and any edges that touch it.`,
      );
      droppedRefs.add(rid);
    }
  }

  for (const r of sortRelationships(rels)) {
    if (droppedRefs.has(r.sourceId) || droppedRefs.has(r.targetId)) continue;
    edges.push({
      id: `${r.sourceId}->${r.targetId}`,
      sourceId: r.sourceId,
      targetId: r.targetId,
      label: r.label,
      technology: r.technology || undefined,
    });
  }

  return { vertices, edges, warnings };
}
