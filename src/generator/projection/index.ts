export type { VertexKind, VertexSpec, EdgeSpec, DiagramSpec } from "./types.js";

/** Surface non-fatal projection warnings on stderr (matches drawio merge). */
export function flushProjectionWarnings(warnings: string[]): void {
  for (const w of warnings) console.error(`Warning: projection: ${w}`);
}
