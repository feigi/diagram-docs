import type {
  RawStructure,
  Component,
  CodeElement,
  CodeRelationship,
  RawCodeReference,
} from "../analyzers/types.js";
import type { Config } from "../config/schema.js";

export interface BuildCodeModelResult {
  codeElements: CodeElement[];
  codeRelationships: CodeRelationship[];
}

export function buildCodeModel(
  raw: RawStructure,
  components: Component[],
  config: Pick<Config, "levels" | "code">,
): BuildCodeModelResult {
  if (!config.levels?.code) {
    return { codeElements: [], codeRelationships: [] };
  }

  const includePrivate = config.code?.includePrivate ?? false;
  const minElements = config.code?.minElements ?? 2;

  // module.id -> { containerId, componentId }
  const moduleOwnership = new Map<
    string,
    { containerId: string; componentId: string }
  >();
  for (const comp of components) {
    for (const moduleId of comp.moduleIds ?? []) {
      moduleOwnership.set(moduleId, {
        containerId: comp.containerId,
        componentId: comp.id,
      });
    }
  }

  const elements: CodeElement[] = [];
  const rawByLocal = new Map<
    string,
    { qualified: string; componentId: string }
  >();

  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        if (!includePrivate && re.visibility !== "public") continue;
        const qualified = `${owner.containerId}.${owner.componentId}.${re.id}`;
        elements.push({
          id: qualified,
          componentId: owner.componentId,
          kind: re.kind,
          name: re.name,
          visibility: re.visibility,
          parentElementId: re.parentId
            ? `${owner.containerId}.${owner.componentId}.${re.parentId}`
            : undefined,
          members: includePrivate
            ? re.members
            : re.members?.filter((m) => m.visibility !== "private"),
          tags: re.tags,
        });
        rawByLocal.set(`${owner.componentId}:${re.name}`, {
          qualified,
          componentId: owner.componentId,
        });
      }
    }
  }

  // Apply minElements threshold per component.
  const countByComponent = new Map<string, number>();
  for (const el of elements) {
    countByComponent.set(
      el.componentId,
      (countByComponent.get(el.componentId) ?? 0) + 1,
    );
  }
  const filteredElements = elements.filter(
    (el) => (countByComponent.get(el.componentId) ?? 0) >= minElements,
  );
  const keepIds = new Set(filteredElements.map((e) => e.id));

  // Resolve references.
  const relationships: CodeRelationship[] = [];
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        const sourceQualified = `${owner.containerId}.${owner.componentId}.${re.id}`;
        if (!keepIds.has(sourceQualified)) continue;
        for (const ref of re.references ?? []) {
          const resolved = resolveReference(ref, owner, elements);
          if (!resolved) continue;
          relationships.push({
            sourceId: sourceQualified,
            targetId: resolved,
            kind: mapReferenceKind(ref.kind),
          });
        }
      }
    }
  }

  return {
    codeElements: filteredElements,
    codeRelationships: relationships,
  };
}

function resolveReference(
  ref: RawCodeReference,
  owner: { containerId: string; componentId: string },
  allElements: CodeElement[],
): string | null {
  // Same-component match first.
  const sameComponent = allElements.find(
    (e) => e.componentId === owner.componentId && e.name === ref.targetName,
  );
  if (sameComponent) return sameComponent.id;
  // Cross-component same-container match next.
  const sameContainer = allElements.find(
    (e) =>
      e.id.startsWith(`${owner.containerId}.`) && e.name === ref.targetName,
  );
  if (sameContainer) return sameContainer.id;
  return null;
}

function mapReferenceKind(
  k: RawCodeReference["kind"],
): CodeRelationship["kind"] {
  switch (k) {
    case "extends":
      return "inherits";
    case "implements":
      return "implements";
    case "uses":
      return "uses";
    case "contains":
      return "contains";
  }
}
