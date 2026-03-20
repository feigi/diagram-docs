/**
 * Extract a per-container model fragment from a full ArchitectureModel.
 * Each fragment is a valid ArchitectureModel scoped to one container.
 */
import type { ArchitectureModel } from "../analyzers/types.js";

/**
 * Extract a model subset containing only the given container,
 * its components, relevant relationships, and referenced external systems.
 */
export function extractFragment(
  model: ArchitectureModel,
  containerId: string,
): ArchitectureModel {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) {
    throw new Error(`Container not found: ${containerId}`);
  }

  const components = model.components.filter(
    (c) => c.containerId === containerId,
  );
  const componentIds = new Set(components.map((c) => c.id));

  // Relationships where at least one endpoint is in this container
  // (container-level or component-level)
  const relevantRels = model.relationships.filter((r) => {
    return (
      r.sourceId === containerId ||
      r.targetId === containerId ||
      componentIds.has(r.sourceId) ||
      componentIds.has(r.targetId)
    );
  });

  // Collect IDs referenced by relationships that are external systems
  const extSystemIds = new Set(model.externalSystems.map((e) => e.id));
  const referencedExtIds = new Set<string>();
  for (const rel of relevantRels) {
    if (extSystemIds.has(rel.sourceId)) referencedExtIds.add(rel.sourceId);
    if (extSystemIds.has(rel.targetId)) referencedExtIds.add(rel.targetId);
  }

  const externalSystems = model.externalSystems.filter((e) =>
    referencedExtIds.has(e.id),
  );

  return {
    version: 1,
    system: model.system,
    actors: [], // Per-folder fragments don't include actors
    externalSystems,
    containers: [container],
    components,
    relationships: relevantRels,
  };
}
