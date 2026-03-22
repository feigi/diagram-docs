/**
 * Deterministic mapping: RawStructure → ArchitectureModel.
 * No LLM involved — produces a starting point users can refine.
 */
import type {
  RawStructure,
  ScannedApplication,
  ScannedModule,
  ArchitectureModel,
} from "../analyzers/types.js";
import type { Config } from "../config/schema.js";
import { slugify } from "./slugify.js";
import { humanizeName, lastSegment, inferTechnology } from "./humanize.js";
import { detectRole, detectExternalSystems, inferRelationshipLabel, inferComponentTech, type Role } from "./patterns.js";

export interface BuildModelOptions {
  config: Config;
  rawStructure: RawStructure;
}

export function buildModel({ config, rawStructure }: BuildModelOptions): ArchitectureModel {
  const apps = rawStructure.applications;
  const granularity = config.abstraction.granularity;
  const excludePatterns = config.abstraction.excludePatterns;

  // Skip shell parent apps: apps with 0 modules whose path is a prefix of another app's path.
  // These are build-system root projects (e.g., Gradle multi-module roots) that contain
  // no code of their own — their subprojects are scanned as separate apps.
  const isChildPath = (parent: string, child: string): boolean => {
    if (parent === ".") return child !== ".";
    return child.startsWith(parent + "/");
  };
  const shellParents = new Set(
    apps
      .filter(
        (app) =>
          app.modules.length === 0 &&
          apps.some(
            (other) => other.path !== app.path && isChildPath(app.path, other.path),
          ),
      )
      .map((a) => a.id),
  );

  // Containers: 1:1 with scanned applications, excluding shell parents
  const containers = apps
    .filter((app) => !shellParents.has(app.id))
    .map((app) => ({
      id: app.id,
      applicationId: app.id,
      name: humanizeName(app.name),
      description: `${humanizeName(app.name)} application`,
      technology: inferTechnology(
        app.language,
        app.externalDependencies.map((d) => d.name),
      ),
      path: app.path,
    }));

  // Components: 1:1 per module (filtered by granularity)
  const components = apps.flatMap((app) => {
    const modules = filterModules(app.modules, granularity, excludePatterns);
    if (granularity === "overview") {
      // One component per container
      return modules.length > 0
        ? [
            {
              id: slugify(`${app.id}-core`),
              containerId: app.id,
              name: humanizeName(app.name),
              description: `Core logic of ${humanizeName(app.name)}`,
              technology: inferTechnology(
                app.language,
                app.externalDependencies.map((d) => d.name),
              ),
              moduleIds: modules.map((m) => m.id),
            },
          ]
        : [];
    }

    if (granularity === "balanced") {
      // Group modules into components, preserving all module IDs for relationships
      const groups = groupModulesBalanced(modules);
      return groups.map((group) => ({
        id: group.representative.id,
        containerId: app.id,
        name: group.displayName,
        description: roleDescription(group.displayName, group.representative.metadata["annotations"] ?? ""),
        technology: inferComponentTechnology(group.representative, app.language),
        moduleIds: group.moduleIds,
      }));
    }

    // Detailed mode: 1:1 module-to-component
    // Detect duplicate last-segments to disambiguate names
    const segmentCount = new Map<string, number>();
    for (const mod of modules) {
      const seg = lastSegment(mod.name);
      segmentCount.set(seg, (segmentCount.get(seg) ?? 0) + 1);
    }

    return modules.map((mod) => {
      const seg = lastSegment(mod.name);
      const needsDisambiguation = (segmentCount.get(seg) ?? 0) > 1;
      // Use the module's unique ID as component ID (already globally unique)
      // For display name, add parent context when ambiguous
      const displayName = needsDisambiguation
        ? disambiguatedName(mod.name)
        : humanizeName(seg);
      return {
        id: mod.id,
        containerId: app.id,
        name: displayName,
        description: roleDescription(displayName, mod.metadata["annotations"] ?? ""),
        technology: inferComponentTechnology(mod, app.language),
        moduleIds: [mod.id],
      };
    });
  });

  // External systems: merge config-declared with auto-detected from deps
  const configExternalSystems = buildExternalSystems(config.externalSystems);
  const detectedExternalSystems = detectExternalSystemsFromApps(apps);
  const externalSystems = mergeExternalSystems(configExternalSystems, detectedExternalSystems);

  // Relationships
  const relationships = buildRelationships(apps, components, externalSystems, config.externalSystems);

  return {
    version: 1,
    system: {
      name: config.system.name,
      description: config.system.description,
    },
    actors: inferActors(apps),
    externalSystems,
    containers,
    components,
    relationships,
  };
}

