# LLM Pipeline Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce LLM modeling time from ~12 min to ~3-4 min for multi-app monorepos by enhancing the deterministic seed and parallelizing per-app LLM calls.

**Architecture:** Two-phase approach. Phase 1 creates a pattern registry for framework-agnostic role/dependency detection and uses it to produce a richer deterministic seed (actors, external systems, better labels). Phase 2 splits the single monolithic LLM call into N concurrent per-app calls plus a lightweight synthesis pass, merging results with deterministic cross-app relationships.

**Tech Stack:** TypeScript, vitest, Node.js child_process (existing spawn helpers)

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/core/patterns.ts` | Data-driven registry of role patterns (annotation → architectural role) and external system patterns (dependency keyword → system type). Pure functions, no side effects. |
| `src/core/parallel-model-builder.ts` | Orchestrates parallel per-app LLM calls: split RawStructure, dispatch with concurrency limit, merge partial models, run synthesis pass. |
| `tests/core/patterns.test.ts` | Tests for pattern matching functions |
| `tests/core/parallel-model-builder.test.ts` | Tests for split, merge, dedup, and orchestration logic |

### Modified Files
| File | Changes |
|---|---|
| `src/core/model-builder.ts` | Use pattern registry for actors, external systems, relationship labels, descriptions. Consolidate `inferComponentTechnology()` into pattern registry. |
| `src/core/llm-model-builder.ts` | Add per-app and synthesis prompt builders. Gate parallel path in `buildModelWithLLM()` for multi-app seed mode. Export `LLMProvider` interface and provider instances for reuse. |
| `src/config/schema.ts` | Add `llm.concurrency` option (default 4). |
| `tests/core/model-builder.test.ts` | Add tests for new actor inference, external system detection, and relationship labels. |

---

## Phase 1: Smarter Deterministic Seed

### Task 1: Pattern Registry

**Files:**
- Create: `src/core/patterns.ts`
- Create: `tests/core/patterns.test.ts`

- [ ] **Step 1: Write failing tests for role pattern matching**

```ts
// tests/core/patterns.test.ts
import { describe, it, expect } from "vitest";
import { detectRole, detectExternalSystems } from "../../src/core/patterns.js";

