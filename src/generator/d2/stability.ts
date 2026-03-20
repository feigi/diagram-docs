import { slugify } from "../../core/slugify.js";

/**
 * Derive a stable D2 shape ID from a model element ID.
 * Ensures IDs are valid D2 identifiers and deterministic.
 */
export function toD2Id(modelId: string): string {
  return slugify(modelId);
}

/**
 * Sort an array of objects by their ID for deterministic output.
 */
export function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Sort relationships deterministically by source then target.
 */
export function sortRelationships<
  T extends { sourceId: string; targetId: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const cmp = a.sourceId.localeCompare(b.sourceId);
    if (cmp !== 0) return cmp;
    return a.targetId.localeCompare(b.targetId);
  });
}