function filterModules(
  modules: ScannedModule[],
  granularity: string,
  excludePatterns: string[],
): ScannedModule[] {
  if (granularity === "detailed") return modules;

  if (granularity === "overview") return modules; // We'll collapse in the caller

  // "balanced" — filter by excludePatterns only; grouping handled by groupModulesBalanced
  return modules.filter(
    (m) =>
      !excludePatterns.some((pat) => m.name.toLowerCase().includes(pat)),
  );
}

interface ModuleGroup {
  representative: ScannedModule;
  moduleIds: string[];
  displayName: string;
}

const MAX_COMPONENTS = 20;

/**
 * Group modules into ≤ MAX_COMPONENTS groups for balanced component diagrams.
 * Uses common-prefix-aware grouping so deeply-nested Java packages
 * (e.g., com.bmw.los.next.charging.*) produce meaningful groups
 * instead of collapsing to a single component.
 */
function groupModulesBalanced(modules: ScannedModule[]): ModuleGroup[] {
  if (modules.length === 0) return [];

  if (modules.length <= MAX_COMPONENTS) {
    return modules.map((m) => {
      const seg = lastSegment(m.name);
      return {
        representative: m,
        moduleIds: [m.id],
        displayName: humanizeName(seg),
      };
    });
  }

  const getNameParts = (name: string): string[] =>
    name.includes(".") ? name.split(".") : name.split("/");

  const allParts = modules.map((m) => getNameParts(m.name));
  const prefixLen = commonPrefixLength(allParts);
  const maxDepth = Math.max(...allParts.map((p) => p.length));

  // Find the deepest grouping depth that produces ≤ MAX_COMPONENTS groups
  let bestDepth = prefixLen + 1;
  for (let depth = prefixLen + 1; depth <= maxDepth; depth++) {
    const keys = new Set<string>();
    for (const mod of modules) {
      const parts = getNameParts(mod.name);
      keys.add(parts.slice(0, Math.min(parts.length, depth)).join("."));
    }
    if (keys.size <= MAX_COMPONENTS) {
      bestDepth = depth;
    } else {
      break;
    }
  }

  // Build groups at the chosen depth
  const grouped = new Map<string, ScannedModule[]>();
  for (const mod of modules) {
    const parts = getNameParts(mod.name);
    const key = parts.slice(0, Math.min(parts.length, bestDepth)).join(".");
    const existing = grouped.get(key) ?? [];
    existing.push(mod);
    grouped.set(key, existing);
  }

  // Detect duplicate group display names for disambiguation
  const groupEntries = [...grouped.entries()];
  const nameCount = new Map<string, number>();
  for (const [key] of groupEntries) {
    const seg = lastSegment(key);
    nameCount.set(seg, (nameCount.get(seg) ?? 0) + 1);
  }

  return groupEntries.map(([key, mods]) => {
    const seg = lastSegment(key);
    const needsDisambiguation = (nameCount.get(seg) ?? 0) > 1;
    const displayName = needsDisambiguation
      ? disambiguatedName(key)
      : humanizeName(seg);
    return {
      representative: mods[0],
      moduleIds: mods.map((m) => m.id),
      displayName,
    };
  });
}

/** Find the number of leading segments shared by all part arrays. */
function commonPrefixLength(partArrays: string[][]): number {
  if (partArrays.length === 0) return 0;
  const first = partArrays[0];
  let len = 0;
  for (let i = 0; i < first.length; i++) {
    for (const parts of partArrays) {
      if (i >= parts.length || parts[i] !== first[i]) return len;
    }
    len++;
  }
  return len;
}