describe("detectRole", () => {
  it("detects controller role from Controller annotation", () => {
    expect(detectRole("Controller,RequestMapping")).toBe("controller");
  });

  it("detects controller role from RestController", () => {
    expect(detectRole("RestController")).toBe("controller");
  });

  it("detects controller role from Handler", () => {
    expect(detectRole("Handler")).toBe("controller");
  });

  it("detects controller role from Route", () => {
    expect(detectRole("Route")).toBe("controller");
  });

  it("detects controller role from Resource", () => {
    expect(detectRole("Resource")).toBe("controller");
  });

  it("detects controller role from Endpoint", () => {
    expect(detectRole("Endpoint")).toBe("controller");
  });

  it("detects listener role from Listener", () => {
    expect(detectRole("KafkaListener")).toBe("listener");
  });

  it("detects listener role from Consumer", () => {
    expect(detectRole("Consumer")).toBe("listener");
  });

  it("detects listener role from Subscriber", () => {
    expect(detectRole("Subscriber")).toBe("listener");
  });

  it("detects repository role from Repository", () => {
    expect(detectRole("Repository")).toBe("repository");
  });

  it("detects repository role from Dao", () => {
    expect(detectRole("Dao")).toBe("repository");
  });

  it("detects service role", () => {
    expect(detectRole("Service")).toBe("service");
  });

  it("returns undefined for unknown annotations", () => {
    expect(detectRole("Entity")).toBeUndefined();
    expect(detectRole("")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(detectRole("controller")).toBe("controller");
    expect(detectRole("RESTCONTROLLER")).toBe("controller");
  });
});

describe("detectExternalSystems", () => {
  it("detects PostgreSQL from dependency name", () => {
    const result = detectExternalSystems(["org.postgresql:postgresql", "spring-boot-starter-web"]);
    expect(result).toContainEqual({
      keyword: "postgresql",
      type: "Database",
      technology: "PostgreSQL",
    });
  });

  it("detects Kafka from dependency name", () => {
    const result = detectExternalSystems(["spring-kafka"]);
    expect(result).toContainEqual({
      keyword: "kafka",
      type: "Message Broker",
      technology: "Apache Kafka",
    });
  });

  it("detects Redis from dependency name", () => {
    const result = detectExternalSystems(["jedis"]);
    expect(result).toContainEqual(expect.objectContaining({ type: "Cache", technology: "Redis" }));
  });

  it("detects multiple systems from mixed dependencies", () => {
    const result = detectExternalSystems(["postgresql", "spring-kafka", "lettuce"]);
    expect(result).toHaveLength(3);
  });

  it("deduplicates by type+technology", () => {
    const result = detectExternalSystems(["jedis", "lettuce", "spring-data-redis"]);
    const redisEntries = result.filter((r) => r.technology === "Redis");
    expect(redisEntries).toHaveLength(1);
  });

  it("returns empty array for no matches", () => {
    expect(detectExternalSystems(["spring-boot-starter-web"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/patterns.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pattern registry**

```ts
// src/core/patterns.ts

/**
 * Framework-agnostic pattern registry for detecting architectural roles
 * and external systems from code metadata.
 */

export type Role = "controller" | "listener" | "repository" | "service";

interface RolePattern {
  /** Substrings to match against annotation names (case-insensitive). */
  keywords: string[];
  role: Role;
}

const ROLE_PATTERNS: RolePattern[] = [
  { keywords: ["controller", "restcontroller", "resource", "endpoint", "route", "handler"], role: "controller" },
  { keywords: ["listener", "consumer", "subscriber"], role: "listener" },
  { keywords: ["repository", "dao"], role: "repository" },
  { keywords: ["service"], role: "service" },
];

/**
 * Detect the architectural role of a module from its comma-separated annotation string.
 * Returns the first matching role, or undefined if no match.
 */
export function detectRole(annotations: string): Role | undefined {
  if (!annotations) return undefined;
  const parts = annotations.split(",").map((a) => a.trim().toLowerCase());
  for (const pattern of ROLE_PATTERNS) {
    for (const part of parts) {
      if (pattern.keywords.some((kw) => part.includes(kw))) {
        return pattern.role;
      }
    }
  }
  return undefined;
}

export interface DetectedExternalSystem {
  keyword: string;
  type: string;
  technology: string;
}

interface ExternalSystemPattern {
  keywords: string[];
  type: string;
  technology: string;
}

const EXTERNAL_SYSTEM_PATTERNS: ExternalSystemPattern[] = [
  { keywords: ["postgresql"], type: "Database", technology: "PostgreSQL" },
  { keywords: ["mysql"], type: "Database", technology: "MySQL" },
  { keywords: ["oracle"], type: "Database", technology: "Oracle" },
  { keywords: ["sqlite"], type: "Database", technology: "SQLite" },
  { keywords: ["h2"], type: "Database", technology: "H2" },
  { keywords: ["kafka"], type: "Message Broker", technology: "Apache Kafka" },
  { keywords: ["rabbitmq", "amqp"], type: "Message Broker", technology: "RabbitMQ" },
  { keywords: ["redis", "jedis", "lettuce"], type: "Cache", technology: "Redis" },
  { keywords: ["memcached"], type: "Cache", technology: "Memcached" },
  { keywords: ["elasticsearch"], type: "Search Engine", technology: "Elasticsearch" },
  { keywords: ["opensearch"], type: "Search Engine", technology: "OpenSearch" },
  { keywords: ["s3", "minio"], type: "Object Storage", technology: "S3" },
];

/**
 * Detect external systems from an array of dependency names.
 * Returns deduplicated matches (one per type+technology combination).
 */
export function detectExternalSystems(depNames: string[]): DetectedExternalSystem[] {
  const seen = new Set<string>();
  const results: DetectedExternalSystem[] = [];
  const depsLower = depNames.map((d) => d.toLowerCase());

  for (const pattern of EXTERNAL_SYSTEM_PATTERNS) {
    const key = `${pattern.type}:${pattern.technology}`;
    if (seen.has(key)) continue;
    for (const dep of depsLower) {
      if (pattern.keywords.some((kw) => dep.includes(kw))) {
        seen.add(key);
        results.push({
          keyword: pattern.keywords.find((kw) => dep.includes(kw))!,
          type: pattern.type,
          technology: pattern.technology,
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Infer a relationship label based on source and target roles.
 */
export function inferRelationshipLabel(
  sourceRole: Role | undefined,
  targetRole: Role | undefined,
): string {
  if (sourceRole === "controller") return "Delegates to";
  if (targetRole === "repository") return "Persists via";
  return "Uses";
}

/**
 * Infer a relationship label for a connection to an external system.
 */
export function inferExternalRelationshipLabel(systemType: string): string {
  switch (systemType) {
    case "Database": return "Reads/writes data in";
    case "Message Broker": return "Publishes to";
    case "Cache": return "Caches data in";
    case "Search Engine": return "Queries";
    case "Object Storage": return "Stores files in";
    default: return "Uses";
  }
}

/**
 * Infer component technology from annotations using the pattern registry.
 * Falls back to language name if no annotation match.
 * Framework-agnostic: maps roles to generic technology labels.
 */
export function inferComponentTech(annotations: string, language: string): string {
  const role = detectRole(annotations);
  if (role === "controller") return `${capitalize(language)} REST Controller`;
  if (role === "repository") return `${capitalize(language)} Repository`;
  if (role === "service") return `${capitalize(language)} Service`;
  if (role === "listener") return `${capitalize(language)} Message Listener`;

  // Check for specific annotations not covered by roles
  const parts = annotations.split(",").map((a) => a.trim().toLowerCase());
  if (parts.includes("entity")) return "JPA Entity";
  if (parts.includes("configuration") || parts.includes("config")) return `${capitalize(language)} Configuration`;
  if (parts.includes("component")) return `${capitalize(language)} Component`;

  return capitalize(language);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/patterns.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/patterns.ts tests/core/patterns.test.ts
git commit -m "feat: add framework-agnostic pattern registry for role and external system detection"
```

---

### Task 2: Enhanced Deterministic Seed — Actors & External Systems

**Files:**
- Modify: `src/core/model-builder.ts:20-138` (the `buildModel` function)
- Modify: `tests/core/model-builder.test.ts`

- [ ] **Step 1: Write failing tests for actor inference**

Add to `tests/core/model-builder.test.ts`:

```ts
it("infers API consumer actor from controller annotations", () => {
  const config = makeConfig();
  const raw = makeRawStructure([
    {
      id: "app",
      path: "app",
      name: "app",
      language: "java",
      buildFile: "pom.xml",
      modules: [
        {
          id: "app-controller",
          path: "controller",
          name: "controller",
          files: [],
          exports: [],
          imports: [],
          metadata: { annotations: "RestController" },
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  expect(model.actors).toContainEqual(
    expect.objectContaining({ name: "API Consumer" }),
  );
});

it("infers upstream system actor from listener annotations", () => {
  const config = makeConfig();
  const raw = makeRawStructure([
    {
      id: "app",
      path: "app",
      name: "app",
      language: "java",
      buildFile: "pom.xml",
      modules: [
        {
          id: "app-listener",
          path: "listener",
          name: "listener",
          files: [],
          exports: [],
          imports: [],
          metadata: { annotations: "KafkaListener" },
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  expect(model.actors).toContainEqual(
    expect.objectContaining({ name: "Upstream System" }),
  );
});

it("deduplicates actors across multiple apps", () => {
  const config = makeConfig();
  const raw = makeRawStructure([
    {
      id: "app-a",
      path: "a",
      name: "a",
      language: "java",
      buildFile: "pom.xml",
      modules: [
        { id: "a-ctrl", path: "ctrl", name: "ctrl", files: [], exports: [], imports: [], metadata: { annotations: "Controller" } },
      ],
      externalDependencies: [],
      internalImports: [],
    },
    {
      id: "app-b",
      path: "b",
      name: "b",
      language: "java",
      buildFile: "pom.xml",
      modules: [
        { id: "b-ctrl", path: "ctrl", name: "ctrl", files: [], exports: [], imports: [], metadata: { annotations: "RestController" } },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  const apiActors = model.actors.filter((a) => a.id === "api-consumer");
  expect(apiActors).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/model-builder.test.ts`
Expected: FAIL — actors is still `[]`

- [ ] **Step 3: Write failing test for external system detection from dependencies**

Add to `tests/core/model-builder.test.ts`:

```ts
it("detects external systems from dependency names", () => {
  const config = makeConfig();
  const raw = makeRawStructure([
    {
      id: "app",
      path: "app",
      name: "app",
      language: "java",
      buildFile: "pom.xml",
      modules: [],
      externalDependencies: [{ name: "org.postgresql:postgresql" }, { name: "spring-kafka" }],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  expect(model.externalSystems).toContainEqual(
    expect.objectContaining({ technology: "PostgreSQL" }),
  );
  expect(model.externalSystems).toContainEqual(
    expect.objectContaining({ technology: "Apache Kafka" }),
  );
});

it("merges config-declared and detected external systems without duplicates", () => {
  const config = makeConfig({
    externalSystems: [{ name: "PostgreSQL", technology: "Database" }],
  });
  const raw = makeRawStructure([
    {
      id: "app",
      path: "app",
      name: "app",
      language: "java",
      buildFile: "pom.xml",
      modules: [],
      externalDependencies: [{ name: "postgresql" }],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  const pgSystems = model.externalSystems.filter((e) => e.id === "postgresql");
  expect(pgSystems).toHaveLength(1);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/core/model-builder.test.ts`
Expected: FAIL — external systems still empty without config

- [ ] **Step 5: Implement actor inference and external system detection in `buildModel`**

In `src/core/model-builder.ts`, add import and modify the `buildModel` function:

```ts
// Add to imports at top (slugify is already imported):
import { detectRole, detectExternalSystems } from "./patterns.js";

// Replace line 121-138 (from `const externalSystems` through `return {`):

  // External systems: merge config-declared with dependency-detected
  const configExternalSystems = buildExternalSystems(config.externalSystems);
  const detectedExternalSystems = detectExternalSystemsFromApps(apps);
  const externalSystems = mergeExternalSystems(configExternalSystems, detectedExternalSystems);

  // Actors: infer from module annotations
  const actors = inferActors(apps);

  // Relationships
  const relationships = buildRelationships(apps, components, externalSystems, config.externalSystems);

  return {
    version: 1,
    system: {
      name: config.system.name,
      description: config.system.description,
    },
    actors,
    externalSystems,
    containers,
    components,
    relationships,
  };
```

Add these new helper functions at the bottom of the file:

```ts
function detectExternalSystemsFromApps(
  apps: ScannedApplication[],
): ArchitectureModel["externalSystems"] {
  const allDeps = apps.flatMap((app) => app.externalDependencies.map((d) => d.name));
  const detected = detectExternalSystems(allDeps);
  return detected.map((d) => ({
    id: slugify(d.technology),
    name: d.technology,
    description: `${d.type} used by the system`,
    technology: d.type,
  }));
}

function mergeExternalSystems(
  configSystems: ArchitectureModel["externalSystems"],
  detectedSystems: ArchitectureModel["externalSystems"],
): ArchitectureModel["externalSystems"] {
  const byId = new Map(configSystems.map((s) => [s.id, s]));
  for (const detected of detectedSystems) {
    if (!byId.has(detected.id)) {
      byId.set(detected.id, detected);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function inferActors(apps: ScannedApplication[]): ArchitectureModel["actors"] {
  let hasController = false;
  let hasListener = false;

  for (const app of apps) {
    for (const mod of app.modules) {
      const role = detectRole(mod.metadata["annotations"] ?? "");
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
```

- [ ] **Step 6: Enhance component descriptions to be role-informed**

Also update the description generation in `buildModel` to use detected roles. Replace the generic `"${displayName} module"` patterns (lines 88 and 114) with role-aware descriptions:

```ts
// Add helper function:
function roleDescription(displayName: string, annotations: string): string {
  const role = detectRole(annotations);
  switch (role) {
    case "controller": return `REST API controller for ${displayName.toLowerCase()}`;
    case "service": return `Business logic service for ${displayName.toLowerCase()}`;
    case "repository": return `Data access layer for ${displayName.toLowerCase()}`;
    case "listener": return `Message listener for ${displayName.toLowerCase()}`;
    default: return `${displayName} module`;
  }
}

// In the balanced mode component generation (line 88), replace:
//   description: `${group.displayName} module`,
// With:
//   description: roleDescription(group.displayName, group.representative.metadata["annotations"] ?? ""),

// In the detailed mode component generation (line 114), replace:
//   description: `${displayName} module`,
// With:
//   description: roleDescription(displayName, mod.metadata["annotations"] ?? ""),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/core/model-builder.test.ts`
Expected: PASS (all existing + new tests)

- [ ] **Step 8: Commit**

```bash
git add src/core/model-builder.ts tests/core/model-builder.test.ts
git commit -m "feat: infer actors, external systems, and role-informed descriptions in deterministic seed"
```

---

### Task 3: Enhanced Deterministic Seed — Relationship Labels & Component Technology

**Files:**
- Modify: `src/core/model-builder.ts:268-424` (inferComponentTechnology, buildRelationships)
- Modify: `tests/core/model-builder.test.ts`

- [ ] **Step 1: Write failing test for role-aware relationship labels**

Add to `tests/core/model-builder.test.ts`:

```ts
it("labels controller-to-service relationships as 'Delegates to'", () => {
  const config = makeConfig({ abstraction: { granularity: "detailed" } });
  const raw = makeRawStructure([
    {
      id: "app",
      path: "app",
      name: "app",
      language: "java",
      buildFile: "pom.xml",
      modules: [
        {
          id: "app-ctrl",
          path: "ctrl",
          name: "ctrl",
          files: [],
          exports: [],
          imports: [{ source: "svc", resolved: "app-svc", isExternal: false }],
          metadata: { annotations: "RestController" },
        },
        {
          id: "app-svc",
          path: "svc",
          name: "svc",
          files: [],
          exports: [],
          imports: [],
          metadata: { annotations: "Service" },
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  expect(model.relationships).toContainEqual(
    expect.objectContaining({
      sourceId: "app-ctrl",
      targetId: "app-svc",
      label: "Delegates to",
    }),
  );
});

it("labels relationships to repository as 'Persists via'", () => {
  const config = makeConfig({ abstraction: { granularity: "detailed" } });
  const raw = makeRawStructure([
    {
      id: "app",
      path: "app",
      name: "app",
      language: "java",
      buildFile: "pom.xml",
      modules: [
        {
          id: "app-svc",
          path: "svc",
          name: "svc",
          files: [],
          exports: [],
          imports: [{ source: "repo", resolved: "app-repo", isExternal: false }],
          metadata: { annotations: "Service" },
        },
        {
          id: "app-repo",
          path: "repo",
          name: "repo",
          files: [],
          exports: [],
          imports: [],
          metadata: { annotations: "Repository" },
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ]);
  const model = buildModel({ config, rawStructure: raw });

  expect(model.relationships).toContainEqual(
    expect.objectContaining({
      sourceId: "app-svc",
      targetId: "app-repo",
      label: "Persists via",
    }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/model-builder.test.ts`
Expected: FAIL — labels are still "Uses"

- [ ] **Step 3: Implement role-aware relationship labels**

In `src/core/model-builder.ts`, modify `buildRelationships` to use pattern-based labels. Add import of `inferRelationshipLabel` from patterns, and build a module-to-role lookup:

```ts
// Update the existing patterns import to include inferRelationshipLabel and Role type:
import { detectRole, detectExternalSystems, inferRelationshipLabel, type Role } from "./patterns.js";

// In buildRelationships, after the moduleNameToId map (line ~327), add:
  const moduleRole = new Map<string, Role | undefined>();
  for (const app of apps) {
    for (const m of app.modules) {
      moduleRole.set(m.id, detectRole(m.metadata["annotations"] ?? ""));
    }
  }

  // Build component role lookup (use representative module's role)
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
```

Then replace the hardcoded `"Uses"` labels in the component relationship section (line ~382):

```ts
          // Replace: label: "Uses",
          // With:
          label: inferRelationshipLabel(
            componentRole.get(sourceComp),
            componentRole.get(targetComp),
          ),
```

- [ ] **Step 4: Consolidate inferComponentTechnology to use pattern registry**

Replace `inferComponentTechnology` (lines 268-288) in `src/core/model-builder.ts` with:

```ts
import { inferComponentTech } from "./patterns.js";

// Replace the inferComponentTechnology function body:
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
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run tests/core/model-builder.test.ts`
Expected: PASS. Note: the existing test at line 98 expects `"Spring MVC"` for Controller — `inferComponentTech` returns `"Java REST Controller"` instead. Update that test expectation:

```ts
// Line 98: change from "Spring MVC" to "Java REST Controller"
// Line 100: change from "Spring Data JPA" to "Java Repository"
```

- [ ] **Step 6: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/model-builder.ts tests/core/model-builder.test.ts
git commit -m "feat: role-aware relationship labels and framework-agnostic component technology"
```

---

### Task 4: Add `llm.concurrency` Config Option

**Files:**
- Modify: `src/config/schema.ts:66-73`

- [ ] **Step 1: Add concurrency to llm config schema**

In `src/config/schema.ts`, modify the `llm` section:

```ts
  llm: z
    .object({
      provider: z
        .enum(["auto", "claude-code", "copilot"])
        .default("auto"),
      model: z.string().default("sonnet"),
      concurrency: z.number().int().min(1).max(16).default(4),
    })
    .default({}),
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS — no code reads `concurrency` yet, so this is a safe additive change.

- [ ] **Step 3: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat: add llm.concurrency config option (default 4)"
```

---

## Phase 2: Parallel Per-App LLM Calls

### Task 5: Export Provider Interface and Helpers from llm-model-builder

**Files:**
- Modify: `src/core/llm-model-builder.ts`

- [ ] **Step 1: Export the LLMProvider interface and provider resolution**

In `src/core/llm-model-builder.ts`:

1. Export the `LLMProvider` interface (line 380): change `interface LLMProvider` to `export interface LLMProvider`
2. Export `buildSystemPrompt` (line 484): change `function buildSystemPrompt` to `export function buildSystemPrompt`
3. Export `buildUserMessage` (already exported at line 618).
4. Add and export a provider resolution function:

```ts
export function resolveProvider(config: Config): LLMProvider {
  const configuredProvider = config.llm.provider;
  let provider: LLMProvider | undefined;

  if (configuredProvider === "auto") {
    provider = providers.find((p) => p.isAvailable());
  } else {
    const providerMap: Record<string, LLMProvider> = {
      "claude-code": claudeCodeProvider,
      copilot: copilotProvider,
    };
    provider = providerMap[configuredProvider];
    if (provider && !provider.isAvailable()) {
      throw new LLMUnavailableError(
        `Configured LLM provider "${configuredProvider}" is not available.\n` +
          `Ensure the CLI is installed and authenticated.`,
      );
    }
  }

  if (!provider) {
    throw new LLMUnavailableError(
      "No LLM provider found.\n\n" +
        "To generate a high-quality architecture model, install one of:\n" +
        "  - Claude Code CLI:    https://claude.ai/download\n" +
        "  - GitHub Copilot CLI: gh extension install github/gh-copilot\n\n" +
        "Or use the deterministic builder:\n" +
        "  diagram-docs generate --deterministic",
    );
  }

  return provider;
}
```

- [ ] **Step 2: Refactor `buildModelWithLLM` to use `resolveProvider`**

Replace lines 766-797 in `buildModelWithLLM` with a call to `resolveProvider(options.config)`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS — behavioral equivalence, just refactored.

- [ ] **Step 4: Commit**

```bash
git add src/core/llm-model-builder.ts
git commit -m "refactor: export LLMProvider interface and provider resolution for reuse"
```

---

### Task 6: Per-App and Synthesis Prompts

**Files:**
- Modify: `src/core/llm-model-builder.ts`

- [ ] **Step 1: Add per-app system prompt builder**

Add to `src/core/llm-model-builder.ts` after `buildSystemPrompt`:

```ts
export function buildPerAppSystemPrompt(outputPath?: string): string {
  const base = buildSystemPrompt(outputPath);
  return base + `

### Single-App Mode
You are modeling a SINGLE APPLICATION within a larger multi-app system.
- Focus only on this application's internal architecture.
- Do NOT produce cross-container relationships. These are handled separately.
- The internalImports field is provided for context only (to inform descriptions). Do not create relationships from it.
- Produce: containers (just this one), components, intra-app relationships, actors, externalSystems relevant to this app.`;
}
```

- [ ] **Step 2: Add per-app user message builder**

```ts
export function buildPerAppUserMessage(options: {
  app: RawStructure["applications"][0];
  configYaml?: string;
  seedYaml: string;
  outputPath?: string;
}): string {
  const parts: string[] = [];

  // Single-app raw structure
  const singleAppStructure = {
    version: 1,
    applications: [{
      id: options.app.id,
      path: options.app.path,
      name: options.app.name,
      language: options.app.language,
      modules: options.app.modules.map((mod) => {
        const annotations = mod.metadata["annotations"];
        return {
          id: mod.id,
          name: mod.name,
          ...(annotations ? { annotations } : {}),
        };
      }),
      externalDependencies: options.app.externalDependencies.map((d) => d.name),
      internalImports: options.app.internalImports,
      ...(options.app.publishedAs ? { publishedAs: options.app.publishedAs } : {}),
      ...(options.app.configFiles?.length ? { configFiles: options.app.configFiles } : {}),
    }],
  };

  parts.push("## raw-structure.json\n");
  parts.push(JSON.stringify(singleAppStructure));

  if (options.configYaml) {
    parts.push("\n\n## diagram-docs.yaml\n");
    parts.push(options.configYaml);
  }

  parts.push(`\n\n## Deterministic seed (seed mode — reshape freely)\n`);
  parts.push(options.seedYaml);

  if (options.outputPath) {
    parts.push(
      `\n\nWrite the architecture-model.yaml to: ${options.outputPath}\n` +
        "After writing, read it back and verify the YAML is valid and conforms to the schema. Fix any issues.",
    );
  } else {
    parts.push(
      "\n\nProduce the architecture-model.yaml content. Output ONLY the YAML — no markdown fences, no explanatory text before or after.",
    );
  }

  return parts.join("");
}
```

- [ ] **Step 3: Add synthesis prompt builder**

```ts
export function buildSynthesisSystemPrompt(): string {
  return `You are an architecture synthesis agent. You are given the results of per-application architecture modeling and need to produce a unified system-level view.

## Your Job
1. Write a meaningful system name and description (what the system does for users, not how it's built).
2. Refine cross-app relationship labels from generic "Uses"/"Calls" to specific verb phrases (e.g., "Reads user profiles from", "Publishes order events to").
3. Consolidate actors — merge duplicates, improve descriptions.
4. Consolidate external systems — merge duplicates, improve descriptions.

## Output
Output ONLY valid YAML with this structure:
system:
  name: "string"
  description: "string"
actors:
  - id: "kebab-case"
    name: "Human Name"
    description: "What this actor does"
externalSystems:
  - id: "kebab-case"
    name: "Human Name"
    description: "What this system provides"
    technology: "e.g. PostgreSQL"
relationships:
  - sourceId: "string"
    targetId: "string"
    label: "Specific verb phrase"
    technology: "optional"

Only include relationships that were provided to you. Do not invent new ones. Refine labels only.`;
}

export function buildSynthesisUserMessage(options: {
  containers: Array<{ id: string; name: string; description: string; technology: string }>;
  actors: ArchitectureModel["actors"];
  externalSystems: ArchitectureModel["externalSystems"];
  crossAppRelationships: ArchitectureModel["relationships"];
}): string {
  const parts: string[] = [];

  parts.push("## Containers\n");
  parts.push(JSON.stringify(options.containers, null, 2));

  parts.push("\n\n## Current Actors\n");
  parts.push(JSON.stringify(options.actors, null, 2));

  parts.push("\n\n## Current External Systems\n");
  parts.push(JSON.stringify(options.externalSystems, null, 2));

  parts.push("\n\n## Cross-App Relationships (refine labels)\n");
  parts.push(JSON.stringify(options.crossAppRelationships, null, 2));

  return parts.join("");
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/llm-model-builder.ts
git commit -m "feat: add per-app and synthesis prompt builders for parallel LLM calls"
```

---

### Task 7: Parallel Model Builder — Split & Merge

**Files:**
- Create: `src/core/parallel-model-builder.ts`
- Create: `tests/core/parallel-model-builder.test.ts`

- [ ] **Step 1: Write failing tests for split and merge logic**

```ts
// tests/core/parallel-model-builder.test.ts
import { describe, it, expect } from "vitest";
import { splitRawStructure, mergePartialModels } from "../../src/core/parallel-model-builder.js";
import type { RawStructure, ArchitectureModel } from "../../src/analyzers/types.js";

function makeRawStructure(apps: RawStructure["applications"]): RawStructure {
  return { version: 1, scannedAt: "2026-01-01T00:00:00Z", checksum: "test", applications: apps };
}

const appA = {
  id: "app-a", path: "a", name: "a", language: "java" as const, buildFile: "pom.xml",
  modules: [], externalDependencies: [], internalImports: [],
};
const appB = {
  id: "app-b", path: "b", name: "b", language: "python" as const, buildFile: "pyproject.toml",
  modules: [], externalDependencies: [], internalImports: [],
};

describe("splitRawStructure", () => {
  it("produces one slice per app", () => {
    const raw = makeRawStructure([appA, appB]);
    const slices = splitRawStructure(raw);
    expect(slices).toHaveLength(2);
    expect(slices[0].applications).toHaveLength(1);
    expect(slices[0].applications[0].id).toBe("app-a");
    expect(slices[1].applications[0].id).toBe("app-b");
  });

  it("preserves internalImports in each slice", () => {
    const raw = makeRawStructure([
      { ...appA, internalImports: [{ sourceModuleId: "a-mod", targetApplicationId: "app-b", targetPath: "b" }] },
      appB,
    ]);
    const slices = splitRawStructure(raw);
    expect(slices[0].applications[0].internalImports).toHaveLength(1);
  });
});

describe("mergePartialModels", () => {
  const partial1: ArchitectureModel = {
    version: 1,
    system: { name: "", description: "" },
    actors: [{ id: "api-consumer", name: "API Consumer", description: "Calls APIs" }],
    externalSystems: [{ id: "postgresql", name: "PostgreSQL", description: "Database", technology: "Database" }],
    containers: [{ id: "app-a", applicationId: "app-a", name: "A", description: "App A", technology: "Java", path: "a" }],
    components: [{ id: "a-ctrl", containerId: "app-a", name: "Controller", description: "REST controller", technology: "Java", moduleIds: ["a-ctrl-mod"] }],
    relationships: [{ sourceId: "a-ctrl", targetId: "a-svc", label: "Delegates to" }],
  };

  const partial2: ArchitectureModel = {
    version: 1,
    system: { name: "", description: "" },
    actors: [{ id: "api-consumer", name: "API Consumer", description: "External API consumer" }],
    externalSystems: [{ id: "postgresql", name: "PostgreSQL", description: "Stores data", technology: "Database" }],
    containers: [{ id: "app-b", applicationId: "app-b", name: "B", description: "App B", technology: "Python", path: "b" }],
    components: [{ id: "b-svc", containerId: "app-b", name: "Service", description: "Business logic", technology: "Python", moduleIds: ["b-svc-mod"] }],
    relationships: [{ sourceId: "b-svc", targetId: "b-repo", label: "Persists via" }],
  };

  it("concatenates containers and components", () => {
    const merged = mergePartialModels([partial1, partial2]);
    expect(merged.containers).toHaveLength(2);
    expect(merged.components).toHaveLength(2);
  });

  it("deduplicates actors by id, keeping longer description", () => {
    const merged = mergePartialModels([partial1, partial2]);
    const apiActors = merged.actors.filter((a) => a.id === "api-consumer");
    expect(apiActors).toHaveLength(1);
    expect(apiActors[0].description).toBe("External API consumer");
  });

  it("deduplicates external systems by id, keeping longer description", () => {
    const merged = mergePartialModels([partial1, partial2]);
    const pgSystems = merged.externalSystems.filter((e) => e.id === "postgresql");
    expect(pgSystems).toHaveLength(1);
    expect(pgSystems[0].description).toBe("Database used by the system");
    // Keeps longer description — "Stores data" is shorter than original "Database"
    // Actually "Stores data" (11) vs "Database" (8) — "Stores data" is longer
  });

  it("concatenates relationships", () => {
    const merged = mergePartialModels([partial1, partial2]);
    expect(merged.relationships).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/parallel-model-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement split and merge**

```ts
// src/core/parallel-model-builder.ts

import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";

/**
 * Split a multi-app RawStructure into one RawStructure per application.
 * Each slice preserves internalImports for LLM context.
 */
export function splitRawStructure(raw: RawStructure): RawStructure[] {
  return raw.applications.map((app) => ({
    version: raw.version,
    scannedAt: raw.scannedAt,
    checksum: raw.checksum,
    applications: [app],
  }));
}

/**
 * Merge partial per-app ArchitectureModels into a single model.
 * Deduplicates actors and external systems by ID, keeping longer descriptions.
 */
export function mergePartialModels(partials: ArchitectureModel[]): ArchitectureModel {
  const containers = partials.flatMap((p) => p.containers);
  const components = partials.flatMap((p) => p.components);
  const relationships = partials.flatMap((p) => p.relationships);

  // Deduplicate actors by id
  const actorMap = new Map<string, ArchitectureModel["actors"][0]>();
  for (const partial of partials) {
    for (const actor of partial.actors) {
      const existing = actorMap.get(actor.id);
      if (!existing || actor.description.length > existing.description.length) {
        actorMap.set(actor.id, actor);
      }
    }
  }

  // Deduplicate external systems by id
  const extMap = new Map<string, ArchitectureModel["externalSystems"][0]>();
  for (const partial of partials) {
    for (const ext of partial.externalSystems) {
      const existing = extMap.get(ext.id);
      if (!existing || ext.description.length > existing.description.length) {
        extMap.set(ext.id, ext);
      }
    }
  }

  return {
    version: 1,
    system: { name: "", description: "" }, // Filled by synthesis
    actors: [...actorMap.values()],
    externalSystems: [...extMap.values()],
    containers,
    components,
    relationships,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/parallel-model-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/parallel-model-builder.ts tests/core/parallel-model-builder.test.ts
git commit -m "feat: add split and merge logic for parallel per-app LLM calls"
```

---

### Task 8: Parallel Model Builder — Orchestration

**Files:**
- Modify: `src/core/parallel-model-builder.ts`
- Modify: `tests/core/parallel-model-builder.test.ts`

- [ ] **Step 1: Write failing tests for orchestration**

Add to `tests/core/parallel-model-builder.test.ts`:

```ts
import { buildModelParallel, type ParallelBuildOptions } from "../../src/core/parallel-model-builder.js";
import { configSchema } from "../../src/config/schema.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";
import { stringify as stringifyYaml } from "yaml";

function makeConfig(overrides = {}) {
  return configSchema.parse(overrides);
}

// Minimal mock provider that returns a valid partial model YAML
function makeMockProvider(responses: Map<string, string>) {
  return {
    name: "mock",
    supportsTools: false,
    isAvailable: () => true,
    generate: async (systemPrompt: string, userMessage: string) => {
      // Find which app this is for by checking the user message
      for (const [appId, yaml] of responses) {
        if (userMessage.includes(appId)) return yaml;
      }
      // Synthesis call — return system-level YAML
      return responses.get("__synthesis__") ?? "";
    },
  };
}

describe("buildModelParallel", () => {
  it("dispatches one call per app and merges results", async () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      { ...appA, modules: [{ id: "a-mod", path: "a", name: "a", files: [], exports: [], imports: [], metadata: {} }] },
      { ...appB, modules: [{ id: "b-mod", path: "b", name: "b", files: [], exports: [], imports: [], metadata: {} }] },
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [{ id: "app-a", applicationId: "app-a", name: "A", description: "App A", technology: "Java", path: "a" }],
      components: [{ id: "a-mod", containerId: "app-a", name: "A Module", description: "Module A", technology: "Java", moduleIds: ["a-mod"] }],
      relationships: [],
    };
    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [{ id: "app-b", applicationId: "app-b", name: "B", description: "App B", technology: "Python", path: "b" }],
      components: [{ id: "b-mod", containerId: "app-b", name: "B Module", description: "Module B", technology: "Python", moduleIds: ["b-mod"] }],
      relationships: [],
    };

    const synthResponse = `system:\n  name: "Test System"\n  description: "A test"\nactors: []\nexternalSystems: []\nrelationships: []`;

    const responses = new Map([
      ["app-a", stringifyYaml(partialA)],
      ["app-b", stringifyYaml(partialB)],
      ["__synthesis__", synthResponse],
    ]);

    const provider = makeMockProvider(responses);
    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    expect(result.containers).toHaveLength(2);
    expect(result.components).toHaveLength(2);
    expect(result.system.name).toBe("Test System");
  });

  it("falls back to deterministic seed when per-app call fails", async () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      { ...appA, modules: [{ id: "a-mod", path: "a", name: "a", files: [], exports: [], imports: [], metadata: {} }] },
    ]);

    const provider = {
      name: "mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async () => { throw new Error("LLM failed"); },
    };

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    // Should fall back to deterministic seed — still has container and component
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0].id).toBe("app-a");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/parallel-model-builder.test.ts`
Expected: FAIL — `buildModelParallel` not found

- [ ] **Step 3: Implement orchestration**

Add to `src/core/parallel-model-builder.ts`:

```ts
import type { Config } from "../config/schema.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildModel } from "./model-builder.js";
import { architectureModelSchema } from "./model.js";
import {
  type LLMProvider,
  type ProgressEvent,
  buildPerAppSystemPrompt,
  buildPerAppUserMessage,
  buildSynthesisSystemPrompt,
  buildSynthesisUserMessage,
  repairLLMYaml,
} from "./llm-model-builder.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ParallelBuildOptions {
  rawStructure: RawStructure;
  config: Config;
  configYaml?: string;
  provider: LLMProvider;
  onStatus?: (status: string) => void;
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * Build architecture model by dispatching parallel per-app LLM calls.
 * Falls back to deterministic seed for any app whose LLM call fails.
 */
export async function buildModelParallel(
  options: ParallelBuildOptions,
): Promise<ArchitectureModel> {
  const { rawStructure, config, provider } = options;
  const emit = (msg: string) => options.onStatus?.(msg);
  const apps = rawStructure.applications;
  const concurrency = config.llm.concurrency;

  // 1. Split into per-app slices
  const slices = splitRawStructure(rawStructure);

  // 2. Build per-app deterministic seeds
  const perAppSeeds = slices.map((slice) => {
    const seed = buildModel({ config, rawStructure: slice });
    return stringifyYaml(seed, { lineWidth: 120 });
  });

  // 3. Dispatch parallel per-app LLM calls with concurrency limit
  emit?.(`Dispatching ${apps.length} per-app LLM calls (concurrency: ${concurrency})...`);

  const perAppTimeout = 300_000; // 5 minutes per app
  let running = 0;
  const queue: Array<() => void> = [];

  function acquireSlot(): Promise<void> {
    if (running < concurrency) {
      running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function releaseSlot(): void {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  }

  const perAppPromises = apps.map(async (app, i) => {
    await acquireSlot();
    try {
      emit?.(`Modeling application ${i + 1}/${apps.length}: ${app.name}...`);

      const outputPath = provider.supportsTools
        ? path.join(os.tmpdir(), `diagram-docs-perapp-${app.id}-${Date.now()}.yaml`)
        : undefined;
      const systemPrompt = buildPerAppSystemPrompt(outputPath);
      const userMessage = buildPerAppUserMessage({
        app,
        configYaml: options.configYaml,
        seedYaml: perAppSeeds[i],
        outputPath,
      });

      let textOutput: string;
      try {
        textOutput = await provider.generate(
          systemPrompt,
          userMessage,
          config.llm.model,
          options.onProgress,
        );
      } finally {
        // Clean up temp file for tool-using providers
        if (outputPath) {
          try { fs.unlinkSync(outputPath); } catch { /* best-effort */ }
        }
      }

      // Prefer file output if provider wrote one, otherwise use text stream
      let rawOutput = textOutput.trim()
        .replace(/^```ya?ml\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "");

      if (!rawOutput.startsWith("version:") && !rawOutput.startsWith("---")) {
        const yamlStart = rawOutput.indexOf("\nversion:");
        if (yamlStart !== -1) rawOutput = rawOutput.slice(yamlStart + 1);
      }

      const repair = repairLLMYaml(rawOutput);
      rawOutput = repair.yaml;

      const parsed = parseYaml(rawOutput);
      return architectureModelSchema.parse(parsed) as ArchitectureModel;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit?.(`Warning: LLM call failed for ${app.name}, using deterministic seed: ${msg}`);
      // Fallback to deterministic seed for this app
      return buildModel({ config, rawStructure: slices[i] });
    } finally {
      releaseSlot();
    }
  });

  const partialModels = await Promise.all(perAppPromises);

  // 4. Merge partial models
  const merged = mergePartialModels(partialModels);

  // 5. Inject deterministic cross-app relationships
  const fullSeed = buildModel({ config, rawStructure });
  const crossAppRelationships = fullSeed.relationships.filter((r) => {
    const srcContainer = merged.containers.find((c) => c.id === r.sourceId);
    const tgtContainer = merged.containers.find((c) => c.id === r.targetId);
    // A relationship is cross-app if both source and target are containers (not components within same container)
    return srcContainer && tgtContainer && srcContainer.id !== tgtContainer.id;
  });

  // Add cross-app relationships, preferring existing LLM labels
  const existingKeys = new Set(merged.relationships.map((r) => `${r.sourceId}->${r.targetId}`));
  for (const rel of crossAppRelationships) {
    const key = `${rel.sourceId}->${rel.targetId}`;
    if (!existingKeys.has(key)) {
      merged.relationships.push(rel);
      existingKeys.add(key);
    }
  }

  // Also inject cross-app component-level relationships from deterministic builder
  const crossAppComponentRels = fullSeed.relationships.filter((r) => {
    const key = `${r.sourceId}->${r.targetId}`;
    return !existingKeys.has(key);
  });
  for (const rel of crossAppComponentRels) {
    merged.relationships.push(rel);
  }

  // 6. Synthesis pass — refine system description and cross-app labels
  emit?.("Synthesizing cross-app architecture...");
  try {
    const synthSystemPrompt = buildSynthesisSystemPrompt();
    const synthUserMessage = buildSynthesisUserMessage({
      containers: merged.containers.map((c) => ({
        id: c.id, name: c.name, description: c.description, technology: c.technology,
      })),
      actors: merged.actors,
      externalSystems: merged.externalSystems,
      crossAppRelationships,
    });

    const synthOutput = await provider.generate(
      synthSystemPrompt,
      synthUserMessage,
      config.llm.model,
      options.onProgress,
    );

    let synthYaml = synthOutput.trim()
      .replace(/^```ya?ml\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "");

    const synthRepair = repairLLMYaml(synthYaml);
    synthYaml = synthRepair.yaml;

    const synthParsed = parseYaml(synthYaml) as {
      system?: { name?: string; description?: string };
      actors?: ArchitectureModel["actors"];
      externalSystems?: ArchitectureModel["externalSystems"];
      relationships?: ArchitectureModel["relationships"];
    };

    // Apply synthesis results
    if (synthParsed.system?.name) merged.system.name = synthParsed.system.name;
    if (synthParsed.system?.description) merged.system.description = synthParsed.system.description;
    if (synthParsed.actors?.length) merged.actors = synthParsed.actors;
    if (synthParsed.externalSystems?.length) merged.externalSystems = synthParsed.externalSystems;

    // Update cross-app relationship labels from synthesis
    if (synthParsed.relationships?.length) {
      const synthRelMap = new Map(
        synthParsed.relationships.map((r) => [`${r.sourceId}->${r.targetId}`, r]),
      );
      for (const rel of merged.relationships) {
        const synthRel = synthRelMap.get(`${rel.sourceId}->${rel.targetId}`);
        if (synthRel && synthRel.label !== "Uses" && synthRel.label !== "Calls") {
          rel.label = synthRel.label;
          if (synthRel.technology) rel.technology = synthRel.technology;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit?.(`Warning: synthesis call failed, using merged results as-is: ${msg}`);
    // Fall back to config values for system info
    merged.system.name = config.system.name;
    merged.system.description = config.system.description;
  }

  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/parallel-model-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/parallel-model-builder.ts tests/core/parallel-model-builder.test.ts
git commit -m "feat: implement parallel per-app LLM orchestration with synthesis pass"
```

---

### Task 9: Wire Parallel Path into buildModelWithLLM

**Files:**
- Modify: `src/core/llm-model-builder.ts:763-951`

- [ ] **Step 1: Add parallel dispatch gate in buildModelWithLLM**

In `src/core/llm-model-builder.ts`, after the provider resolution in `buildModelWithLLM` (around line 797), add a gate for the parallel path:

```ts
  // Parallel path: multi-app seed mode
  const isSeedMode = !options.existingModelYaml;
  const apps = options.rawStructure.applications;
  if (isSeedMode && apps.length > 1) {
    const { buildModelParallel } = await import("./parallel-model-builder.js");
    return buildModelParallel({
      rawStructure: options.rawStructure,
      config: options.config,
      configYaml: options.configYaml,
      provider: resolvedProvider,
      onStatus: (status) => options.onStatus?.(status, resolvedProvider.name),
      onProgress: options.onProgress,
    });
  }

  // Single-app or update mode: existing sequential path (unchanged below)
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/llm-model-builder.ts
git commit -m "feat: gate parallel per-app LLM path for multi-app seed mode"
```

---

### Task 10: Final Integration Verification

**Files:** No new changes — verification only.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS — clean compile to dist/

- [ ] **Step 5: Commit any remaining fixes**

If any lint/type issues were found, stage only the affected files:
```bash
git add src/core/patterns.ts src/core/model-builder.ts src/core/llm-model-builder.ts src/core/parallel-model-builder.ts src/config/schema.ts
git commit -m "fix: address lint and type issues from parallel LLM implementation"
```
