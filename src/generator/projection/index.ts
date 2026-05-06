export type {
  VertexKind,
  VertexSpec,
  StructuralVertexSpec,
  CodeVertexSpec,
  CodeVertexElementKind,
  CodeVertexMember,
  EdgeSpec,
  EdgeKind,
  DiagramSpec,
} from "./types.js";

const seenWarnings = new Set<string>();

/**
 * Surface non-fatal projection warnings on stderr (matches drawio drift).
 *
 * Deduplicates by warning text across the process lifetime so the same
 * dropped-edge message doesn't print twice when both d2 and drawio emit
 * the same component. Tracked count is exposed via
 * `hasProjectionWarnings()` so the CLI can propagate to exit code.
 */
export function flushProjectionWarnings(warnings: string[]): void {
  for (const w of warnings) {
    if (seenWarnings.has(w)) continue;
    seenWarnings.add(w);
    console.error(`Warning: projection: ${w}`);
  }
}

export function hasProjectionWarnings(): boolean {
  return seenWarnings.size > 0;
}

/** Reset deduper — for tests that want a clean slate per case. */
export function resetProjectionWarnings(): void {
  seenWarnings.clear();
}