/**
 * Build a display name using the last two segments for disambiguation.
 * "com.bmw.los.next.charging.availability" → "Charging Availability"
 */
function disambiguatedName(moduleName: string): string {
  const parts = moduleName.includes(".")
    ? moduleName.split(".")
    : moduleName.includes("/")
      ? moduleName.split("/")
      : [moduleName];

  const significant = parts.slice(-2);
  return significant.map((p) => humanizeName(p)).join(" ");
}

function inferComponentTechnology(
  mod: ScannedModule,
  language: string,
): string {
  const annotations = mod.metadata["annotations"] ?? "";
  if (annotations) {
    return inferComponentTech(annotations, language);
  }
  if (mod.metadata["framework"]) return mod.metadata["framework"];
  return language.charAt(0).toUpperCase() + language.slice(1);
}

function buildExternalSystems(
  configEntries: Config["externalSystems"],
): ArchitectureModel["externalSystems"] {
  return configEntries
    .map((entry) => ({
      id: slugify(entry.name),
      name: entry.name,
      description: `External ${(entry.technology ?? "system").toLowerCase()}`,
      technology: entry.technology ?? "External System",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Infer actors from scanned applications by looking for controller/listener roles.
 * - Any controller → API Consumer actor
 * - Any listener → Upstream System actor
 * Deduplicates: one actor per type regardless of how many apps have controllers/listeners.
 */
function inferActors(apps: ScannedApplication[]): ArchitectureModel["actors"] {
  let hasController = false;
  let hasListener = false;

  for (const app of apps) {
    for (const mod of app.modules) {
      const annotations = mod.metadata["annotations"] ?? "";
      const role = detectRole(annotations);
      if (role === "controller") hasController = true;
      if (role === "listener") hasListener = true;
      if (hasController && hasListener) break;
    }
    if (hasController && hasListener) break;
  }

  const actors: ArchitectureModel["actors"] = [];
  if (hasController) {
    actors.push({
      id: "api-consumer",
      name: "API Consumer",
      description: "External client that consumes the system's APIs",
    });
  }
  if (hasListener) {
    actors.push({
      id: "upstream-system",
      name: "Upstream System",
      description: "External system that produces messages consumed by the system",
    });
  }
  return actors;
}

/**
 * Detect external systems from dependency names across all apps.
 * Maps detected systems to ArchitectureModel format.
 */
function detectExternalSystemsFromApps(
  apps: ScannedApplication[],
): ArchitectureModel["externalSystems"] {
  const allDepNames = apps.flatMap((app) => app.externalDependencies.map((d) => d.name));
  const detected = detectExternalSystems(allDepNames);
  return detected.map((d) => ({
    id: slugify(d.technology),
    name: d.technology,
    description: `${d.type} used by the system`,
    technology: d.type,
  }));
}

/**
 * Merge config-declared external systems with auto-detected ones.
 * Config-declared entries take precedence (keyed by id).
 * Detected systems fill in what config doesn't declare.
 * Result is sorted by name.
 */
function mergeExternalSystems(
  configSystems: ArchitectureModel["externalSystems"],
  detectedSystems: ArchitectureModel["externalSystems"],
): ArchitectureModel["externalSystems"] {
  const configIds = new Set(configSystems.map((s) => s.id));
  const merged = [
    ...configSystems,
    ...detectedSystems.filter((s) => !configIds.has(s.id)),
  ];
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Produce a role-informed description for a component.
 * Matches annotations to known roles and returns a descriptive string.
 */
function roleDescription(displayName: string, annotations: string): string {
  const role = detectRole(annotations);
  switch (role) {
    case "controller":
      return `REST API controller for ${displayName}`;
    case "service":
      return `Business logic service for ${displayName}`;
    case "repository":
      return `Data access layer for ${displayName}`;
    case "listener":
      return `Message listener for ${displayName}`;
    default:
      return `${displayName} module`;
  }
}

function buildRelationships(
  apps: ScannedApplication[],
  components: ArchitectureModel["components"],
  externalSystems: ArchitectureModel["externalSystems"],
  configEntries: Config["externalSystems"],
): ArchitectureModel["relationships"] {
  const relationships: ArchitectureModel["relationships"] = [];
  const seen = new Set<string>();

  const appIds = new Set(apps.map((a) => a.id));
  const extIds = new Set(externalSystems.map((e) => e.id));
  const componentByModule = new Map<string, string>();
  for (const comp of components) {
    for (const modId of comp.moduleIds) {
      componentByModule.set(modId, comp.id);
    }
  }

  // Build a global lookup from module name → module ID across all apps
  const moduleNameToId = new Map<string, string>();
  for (const app of apps) {
    for (const m of app.modules) {
      moduleNameToId.set(m.name, m.id);
    }
  }

  // Build module → role lookup
  const moduleRole = new Map<string, Role | undefined>();
  for (const app of apps) {
    for (const m of app.modules) {
      moduleRole.set(m.id, detectRole(m.metadata["annotations"] ?? ""));
    }
  }

  // Build component → role lookup (use first module with a role)
  const componentRole = new Map<string, Role | undefined>();
  for (const comp of components) {
    for (const modId of comp.moduleIds) {
      const role = moduleRole.get(modId);
      if (role) {
        componentRole.set(comp.id, role);
        break;
      }
    }
  }

  // Map component ID → container ID for promoting cross-container relationships
  const componentToContainer = new Map<string, string>();
  for (const comp of components) {
    componentToContainer.set(comp.id, comp.containerId);
  }

  for (const app of apps) {
    // Cross-app imports → container-level relationships
    for (const imp of app.internalImports) {
      if (appIds.has(imp.targetApplicationId)) {
        const key = `${app.id}->${imp.targetApplicationId}`;
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({
            sourceId: app.id,
            targetId: imp.targetApplicationId,
            label: "Uses",
          });
        }
      }
    }

    // Module imports → component-level relationships
    for (const mod of app.modules) {
      const sourceComp = componentByModule.get(mod.id);
      if (!sourceComp) continue;

      for (const imp of mod.imports) {
        if (imp.isExternal) continue;

        // Try explicit resolution first, then fall back to package-name matching
        let targetModId = imp.resolved;
        if (!targetModId) {
          // Match import source (e.g. "com.example.user.UserService")
          // against module names (e.g. "com.example.user") by prefix
          const importPkg = imp.source.includes(".")
            ? imp.source.split(".").slice(0, -1).join(".")
            : imp.source;
          targetModId = moduleNameToId.get(importPkg);
        }
        if (!targetModId) continue;

        const targetComp = componentByModule.get(targetModId);
        if (!targetComp || targetComp === sourceComp) continue;

        // Emit component-level relationship
        const key = `${sourceComp}->${targetComp}`;
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({
            sourceId: sourceComp,
            targetId: targetComp,
            label: inferRelationshipLabel(
              componentRole.get(sourceComp),
              componentRole.get(targetComp),
            ),
          });
        }

        // Promote to container-level relationship if cross-container
        const srcContainer = componentToContainer.get(sourceComp);
        const tgtContainer = componentToContainer.get(targetComp);
        if (srcContainer && tgtContainer && srcContainer !== tgtContainer) {
          const containerKey = `${srcContainer}->${tgtContainer}`;
          if (!seen.has(containerKey)) {
            seen.add(containerKey);
            relationships.push({
              sourceId: srcContainer,
              targetId: tgtContainer,
              label: "Uses",
            });
          }
        }
      }
    }

  }

  // Config-driven external system relationships (from usedBy)
  for (const entry of configEntries) {
    if (!entry.usedBy) continue;
    const extId = slugify(entry.name);
    if (!extIds.has(extId)) continue;
    for (const containerId of entry.usedBy) {
      const key = `${containerId}->${extId}`;
      if (!seen.has(key)) {
        seen.add(key);
        relationships.push({
          sourceId: containerId,
          targetId: extId,
          label: `Uses ${entry.name}`,
          technology: entry.technology,
        });
      }
    }
  }

  return relationships;
}
