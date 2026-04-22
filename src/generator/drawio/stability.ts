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

/**
 * Line separator used inside wrapped edge labels. Drawio's edge style has
 * {@code html=1}, so literal `\n` collapses to whitespace — `<br>` forces an
 * actual line break at render time. Layout code splits on this token to
 * estimate wrapped label bounds.
 */
export const EDGE_LABEL_BR = "<br>";

/**
 * Insert {@link EDGE_LABEL_BR} tags into an edge label so drawio renders it
 * as a block of narrow lines instead of one long streak. Greedy word-wrap at
 * {@link max} characters; oversized single words are emitted on their own
 * line. Keeps the same text for both the rendered value and the ELK
 * label-bounds estimate, so ELK reserves height proportional to line count.
 */
export function wrapEdgeLabel(text: string, max = 22): string {
  if (!text) return text;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= max) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join(EDGE_LABEL_BR);
}
