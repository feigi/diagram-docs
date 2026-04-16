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

interface ResolveContext {
  byComponentName: Map<string, CodeElement[]>; // key: `${componentId}:${name}`
  byContainerName: Map<string, CodeElement[]>; // key: `${containerId}:${name}`
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
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        if (!includePrivate && re.visibility !== "public") continue;
        elements.push({
          id: `${owner.containerId}.${owner.componentId}.${re.id}`,
          componentId: owner.componentId,
          containerId: owner.containerId,
          kind: re.kind,
          name: re.name,
          visibility: re.visibility,
          members: includePrivate
            ? re.members
            : re.members?.filter((m) => m.visibility !== "private"),
          tags: re.tags,
        });
      }
    }
  }

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

  const ctx: ResolveContext = {
    byComponentName: new Map(),
    byContainerName: new Map(),
  };
  for (const el of filteredElements) {
    pushIndexed(ctx.byComponentName, `${el.componentId}:${el.name}`, el);
    pushIndexed(ctx.byContainerName, `${el.containerId}:${el.name}`, el);
  }

  const unresolvedByComponent = new Map<string, number>();
  const collisionsByComponent = new Map<string, number>();
  const relationships: CodeRelationship[] = [];
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        const sourceQualified = `${owner.containerId}.${owner.componentId}.${re.id}`;
        if (!keepIds.has(sourceQualified)) continue;
        for (const ref of re.references ?? []) {
          const resolved = resolveReference(ref, owner, ctx, (count, where) => {
            collisionsByComponent.set(
              owner.componentId,
              (collisionsByComponent.get(owner.componentId) ?? 0) + 1,
            );
            process.stderr.write(
              `Warning: name collision resolving ${ref.kind} ${ref.targetName} ` +
                `from ${sourceQualified}: ${count} candidates in ${where}, picking first.\n`,
            );
          });
          if (!resolved) {
            unresolvedByComponent.set(
              owner.componentId,
              (unresolvedByComponent.get(owner.componentId) ?? 0) + 1,
            );
            continue;
          }
          relationships.push({
            sourceId: sourceQualified,
            targetId: resolved,
            kind: mapReferenceKind(ref.kind),
          });
        }
      }
    }
  }

  if (process.env.DIAGRAM_DOCS_DEBUG) {
    for (const [compId, count] of unresolvedByComponent) {
      process.stderr.write(
        `[L4 debug] component ${compId}: ${count} unresolved reference(s)\n`,
      );
    }
    for (const [compId, count] of collisionsByComponent) {
      process.stderr.write(
        `[L4 debug] component ${compId}: ${count} name-collision warning(s)\n`,
      );
    }
  }

  return {
    codeElements: filteredElements,
    codeRelationships: relationships,
  };
}

function pushIndexed(
  map: Map<string, CodeElement[]>,
  key: string,
  el: CodeElement,
): void {
  const list = map.get(key);
  if (list) list.push(el);
  else map.set(key, [el]);
}

/**
 * Resolution order:
 *   1. Same component first (most specific scope; matches normal in-file usage).
 *   2. Same container, any component (cross-component refs within an app).
 *   3. Drop silently — refs to stdlib / third-party types legitimately won't
 *      resolve, and per-ref logging would drown the signal. Aggregate counts
 *      are surfaced via DIAGRAM_DOCS_DEBUG instead.
 *
 * Cross-container resolution is intentionally excluded: components in different
 * containers represent separately-deployable units, so a code-level edge across
 * that boundary would misrepresent the architecture.
 */
function resolveReference(
  ref: RawCodeReference,
  owner: { containerId: string; componentId: string },
  ctx: ResolveContext,
  onCollision: (count: number, where: string) => void,
): string | null {
  const sameComp = ctx.byComponentName.get(
    `${owner.componentId}:${ref.targetName}`,
  );
  if (sameComp && sameComp.length > 0) {
    if (sameComp.length > 1) {
      onCollision(sameComp.length, `component ${owner.componentId}`);
    }
    return sameComp[0].id;
  }

  const sameContainer = ctx.byContainerName.get(
    `${owner.containerId}:${ref.targetName}`,
  );
  if (sameContainer && sameContainer.length > 0) {
    if (sameContainer.length > 1) {
      onCollision(sameContainer.length, `container ${owner.containerId}`);
    }
    return sameContainer[0].id;
  }

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
