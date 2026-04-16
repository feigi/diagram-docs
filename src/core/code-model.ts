import * as path from "node:path";
import { slugify } from "./slugify.js";
import type {
  RawStructure,
  Component,
  CodeElement,
  CodeRelationship,
  RawCodeReference,
  RawCodeElement,
} from "../analyzers/types.js";
import type { Config } from "../config/schema.js";

export interface BuildCodeModelResult {
  codeElements: CodeElement[];
  codeRelationships: CodeRelationship[];
}

interface ResolveContext {
  byComponentName: Map<string, CodeElement[]>; // key: `${componentId}:${name}`
  byContainerName: Map<string, CodeElement[]>; // key: `${containerId}:${name}`
  byContainerNameExcludingOwn: Map<string, CodeElement[]>; // key: `${ownContainerId}:${name}` — same-container candidates outside owner's component
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
  const includeMembers = config.code?.includeMembers ?? true;
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

  const rawElementsByQualifiedBase = new Map<
    string,
    Array<{
      raw: RawCodeElement;
      owner: { containerId: string; componentId: string };
    }>
  >();
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        if (!includePrivate && re.visibility !== "public") continue;
        const base = `${owner.containerId}.${owner.componentId}.${re.id}`;
        const bucket = rawElementsByQualifiedBase.get(base);
        if (bucket) bucket.push({ raw: re, owner });
        else rawElementsByQualifiedBase.set(base, [{ raw: re, owner }]);
      }
    }
  }

  const elements: CodeElement[] = [];
  const qualifiedIdByRaw = new Map<RawCodeElement, string>();
  for (const [base, bucket] of rawElementsByQualifiedBase) {
    const disambiguate = bucket.length > 1;
    for (const { raw: re, owner } of bucket) {
      const qualified = disambiguate
        ? `${base}-${fileDisambiguator(re.location.file)}`
        : base;
      qualifiedIdByRaw.set(re, qualified);
      const filteredMembers = !includeMembers
        ? undefined
        : includePrivate
          ? re.members
          : re.members?.filter((m) => m.visibility !== "private");
      elements.push({
        id: qualified,
        componentId: owner.componentId,
        containerId: owner.containerId,
        kind: re.kind,
        name: re.name,
        visibility: re.visibility,
        members: filteredMembers,
        tags: re.tags,
      });
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
    byContainerNameExcludingOwn: new Map(),
  };
  for (const el of filteredElements) {
    pushIndexed(ctx.byComponentName, `${el.componentId}:${el.name}`, el);
    pushIndexed(ctx.byContainerName, `${el.containerId}:${el.name}`, el);
  }
  for (const list of ctx.byComponentName.values()) list.sort(byId);
  for (const list of ctx.byContainerName.values()) list.sort(byId);

  const unresolvedByComponent = new Map<string, number>();
  const crossContainerByComponent = new Map<string, number>();
  const collisionsByComponent = new Map<string, number>();
  // Pre-compute cross-container name index so we can classify drops.
  const byGlobalName = new Map<string, CodeElement[]>();
  for (const el of filteredElements) {
    pushIndexed(byGlobalName, el.name, el);
  }
  for (const list of byGlobalName.values()) list.sort(byId);

  const relationships: CodeRelationship[] = [];
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        const sourceQualified = qualifiedIdByRaw.get(re);
        if (!sourceQualified || !keepIds.has(sourceQualified)) continue;
        for (const ref of re.references ?? []) {
          const resolved = resolveReference(
            ref,
            owner,
            ctx,
            (count, where, picked) => {
              collisionsByComponent.set(
                owner.componentId,
                (collisionsByComponent.get(owner.componentId) ?? 0) + 1,
              );
              process.stderr.write(
                `Warning: name collision resolving ${ref.kind} ${ref.targetName} ` +
                  `from ${sourceQualified}: ${count} candidates in ${where}, ` +
                  `picking ${picked}.\n`,
              );
            },
          );
          if (!resolved) {
            // Classify the drop: cross-container (architecture edge lost) vs
            // external (stdlib / third-party — expected noise).
            const global = byGlobalName.get(ref.targetName);
            if (
              global &&
              global.some((el) => el.containerId !== owner.containerId)
            ) {
              crossContainerByComponent.set(
                owner.componentId,
                (crossContainerByComponent.get(owner.componentId) ?? 0) + 1,
              );
            } else {
              unresolvedByComponent.set(
                owner.componentId,
                (unresolvedByComponent.get(owner.componentId) ?? 0) + 1,
              );
            }
            continue;
          }
          relationships.push({
            sourceId: sourceQualified,
            targetId: resolved.id,
            targetName: resolved.name,
            kind: mapReferenceKind(ref.kind),
          });
        }
      }
    }
  }

  let totalUnresolved = 0;
  for (const count of unresolvedByComponent.values()) totalUnresolved += count;
  let totalCrossContainer = 0;
  for (const count of crossContainerByComponent.values())
    totalCrossContainer += count;
  let totalCollisions = 0;
  for (const count of collisionsByComponent.values()) totalCollisions += count;

  if (totalUnresolved > 0) {
    process.stderr.write(
      `L4: ${totalUnresolved} code reference(s) dropped as stdlib/external. ` +
        `Set DIAGRAM_DOCS_DEBUG=1 for per-component breakdown.\n`,
    );
  }
  if (totalCrossContainer > 0) {
    process.stderr.write(
      `Warning: L4: ${totalCrossContainer} code reference(s) dropped because they cross container boundaries ` +
        `(targets exist in a different container). Set DIAGRAM_DOCS_DEBUG=1 for per-component breakdown.\n`,
    );
  }
  if (totalCollisions > 0) {
    process.stderr.write(
      `L4: ${totalCollisions} name-collision pick(s) during resolution. ` +
        `Picks are deterministic (by qualified id).\n`,
    );
  }

  if (process.env.DIAGRAM_DOCS_DEBUG) {
    for (const [compId, count] of unresolvedByComponent) {
      process.stderr.write(
        `[L4 debug] component ${compId}: ${count} stdlib/external reference(s) dropped\n`,
      );
    }
    for (const [compId, count] of crossContainerByComponent) {
      process.stderr.write(
        `[L4 debug] component ${compId}: ${count} cross-container reference(s) dropped\n`,
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

function byId(a: CodeElement, b: CodeElement): number {
  return a.id.localeCompare(b.id);
}

function fileDisambiguator(filePath: string): string {
  // Use basename without extension so collisions in different directories but
  // same stem still collide deterministically (still a collision, but
  // model-build resolves by picking the first sorted id). Slugify so the id
  // is safe for downstream D2 identifier construction via toD2Id.
  const base = path.basename(filePath, path.extname(filePath));
  return slugify(base);
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
  onCollision: (count: number, where: string, pickedId: string) => void,
): CodeElement | null {
  const sameComp = ctx.byComponentName.get(
    `${owner.componentId}:${ref.targetName}`,
  );
  if (sameComp && sameComp.length > 0) {
    if (sameComp.length > 1) {
      onCollision(
        sameComp.length,
        `component ${owner.componentId}`,
        sameComp[0].id,
      );
    }
    return sameComp[0];
  }

  const sameContainer = ctx.byContainerName.get(
    `${owner.containerId}:${ref.targetName}`,
  );
  if (sameContainer && sameContainer.length > 0) {
    if (sameContainer.length > 1) {
      onCollision(
        sameContainer.length,
        `container ${owner.containerId}`,
        sameContainer[0].id,
      );
    }
    return sameContainer[0];
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
