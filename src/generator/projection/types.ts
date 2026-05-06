/**
 * Semantic vertex categories. Emitters map these to their own style/kind
 * vocabularies; projection itself stays free of styling and syntax.
 *
 * `code-element` carries L4 code entities (class / interface / function /
 * struct / typedef / enum / type). The specific element kind lives on
 * `VertexSpec.elementKind`; `language` and `members` are populated when
 * relevant.
 */
export type VertexKind =
  | "actor"
  | "system"
  | "container"
  | "component"
  | "external-system"
  | "code-element";

/**
 * L4 element kind — mirrors `CodeElementKind` from `analyzers/types.ts` so
 * emitters don't reach back into the architecture model for shape decisions.
 */
export type CodeVertexElementKind =
  | "class"
  | "interface"
  | "enum"
  | "struct"
  | "type"
  | "typedef"
  | "function";

/** Member rendered inside a class/struct/enum container vertex. */
export interface CodeVertexMember {
  name: string;
  signature?: string;
}

/**
 * Structural representation of a diagram vertex. A vertex with `parentId` is
 * nested inside another vertex; the parent appears in the same `vertices`
 * array and is recognised as a boundary by emitters. `tags` is passed through
 * from the source model (e.g. ["library"] on an external system).
 *
 * Code-level fields (`elementKind`, `language`, `members`, `visibility`) are
 * populated only for `kind === "code-element"`. Cross-component code-element
 * vertices and their foreign component boundaries carry the tag
 * `"cross-component"`.
 */
export interface VertexSpec {
  id: string;
  name: string;
  kind: VertexKind;
  technology?: string;
  description?: string;
  tags?: string[];
  parentId?: string;
  elementKind?: CodeVertexElementKind;
  language?: "java" | "typescript" | "python" | "c";
  members?: CodeVertexMember[];
  visibility?: "public" | "internal" | "private";
}

/**
 * Structural representation of a diagram edge. Within a single
 * `DiagramSpec.edges` array projection deduplicates by source+target where
 * collapse can occur (L1, L2). At L3 / L4 same-pair edges are not
 * deduplicated; the `id` is best-effort and may collide on identical
 * (source,target) pairs — emitters that need a unique key should derive one
 * from `(source,target,label)`.
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
