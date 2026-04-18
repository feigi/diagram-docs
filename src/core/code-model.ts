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

export interface DroppedReference {
  sourceId: string;
  targetRaw: string;
  reason: "stdlib" | "cross-container";
  componentId: string;
}

export interface AmbiguousResolution {
  sourceId: string;
  targetRaw: string;
  componentId: string;
  candidateCount: number;
  pickedId: string;
  scope: "component" | "container";
}

export interface BuildCodeModelResult {
  codeElements: CodeElement[];
  codeRelationships: CodeRelationship[];
  droppedReferences: DroppedReference[];
  ambiguousResolutions: AmbiguousResolution[];
}

interface ResolveContext {
  byComponentName: Map<string, CodeElement[]>; // key: `${componentId}:${name}`
  byContainerName: Map<string, CodeElement[]>; // key: `${containerId}:${name}`
  byContainerNameExcludingOwn: Map<string, CodeElement[]>; // key: `${ownContainerId}:${name}` — same-container candidates outside owner's component
  /** Index of elements that carry a qualifiedName, keyed by `${componentId}:${qualifiedName}`. Always exactly one element per key when populated by analyzer. */
  byComponentQualifiedName: Map<string, CodeElement>;
  /** Container-scope FQN index, keyed by `${containerId}:${qualifiedName}`. */
  byContainerQualifiedName: Map<string, CodeElement>;
}

