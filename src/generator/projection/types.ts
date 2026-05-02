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
 * Structural representation of a diagram edge. `id` is unique within a
 * `DiagramSpec` (projection deduplicates by source+target before emitting).
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
}
