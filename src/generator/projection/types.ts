import type {
  CodeElementKind,
  CodeRelationship,
} from "../../analyzers/types.js";

/**
 * Semantic vertex categories. Emitters map these to their own style/kind
 * vocabularies; projection itself stays free of styling and syntax.
 */
export type VertexKind =
  | "actor"
  | "system"
  | "container"
  | "component"
  | "external-system"
  | "code-element";

/**
 * L4 element kind. Aliased from `analyzers/types.ts` so projection and
 * emitters share one closed union — no string casts at the boundary.
 */
export type CodeVertexElementKind = CodeElementKind;

/** Member rendered inside a class/struct/enum container vertex. */
export interface CodeVertexMember {
  name: string;
  signature?: string;
}

interface VertexSpecBase {
  id: string;
  name: string;
  technology?: string;
  description?: string;
  tags?: string[];
  parentId?: string;
}

/** Non-code vertex (L1–L3): actor / system / container / component / external. */
export interface StructuralVertexSpec extends VertexSpecBase {
  kind: Exclude<VertexKind, "code-element">;
}

/**
 * L4 code-element vertex. `elementKind` is required so emitters never read a
 * missing discriminant. `members` carries class/struct/enum body when the
 * source kind has one. Cross-component vertices and their foreign component
 * boundaries are tagged `"cross-component"`.
 */
export interface CodeVertexSpec extends VertexSpecBase {
  kind: "code-element";
  elementKind: CodeVertexElementKind;
  members?: CodeVertexMember[];
  visibility?: "public" | "internal" | "private";
}

export type VertexSpec = StructuralVertexSpec | CodeVertexSpec;

export type EdgeKind = CodeRelationship["kind"];

/**
 * Structural representation of a diagram edge. Within a single
 * `DiagramSpec.edges` array projection deduplicates by source+target where
 * collapse can occur (L1, L2). At L3 / L4 same-pair edges are not
 * deduplicated; the `id` is best-effort and may collide on identical
 * (source,target) pairs — emitters that need a unique key should derive one
 * from `(source,target,label)`.
 *
 * `kind` (L4 only) carries the underlying relationship kind so emitters can
 * filter on it without parsing free-form `label`.
 */
export interface EdgeSpec {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  technology?: string;
  kind?: EdgeKind;
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