export function buildCodeModel(
  raw: RawStructure,
  components: Component[],
  config: Pick<Config, "levels" | "code">,
): BuildCodeModelResult {
  if (!config.levels?.code) {
    return {
      codeElements: [],
      codeRelationships: [],
      droppedReferences: [],
      ambiguousResolutions: [],
    };
  }

  const includePrivate = config.code?.includePrivate ?? false;
  const includeMembers = config.code?.includeMembers ?? true;
  const minElements = config.code?.minElements ?? 2;

  // Pre-index module→owning-app language so every CodeElement we build can
  // carry it. Persisting language on the element lets `--model` round-trips
  // pick the correct L4 profile without needing rawStructure at generate time.
  const languageByModuleId = new Map<
    string,
    "java" | "typescript" | "python" | "c"
  >();
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      languageByModuleId.set(mod.id, app.language);
    }
  }

  const moduleOwnership = new Map<
    string,
    {
      containerId: string;
      componentId: string;
      language: "java" | "typescript" | "python" | "c";
    }
  >();
  for (const comp of components) {
    for (const moduleId of comp.moduleIds ?? []) {
      const language = languageByModuleId.get(moduleId);
      if (!language) continue;
      moduleOwnership.set(moduleId, {
        containerId: comp.containerId,
        componentId: comp.id,
        language,
      });
    }
  }

  const rawElementsByQualifiedBase = new Map<
    string,
    Array<{
      raw: RawCodeElement;
      owner: {
        containerId: string;
        componentId: string;
        language: "java" | "typescript" | "python" | "c";
      };
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
    const suffixes =
      bucket.length > 1
        ? assignDisambiguators(bucket.map(({ raw }) => raw))
        : null;
    for (let i = 0; i < bucket.length; i++) {
      const { raw: re, owner } = bucket[i];
      const qualified = suffixes ? `${base}-${suffixes[i]}` : base;
      qualifiedIdByRaw.set(re, qualified);
      // Discriminated push: container kinds copy filtered `members`; symbol
      // kinds copy `signature`. Keeps the CodeElement variant tight — no
      // `members: undefined` leaking onto function/type/typedef.
      const common = {
        id: qualified,
        componentId: owner.componentId,
        containerId: owner.containerId,
        name: re.name,
        qualifiedName: re.qualifiedName,
        language: owner.language,
        visibility: re.visibility,
        tags: re.tags,
      };
      switch (re.kind) {
        case "class":
        case "interface":
        case "enum":
        case "struct": {
          const filteredMembers = !includeMembers
            ? undefined
            : includePrivate
              ? re.members
              : re.members?.filter((m) => m.visibility !== "private");
          elements.push({
            ...common,
            kind: re.kind,
            members: filteredMembers,
          });
          break;
        }
        case "type":
        case "typedef":
        case "function": {
          elements.push({
            ...common,
            kind: re.kind,
            signature: re.signature,
          });
          break;
        }
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
    byContainerNameExcludingOwn: new Map(),
    byComponentQualifiedName: new Map(),
    byContainerQualifiedName: new Map(),
  };
  for (const el of filteredElements) {
    pushIndexed(ctx.byComponentName, `${el.componentId}:${el.name}`, el);
    pushIndexed(ctx.byContainerName, `${el.containerId}:${el.name}`, el);
    if (el.qualifiedName) {
      // FQN keys are unique per element by construction (the FQN includes
      // the package). If two elements collide on FQN we keep the
      // lexicographically-first id for determinism — same tie-breaker as
      // the simple-name path.
      const compKey = `${el.componentId}:${el.qualifiedName}`;
      const existing = ctx.byComponentQualifiedName.get(compKey);
      if (!existing || el.id.localeCompare(existing.id) < 0) {
        ctx.byComponentQualifiedName.set(compKey, el);
      }
      const contKey = `${el.containerId}:${el.qualifiedName}`;
      const existingC = ctx.byContainerQualifiedName.get(contKey);
      if (!existingC || el.id.localeCompare(existingC.id) < 0) {
        ctx.byContainerQualifiedName.set(contKey, el);
      }
    }
  }
  for (const list of ctx.byComponentName.values()) list.sort(byId);
  for (const list of ctx.byContainerName.values()) list.sort(byId);

  // Machine-readable sinks for reference bookkeeping. `droppedReferences`
  // holds refs that produced no edge (stdlib/external or cross-container);
  // `ambiguousResolutions` holds refs where an edge WAS created but the
  // resolver had to pick among >1 candidate. The stderr aggregate messages
  // below are derived from these arrays so callers can introspect reasons
  // without parsing log lines.
  const droppedReferences: DroppedReference[] = [];
  const ambiguousResolutions: AmbiguousResolution[] = [];
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
            (count, where, picked, scope) => {
              ambiguousResolutions.push({
                sourceId: sourceQualified,
                targetRaw: ref.targetName,
                componentId: owner.componentId,
                candidateCount: count,
                pickedId: picked,
                scope,
              });
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
            const reason: DroppedReference["reason"] =
              global &&
              global.some((el) => el.containerId !== owner.containerId)
                ? "cross-container"
                : "stdlib";
            droppedReferences.push({
              sourceId: sourceQualified,
              targetRaw: ref.targetName,
              reason,
              componentId: owner.componentId,
            });
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

  // Derive stderr aggregates from the two sinks in a single pass each — the
  // totals fall out of the bucketing loop, no extra filter() scans needed.
  const stdlibByComponent = new Map<string, number>();
  const crossContainerByComponent = new Map<string, number>();
  const collisionsByComponent = new Map<string, number>();
  let totalStdlib = 0;
  let totalCrossContainer = 0;
  let totalCollisions = 0;
  for (const drop of droppedReferences) {
    if (drop.reason === "stdlib") {
      stdlibByComponent.set(
        drop.componentId,
        (stdlibByComponent.get(drop.componentId) ?? 0) + 1,
      );
      totalStdlib++;
    } else {
      crossContainerByComponent.set(
        drop.componentId,
        (crossContainerByComponent.get(drop.componentId) ?? 0) + 1,
      );
      totalCrossContainer++;
    }
  }
  for (const amb of ambiguousResolutions) {
    collisionsByComponent.set(
      amb.componentId,
      (collisionsByComponent.get(amb.componentId) ?? 0) + 1,
    );
    totalCollisions++;
  }

  if (totalStdlib > 0) {
    process.stderr.write(
      `Warning: L4: ${totalStdlib} code reference(s) dropped as stdlib/external. ` +
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
      `Warning: L4: ${totalCollisions} name-collision pick(s) during resolution. ` +
        `Picks are deterministic (by qualified id).\n`,
    );
  }

  if (process.env.DIAGRAM_DOCS_DEBUG) {
    for (const [compId, count] of stdlibByComponent) {
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
    droppedReferences,
    ambiguousResolutions,
  };
}

function byId(a: CodeElement, b: CodeElement): number {
  return a.id.localeCompare(b.id);
}

// Assigns a unique suffix per raw element in a collision bucket. Prefers the
// qualifiedName slug (unambiguous when the analyzer resolved the FQN), else
// a parent-dir + file-stem slug so same-stem files in different directories
// stay distinct. Residual ties get a numeric counter so the final ids are
// always unique even when both qualifiedName and file path are identical.
function assignDisambiguators(items: RawCodeElement[]): string[] {
  const primary = items.map((re) =>
    re.qualifiedName
      ? slugify(re.qualifiedName)
      : pathStemSlug(re.location.file),
  );
  const seen = new Map<string, number>();
  return primary.map((s) => {
    const count = (seen.get(s) ?? 0) + 1;
    seen.set(s, count);
    return count === 1 ? s : `${s}-${count}`;
  });
}

function pathStemSlug(filePath: string): string {
  const stem = slugify(path.basename(filePath, path.extname(filePath)));
  const parent = slugify(path.basename(path.dirname(filePath)));
  return parent ? `${parent}-${stem}` : stem;
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
  onCollision: (
    count: number,
    where: string,
    pickedId: string,
    scope: "component" | "container",
  ) => void,
): CodeElement | null {
  // FQN-keyed lookups first — these are unambiguous when the analyzer was
  // able to resolve the reference from imports/package context. Skip the
  // collision warning since the package qualifies the type.
  if (ref.targetQualifiedName) {
    const fqnComp = ctx.byComponentQualifiedName.get(
      `${owner.componentId}:${ref.targetQualifiedName}`,
    );
    if (fqnComp) return fqnComp;
    const fqnCont = ctx.byContainerQualifiedName.get(
      `${owner.containerId}:${ref.targetQualifiedName}`,
    );
    if (fqnCont) return fqnCont;
  }

  const sameComp = ctx.byComponentName.get(
    `${owner.componentId}:${ref.targetName}`,
  );
  if (sameComp && sameComp.length > 0) {
    if (sameComp.length > 1) {
      onCollision(
        sameComp.length,
        `component ${owner.componentId}`,
        sameComp[0].id,
        "component",
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
        "container",
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
