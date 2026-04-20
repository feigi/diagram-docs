import { slugify } from "../../core/slugify.js";

export function toDrawioId(modelId: string): string {
  return slugify(modelId);
}

export function edgeId(
  sourceId: string,
  targetId: string,
  relationship: string,
): string {
  return `${toDrawioId(sourceId)}->${toDrawioId(targetId)}-${slugify(relationship)}`;
}

export function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

export function sortRelationships<
  T extends { sourceId: string; targetId: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const cmp = a.sourceId.localeCompare(b.sourceId);
    if (cmp !== 0) return cmp;
    return a.targetId.localeCompare(b.targetId);
  });
}
