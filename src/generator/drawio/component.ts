import type { ArchitectureModel } from "../../analyzers/types.js";
import { STYLES } from "./styles.js";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
} from "./stability.js";
import type { DiagramCells, VertexSpec, EdgeSpec } from "./context.js";

export function buildComponentCells(
  model: ArchitectureModel,
  containerId: string,
): DiagramCells {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) throw new Error(`Container not found: ${containerId}`);

  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];
  const localComponents = model.components.filter(
    (c) => c.containerId === containerId,
  );
  const localIds = new Set(localComponents.map((c) => c.id));

  vertices.push({
    id: toDrawioId(container.id),
    value: `${container.name}\n[Container: ${container.technology}]`,
    style: STYLES["system-boundary"],
  });

  for (const c of sortById(localComponents)) {
    vertices.push({
      id: toDrawioId(c.id),
      value: `${c.name}\n[Component: ${c.technology}]\n${c.description}`,
      style: STYLES.component,
      parent: toDrawioId(container.id),
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

  for (const rid of [...refIds].sort()) {
    const ext = model.externalSystems.find((e) => e.id === rid);
    const otherContainer = model.containers.find((c) => c.id === rid);
    const otherComp = model.components.find((c) => c.id === rid);

    if (ext) {
      vertices.push({
        id: toDrawioId(rid),
        value: `${ext.name}\n[External System]`,
        style: STYLES["external-system"],
      });
    } else if (otherContainer) {
      vertices.push({
        id: toDrawioId(rid),
        value: `${otherContainer.name}\n[Container: ${otherContainer.technology}]`,
        style: STYLES.container,
      });
    } else if (otherComp) {
      vertices.push({
        id: toDrawioId(rid),
        value: `${otherComp.name}\n[Component: ${otherComp.technology}]`,
        style: STYLES.component,
      });
    } else {
      vertices.push({
        id: toDrawioId(rid),
        value: rid,
        style: STYLES.component,
      });
    }
  }

  for (const r of sortRelationships(rels)) {
    edges.push({
      id: edgeId(r.sourceId, r.targetId, r.label),
      source: toDrawioId(r.sourceId),
      target: toDrawioId(r.targetId),
      value: r.technology ? `${r.label} [${r.technology}]` : r.label,
      style: STYLES.relationship,
    });
  }

  return { vertices, edges };
}
