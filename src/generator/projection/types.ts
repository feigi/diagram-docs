/**
 * Semantic vertex categories. Emitters map these to their own style/kind
 * vocabularies; projection itself stays free of styling and syntax.
 */
export type VertexKind =
  | "actor"
  | "system"
  | "container"
  | "component"
  | "external-system";

/**
 * Structural representation of a diagram vertex. A vertex with `parentId` is
 * nested inside another vertex; the parent appears in the same `vertices`
 * array and is recognised as a boundary by emitters. `tags` is passed through
 * from the source model (e.g. ["library"] on an external system).
 */
export interface VertexSpec {
  id: string;
  name: string;
  kind: VertexKind;
  technology?: string;
  description?: string;
  tags?: string[];
  parentId?: string;
}

/**
 * Structural representation of a diagram edge. Within a single
 * `DiagramSpec.edges` array projection deduplicates by source+target where
 * collapse can occur (L1, L2). At L3 same-pair edges are not deduplicated;
 * the `id` is best-effort and may collide on identical (source,target) pairs
 * — emitters that need a unique key should derive one from `(source,target,label)`.
 */
export interface EdgeSpec {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  technology?: string;
}

export interface DiagramSpec {
  vertices: VertexSpec[];
  edges: EdgeSpec[];
  /**
   * Non-fatal projection warnings (unresolved refs, dropped relationships,
   * etc.). Emitter wrappers flush these to stderr before emitting.
   */
  warnings: string[];
}
