import type {
  ArchitectureModel,
  CodeElement,
  CodeRelationship,
} from "../../analyzers/types.js";
import { sortById, sortRelationships } from "../d2/stability.js";
import type {
  CodeVertexMember,
  CodeVertexSpec,
  DiagramSpec,
  EdgeSpec,
  StructuralVertexSpec,
  VertexSpec,
} from "./types.js";

/**
 * Projects an ArchitectureModel down to the L4 (Code) view for one component.
 *
 * Output shape:
 * - One **local component boundary** vertex (`kind: "component"`, no parentId).
 * - Each local code element as `kind: "code-element"` with `parentId` set to
 *   the local component id.
 * - For every cross-component edge whose target is a `CodeElement` in another
 *   component, the foreign element appears as a `code-element` vertex tagged
 *   `"cross-component"`. The foreign component boundary vertex is emitted on
 *   demand (only when at least one edge crosses into it) and is itself tagged
 *   `"cross-component"`.
 * - Edges carry `relationship.kind` in `EdgeSpec.label` (matches the existing
 *   L1–L3 convention) and the same value in `EdgeSpec.kind` so emitters can
 *   filter without re-parsing free-form labels.
 *
 * Post-condition: every `EdgeSpec.sourceId` and `EdgeSpec.targetId` appears as
 * a `VertexSpec.id` in the result. Emitters can rely on this to render edges
 * without dangling references.
 *
 * Invariant assumption (from `core/code-model.ts`): every `CodeRelationship`
 * has source and target ids that exist in `model.codeElements`. Projection is
 * defensive about violations — it warns and drops rather than throwing — so a
 * hand-built model that bypasses model-build doesn't crash the generator.
 */
export function projectCode(
  model: ArchitectureModel,
  componentId: string,
): DiagramSpec {
  const component = (model.components ?? []).find((c) => c.id === componentId);
  if (!component) {
    throw new Error(`Component not found: ${componentId}`);
  }

  const vertices: VertexSpec[] = [];
  const edges: EdgeSpec[] = [];
  const warnings: string[] = [];

  vertices.push(makeComponentVertex(component));

  const allElements = model.codeElements ?? [];
  const elementById = new Map(allElements.map((e) => [e.id, e]));
  const localElements = sortById(
    allElements.filter((e) => e.componentId === componentId),
  );
  const localIds = new Set(localElements.map((e) => e.id));
  const componentById = new Map((model.components ?? []).map((c) => [c.id, c]));

  for (const el of localElements) {
    vertices.push(makeCodeVertex(el, component.id));
  }

  const foreignElementIds = new Set<string>();
  const foreignComponentIds = new Set<string>();

  const rels = sortRelationships(model.codeRelationships ?? []);
  for (const r of rels) {
    if (!localIds.has(r.sourceId)) {
      // Source belongs to another local component: expected, no warning.
      // Source unknown to the whole model: contract violation, surface it.
      if (!elementById.has(r.sourceId)) {
        warnings.push(
          `L4 (${componentId}): relationship source "${r.sourceId}" has no matching code element; dropping edge to "${r.targetId}".`,
        );
      }
      continue;
    }

    if (localIds.has(r.targetId)) {
      edges.push(makeEdge(r));
      continue;
    }

    const target = elementById.get(r.targetId);
    if (!target) {
      warnings.push(
        `L4 (${componentId}): relationship target "${r.targetId}" has no matching code element; dropping edge from "${r.sourceId}".`,
      );
      continue;
    }

    const foreignComp = componentById.get(target.componentId);
    if (!foreignComp) {
      warnings.push(
        `L4 (${componentId}): cross-component target "${r.targetId}" references unknown component "${target.componentId}"; dropping edge from "${r.sourceId}".`,
      );
      continue;
    }

    if (!foreignComponentIds.has(foreignComp.id)) {
      foreignComponentIds.add(foreignComp.id);
      vertices.push({
        ...makeComponentVertex(foreignComp),
        tags: ["cross-component"],
      });
    }

    if (!foreignElementIds.has(target.id)) {
      foreignElementIds.add(target.id);
      vertices.push({
        ...makeCodeVertex(target, foreignComp.id),
        tags: ["cross-component"],
      });
    }

    edges.push(makeEdge(r));
  }

  return { vertices, edges, warnings };
}

function makeComponentVertex(component: {
  id: string;
  name: string;
  technology?: string;
  description?: string;
}): StructuralVertexSpec {
  return {
    id: component.id,
    name: component.name,
    kind: "component",
    technology: component.technology || undefined,
    description: component.description || undefined,
  };
}

function makeCodeVertex(el: CodeElement, parentId: string): CodeVertexSpec {
  const members: CodeVertexMember[] | undefined =
    "members" in el && el.members
      ? el.members.map((m) => ({ name: m.name, signature: m.signature }))
      : undefined;
  return {
    id: el.id,
    name: el.name,
    kind: "code-element",
    parentId,
    elementKind: el.kind,
    members,
    visibility: el.visibility,
  };
}

function makeEdge(r: CodeRelationship): EdgeSpec {
  return {
    id: `${r.sourceId}->${r.targetId}:${r.kind}`,
    sourceId: r.sourceId,
    targetId: r.targetId,
    label: r.label ?? r.kind,
    kind: r.kind,
  };
}
