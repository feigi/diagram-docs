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

/** Well-known infrastructure dependencies promoted to external systems. */
const KNOWN_EXTERNAL_SYSTEMS: Record<
  string,
  { name: string; technology: string }
> = {
  postgresql: { name: "PostgreSQL", technology: "Database" },
  postgres: { name: "PostgreSQL", technology: "Database" },
  pg: { name: "PostgreSQL", technology: "Database" },
  mysql: { name: "MySQL", technology: "Database" },
  mariadb: { name: "MariaDB", technology: "Database" },
  mongodb: { name: "MongoDB", technology: "Database" },
  redis: { name: "Redis", technology: "Cache" },
  kafka: { name: "Kafka", technology: "Message Broker" },
  rabbitmq: { name: "RabbitMQ", technology: "Message Broker" },
  elasticsearch: { name: "Elasticsearch", technology: "Search Engine" },
  "spring-boot-starter-data-jpa": {
    name: "PostgreSQL",
    technology: "Database",
  },
  sqlite: { name: "SQLite", technology: "Database" },
  dynamodb: { name: "DynamoDB", technology: "Database" },
  "aws-sdk": { name: "AWS", technology: "Cloud Platform" },
  s3: { name: "AWS S3", technology: "Object Storage" },
};

export interface BuildModelOptions {
  config: Config;
  rawStructure: RawStructure;
}

export function buildModel({ config, rawStructure }: BuildModelOptions): ArchitectureModel {
  const apps = rawStructure.applications;
  const granularity = config.abstraction.granularity;
  const excludePatterns = config.abstraction.excludePatterns;

  // Containers: 1:1 with scanned applications
  const containers = apps.map((app) => ({
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
        description: `${displayName} module`,
        technology: inferComponentTechnology(mod, app.language),
        moduleIds: [mod.id],
      };
    });
  });

  // External systems: promoted from known dependencies
  const externalSystems = buildExternalSystems(apps);

  // Relationships
  const relationships = buildRelationships(apps, components, externalSystems);

  return {
    version: 1,
    system: {
      name: config.system.name,
      description: config.system.description,
    },
    actors: [], // User fills these in
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

  // "balanced" — filter by excludePatterns, then collapse to keep diagrams readable
  const MAX_COMPONENTS = 20;

  let filtered = modules.filter(
    (m) =>
      !excludePatterns.some((pat) => m.name.toLowerCase().includes(pat)),
  );

  if (filtered.length <= MAX_COMPONENTS) return filtered;

  // Group by parent path and collapse large sibling groups
  const groups = new Map<string, ScannedModule[]>();
  for (const mod of filtered) {
    const parent = mod.name.includes(".")
      ? mod.name.split(".").slice(0, -1).join(".")
      : mod.name.includes("/")
        ? mod.name.split("/").slice(0, -1).join("/")
        : "";
    const existing = groups.get(parent) ?? [];
    existing.push(mod);
    groups.set(parent, existing);
  }

  // Keep one representative per group when there are too many
  filtered = [];
  for (const [, mods] of groups) {
    if (mods.length > 3) {
      filtered.push(mods[0]); // representative
    } else {
      filtered.push(...mods);
    }
  }

  // If still too many, take top-level groups only (group at a higher level)
  if (filtered.length > MAX_COMPONENTS) {
    const topGroups = new Map<string, ScannedModule[]>();
    for (const mod of filtered) {
      const parts = mod.name.includes(".")
        ? mod.name.split(".")
        : mod.name.split("/");
      const topKey = parts.slice(0, Math.min(parts.length - 1, 3)).join(".");
      const existing = topGroups.get(topKey) ?? [];
      existing.push(mod);
      topGroups.set(topKey, existing);
    }
    filtered = [];
    for (const [, mods] of topGroups) {
      filtered.push(mods[0]);
    }
  }

  return filtered;
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
  const meta = mod.metadata;
  // Spring stereotypes
  if (meta["spring.stereotype"]) {
    const stereo = meta["spring.stereotype"];
    if (stereo === "Controller" || stereo === "RestController")
      return "Spring MVC";
    if (stereo === "Service") return "Spring Service";
    if (stereo === "Repository") return "Spring Data JPA";
    if (stereo === "Component") return "Spring Component";
    if (stereo === "Configuration") return "Spring Configuration";
    if (stereo === "Entity") return "JPA Entity";
  }

  // Framework annotations from metadata
  if (meta["framework"]) return meta["framework"];

  return language.charAt(0).toUpperCase() + language.slice(1);
}

function buildExternalSystems(
  apps: ScannedApplication[],
): ArchitectureModel["externalSystems"] {
  const seen = new Map<string, { name: string; technology: string }>();

  for (const app of apps) {
    for (const dep of app.externalDependencies) {
      const depLower = dep.name.toLowerCase();
      // Check each known system pattern
      for (const [pattern, info] of Object.entries(KNOWN_EXTERNAL_SYSTEMS)) {
        if (depLower.includes(pattern)) {
          // Deduplicate by name (e.g., postgresql and pg both → PostgreSQL)
          if (!seen.has(info.name)) {
            seen.set(info.name, info);
          }
          break;
        }
      }
    }
  }

  return [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, info]) => ({
      id: slugify(info.name),
      name: info.name,
      description: `External ${info.technology.toLowerCase()}`,
      technology: info.technology,
    }));
}

function buildRelationships(
  apps: ScannedApplication[],
  components: ArchitectureModel["components"],
  externalSystems: ArchitectureModel["externalSystems"],
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
            label: "Uses",
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

    // External dependency → container-to-external-system relationships
    for (const dep of app.externalDependencies) {
      const depLower = dep.name.toLowerCase();
      for (const [pattern, info] of Object.entries(KNOWN_EXTERNAL_SYSTEMS)) {
        if (depLower.includes(pattern)) {
          const extId = slugify(info.name);
          if (extIds.has(extId)) {
            const key = `${app.id}->${extId}`;
            if (!seen.has(key)) {
              seen.add(key);
              relationships.push({
                sourceId: app.id,
                targetId: extId,
                label: `Uses ${info.name}`,
                technology: info.technology,
              });
            }
          }
          break;
        }
      }
    }
  }

  return relationships;
}
