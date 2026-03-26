import { describe, it, expect } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import {
  splitRawStructure,
  mergePartialModels,
  buildModelParallel,
} from "../../src/core/parallel-model-builder.js";
import type { LLMProvider, ProgressEvent } from "../../src/core/llm-model-builder.js";
import { LLMCallError } from "../../src/core/llm-model-builder.js";
import { configSchema } from "../../src/config/schema.js";
import type {
  RawStructure,
  ArchitectureModel,
} from "../../src/analyzers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawStructure(
  apps: RawStructure["applications"],
): RawStructure {
  return {
    version: 1,
    scannedAt: "2026-03-22T00:00:00Z",
    checksum: "abc123",
    applications: apps,
  };
}

function makeApp(
  id: string,
  overrides?: Partial<RawStructure["applications"][0]>,
): RawStructure["applications"][0] {
  return {
    id,
    path: `apps/${id}`,
    name: id,
    language: "java",
    buildFile: `apps/${id}/build.gradle`,
    modules: [],
    externalDependencies: [],
    internalImports: [],
    ...overrides,
  };
}

function makePartialModel(
  overrides?: Partial<ArchitectureModel>,
): ArchitectureModel {
  return {
    version: 1,
    system: { name: "", description: "" },
    actors: [],
    externalSystems: [],
    containers: [],
    components: [],
    relationships: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 7: splitRawStructure
// ---------------------------------------------------------------------------

describe("splitRawStructure", () => {
  it("produces one slice per app", () => {
    const raw = makeRawStructure([
      makeApp("app-a"),
      makeApp("app-b"),
      makeApp("app-c"),
    ]);

    const slices = splitRawStructure(raw);

    expect(slices).toHaveLength(3);
    expect(slices[0].applications).toHaveLength(1);
    expect(slices[0].applications[0].id).toBe("app-a");
    expect(slices[1].applications[0].id).toBe("app-b");
    expect(slices[2].applications[0].id).toBe("app-c");
  });

  it("preserves internalImports for LLM context", () => {
    const raw = makeRawStructure([
      makeApp("app-a", {
        internalImports: [
          {
            sourceModuleId: "mod-a1",
            targetApplicationId: "app-b",
            targetPath: "apps/app-b/src/main",
          },
        ],
      }),
      makeApp("app-b"),
    ]);

    const slices = splitRawStructure(raw);

    expect(slices[0].applications[0].internalImports).toHaveLength(1);
    expect(slices[0].applications[0].internalImports[0].targetApplicationId).toBe(
      "app-b",
    );
  });

  it("preserves version and metadata in each slice", () => {
    const raw = makeRawStructure([makeApp("app-a"), makeApp("app-b")]);

    const slices = splitRawStructure(raw);

    for (const slice of slices) {
      expect(slice.version).toBe(1);
      expect(slice.scannedAt).toBe(raw.scannedAt);
      expect(slice.checksum).toBe(raw.checksum);
    }
  });

  it("returns empty array for empty applications", () => {
    const raw = makeRawStructure([]);
    const slices = splitRawStructure(raw);
    expect(slices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 7: mergePartialModels
// ---------------------------------------------------------------------------

describe("mergePartialModels", () => {
  it("concatenates containers and components", () => {
    const a = makePartialModel({
      containers: [
        {
          id: "svc-a",
          applicationId: "svc-a",
          name: "Service A",
          description: "A",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "comp-a1",
          containerId: "svc-a",
          name: "Comp A1",
          description: "A1",
          technology: "Spring",
          moduleIds: ["mod-a1"],
        },
      ],
    });

    const b = makePartialModel({
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "B",
          technology: "Python",
        },
      ],
      components: [
        {
          id: "comp-b1",
          containerId: "svc-b",
          name: "Comp B1",
          description: "B1",
          technology: "Flask",
          moduleIds: ["mod-b1"],
        },
      ],
    });

    const merged = mergePartialModels([a, b]);

    expect(merged.containers).toHaveLength(2);
    expect(merged.containers.map((c) => c.id)).toEqual(["svc-a", "svc-b"]);
    expect(merged.components).toHaveLength(2);
    expect(merged.components.map((c) => c.id)).toEqual(["comp-a1", "comp-b1"]);
  });

  it("deduplicates actors by id, keeps longer description", () => {
    const a = makePartialModel({
      actors: [
        { id: "api-consumer", name: "API Consumer", description: "Short" },
      ],
    });

    const b = makePartialModel({
      actors: [
        {
          id: "api-consumer",
          name: "API Consumer",
          description: "A much longer description of the API consumer",
        },
        {
          id: "admin-user",
          name: "Admin User",
          description: "Admin",
        },
      ],
    });

    const merged = mergePartialModels([a, b]);

    expect(merged.actors).toHaveLength(2);
    const apiConsumer = merged.actors.find((a) => a.id === "api-consumer");
    expect(apiConsumer?.description).toBe(
      "A much longer description of the API consumer",
    );
    const admin = merged.actors.find((a) => a.id === "admin-user");
    expect(admin).toBeDefined();
  });

  it("deduplicates external systems by id, keeps longer description", () => {
    const a = makePartialModel({
      externalSystems: [
        {
          id: "postgresql",
          name: "PostgreSQL",
          description: "DB",
          technology: "PostgreSQL",
        },
      ],
    });

    const b = makePartialModel({
      externalSystems: [
        {
          id: "postgresql",
          name: "PostgreSQL",
          description: "Relational database for persistent storage",
          technology: "PostgreSQL",
        },
        {
          id: "redis",
          name: "Redis",
          description: "Cache",
          technology: "Redis",
        },
      ],
    });

    const merged = mergePartialModels([a, b]);

    expect(merged.externalSystems).toHaveLength(2);
    const pg = merged.externalSystems.find((e) => e.id === "postgresql");
    expect(pg?.description).toBe(
      "Relational database for persistent storage",
    );
    const redis = merged.externalSystems.find((e) => e.id === "redis");
    expect(redis).toBeDefined();
  });

  it("concatenates relationships", () => {
    const a = makePartialModel({
      relationships: [
        { sourceId: "comp-a1", targetId: "comp-a2", label: "Calls" },
      ],
    });

    const b = makePartialModel({
      relationships: [
        { sourceId: "comp-b1", targetId: "comp-b2", label: "Reads from" },
      ],
    });

    const merged = mergePartialModels([a, b]);

    expect(merged.relationships).toHaveLength(2);
    expect(merged.relationships[0].label).toBe("Calls");
    expect(merged.relationships[1].label).toBe("Reads from");
  });

  it("deduplicates relationships by sourceId->targetId key", () => {
    const a = makePartialModel({
      relationships: [
        { sourceId: "comp-x", targetId: "ext-db", label: "Reads from" },
      ],
    });

    const b = makePartialModel({
      relationships: [
        { sourceId: "comp-x", targetId: "ext-db", label: "Writes to" },
        { sourceId: "comp-y", targetId: "ext-db", label: "Reads from" },
      ],
    });

    const merged = mergePartialModels([a, b]);

    // comp-x->ext-db appears in both; first wins
    expect(merged.relationships).toHaveLength(2);
    expect(merged.relationships[0]).toMatchObject({
      sourceId: "comp-x",
      targetId: "ext-db",
      label: "Reads from",
    });
    expect(merged.relationships[1]).toMatchObject({
      sourceId: "comp-y",
      targetId: "ext-db",
    });
  });

  it("leaves system name/description empty for synthesis", () => {
    const a = makePartialModel({
      system: { name: "App A System", description: "Desc A" },
    });
    const b = makePartialModel({
      system: { name: "App B System", description: "Desc B" },
    });

    const merged = mergePartialModels([a, b]);

    expect(merged.system.name).toBe("");
    expect(merged.system.description).toBe("");
  });

  it("handles empty input", () => {
    const merged = mergePartialModels([]);

    expect(merged.version).toBe(1);
    expect(merged.containers).toHaveLength(0);
    expect(merged.components).toHaveLength(0);
    expect(merged.actors).toHaveLength(0);
    expect(merged.externalSystems).toHaveLength(0);
    expect(merged.relationships).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 8: buildModelParallel orchestration
// ---------------------------------------------------------------------------

function makeMockProvider(
  responses: Map<string, string>,
): LLMProvider {
  return {
    name: "mock",
    supportsTools: false,
    isAvailable: () => true,
    generate: async (
      systemPrompt: string,
      userMessage: string,
      _model: string,
      _onProgress?: (event: ProgressEvent) => void,
    ) => {
      // Synthesis calls use a different system prompt (no "Single-App Mode")
      const isSynthesis = systemPrompt.includes("synthesis agent");
      if (isSynthesis) {
        return responses.get("__synthesis__") ?? "";
      }
      for (const [appId, yaml] of responses) {
        if (appId === "__synthesis__") continue;
        if (userMessage.includes(appId)) return yaml;
      }
      throw new Error("Mock provider: no response configured for this app — check test setup");
    },
  };
}

function makeConfig(overrides?: Record<string, unknown>) {
  return configSchema.parse({
    system: { name: "Test System", description: "A test system" },
    ...overrides,
  });
}

describe("buildModelParallel", () => {
  it("dispatches one call per app and merges results", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "Service A", description: "A service" },
      actors: [
        { id: "api-consumer", name: "API Consumer", description: "Calls Service A APIs" },
      ],
      externalSystems: [],
      containers: [
        {
          id: "svc-a",
          applicationId: "svc-a",
          name: "Service A",
          description: "Service A application",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-a1",
          containerId: "svc-a",
          name: "Main",
          description: "Core logic",
          technology: "Java",
          moduleIds: ["mod-a1"],
        },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "Service B", description: "B service" },
      actors: [],
      externalSystems: [
        {
          id: "postgresql",
          name: "PostgreSQL",
          description: "Relational database",
          technology: "PostgreSQL",
        },
      ],
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "Service B application",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-b1",
          containerId: "svc-b",
          name: "Main",
          description: "Core logic",
          technology: "Java",
          moduleIds: ["mod-b1"],
        },
      ],
      relationships: [
        { sourceId: "mod-b1", targetId: "postgresql", label: "Reads from" },
      ],
    };

    const synthesisYaml = stringifyYaml({
      system: { name: "My Platform", description: "A multi-service platform" },
      actors: [
        { id: "api-consumer", name: "API Consumer", description: "External client" },
      ],
      externalSystems: [
        {
          id: "postgresql",
          name: "PostgreSQL",
          description: "Relational database for persistent storage",
          technology: "PostgreSQL",
        },
      ],
      relationships: [],
    });

    const responses = new Map<string, string>();
    responses.set("svc-a", stringifyYaml(partialA));
    responses.set("svc-b", stringifyYaml(partialB));
    responses.set("__synthesis__", synthesisYaml);

    const provider = makeMockProvider(responses);
    const config = makeConfig({ llm: { concurrency: 2 } });

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    // Containers from both apps should be present
    expect(result.containers).toHaveLength(2);
    expect(result.containers.map((c) => c.id).sort()).toEqual(["svc-a", "svc-b"]);

    // Components from both apps
    expect(result.components).toHaveLength(2);

    // Synthesis should have set system name
    expect(result.system.name).toBe("My Platform");
    expect(result.system.description).toBe("A multi-service platform");

    // Actors from synthesis
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0].id).toBe("api-consumer");

    // External systems from synthesis
    expect(result.externalSystems).toHaveLength(1);
    expect(result.externalSystems[0].id).toBe("postgresql");
  });

  it("falls back to deterministic seed when a per-app call fails", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "Service B", description: "B service" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "Service B application",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-b1",
          containerId: "svc-b",
          name: "Main",
          description: "Core logic",
          technology: "Java",
          moduleIds: ["mod-b1"],
        },
      ],
      relationships: [],
    };

    // Provider throws for svc-a, succeeds for svc-b, succeeds for synthesis
    const failingProvider: LLMProvider = {
      name: "failing-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        const isSynthesis = systemPrompt.includes("synthesis agent");
        if (isSynthesis) {
          return stringifyYaml({
            system: { name: "Fallback System", description: "From synthesis" },
            actors: [],
            externalSystems: [],
            relationships: [],
          });
        }
        if (userMessage.includes("svc-a")) {
          throw new Error("LLM connection failed");
        }
        return stringifyYaml(partialB);
      },
    };

    const config = makeConfig();
    const statuses: string[] = [];

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: failingProvider,
      onStatus: (s) => statuses.push(s),
    });

    // Should still produce a valid model — svc-a falls back to deterministic seed
    expect(result.containers).toHaveLength(2);
    expect(result.containers.map((c) => c.id).sort()).toEqual(["svc-a", "svc-b"]);

    // Should have logged a fallback message for svc-a
    const fallbackMsg = statuses.find((s) => s.includes("deterministic seed"));
    expect(fallbackMsg).toBeDefined();

    // Should have logged partial fallback warning
    const warnMsg = statuses.find((s) => s.includes("WARNING") && s.includes("fell back"));
    expect(warnMsg).toBeDefined();
  });

  it("throws when ALL per-app calls fail", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const allFailProvider: LLMProvider = {
      name: "all-fail-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async () => {
        throw new Error("LLM connection failed");
      },
    };

    const config = makeConfig();

    await expect(
      buildModelParallel({
        rawStructure: raw,
        config,
        provider: allFailProvider,
        onStatus: () => {},
      }),
    ).rejects.toThrow("All 2 per-app LLM calls failed");
  });

  it("falls back to config system info when synthesis fails", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-a",
          applicationId: "svc-a",
          name: "Service A",
          description: "Service A app",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-a1",
          containerId: "svc-a",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-a1"],
        },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "Service B app",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-b1",
          containerId: "svc-b",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-b1"],
        },
      ],
      relationships: [],
    };

    let callCount = 0;
    const synthFailProvider: LLMProvider = {
      name: "synth-fail-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        callCount++;
        const isSynthesis = systemPrompt.includes("synthesis agent");
        if (isSynthesis) {
          throw new Error("Synthesis LLM timeout");
        }
        if (userMessage.includes("svc-b")) return stringifyYaml(partialB);
        return stringifyYaml(partialA);
      },
    };

    const config = makeConfig({
      system: { name: "Config System Name", description: "Config description" },
    });
    const statuses: string[] = [];

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: synthFailProvider,
      onStatus: (s) => statuses.push(s),
    });

    // Should fall back to config values
    expect(result.system.name).toBe("Config System Name");
    expect(result.system.description).toBe("Config description");

    // Should have called provider at least 3 times (2 per-app + synthesis attempt)
    expect(callCount).toBeGreaterThanOrEqual(3);

    // Should have logged synthesis failure
    const synthMsg = statuses.find((s) => s.includes("Synthesis failed"));
    expect(synthMsg).toBeDefined();
  });

  it("falls back to config defaults when synthesis omits system fields", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-a",
          applicationId: "svc-a",
          name: "Service A",
          description: "Service A app",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-a1",
          containerId: "svc-a",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-a1"],
        },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "Service B app",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-b1",
          containerId: "svc-b",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-b1"],
        },
      ],
      relationships: [],
    };

    // Synthesis succeeds but returns no system fields
    const synthesisYaml = stringifyYaml({
      actors: [],
      externalSystems: [],
      relationships: [],
    });

    const responses = new Map<string, string>();
    responses.set("svc-a", stringifyYaml(partialA));
    responses.set("svc-b", stringifyYaml(partialB));
    responses.set("__synthesis__", synthesisYaml);

    const provider = makeMockProvider(responses);
    const config = makeConfig({
      system: { name: "From Config", description: "Config description" },
    });

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    // Should fall back to config defaults, not empty strings
    expect(result.system.name).toBe("From Config");
    expect(result.system.description).toBe("Config description");
  });

  it("handles a single application without throwing", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partial = makePartialModel({
      containers: [{ id: "svc-a", applicationId: "svc-a", name: "Service A", description: "A service", technology: "Java" }],
      components: [{ id: "mod-a1", containerId: "svc-a", name: "Main", description: "", technology: "Java", moduleIds: [] }],
    });

    const responses = new Map<string, string>();
    responses.set("svc-a", stringifyYaml(partial));
    responses.set("__synthesis__", stringifyYaml({ system: { name: "My System", description: "" }, actors: [], externalSystems: [], relationships: [] }));

    const provider = makeMockProvider(responses);
    const config = makeConfig();

    const model = await buildModelParallel({ rawStructure: raw, config, provider });
    expect(model.containers.length).toBeGreaterThanOrEqual(0);
  });

  it("propagates programming errors (TypeError) instead of swallowing them", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    // Provider throws TypeError for svc-a — this is a programming bug, not an LLM error
    const buggyProvider: LLMProvider = {
      name: "buggy-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (_systemPrompt: string, userMessage: string) => {
        if (userMessage.includes("svc-a")) {
          throw new TypeError("Cannot read properties of undefined");
        }
        return stringifyYaml({
          version: 1,
          system: { name: "", description: "" },
          actors: [],
          externalSystems: [],
          containers: [
            {
              id: "svc-b",
              applicationId: "svc-b",
              name: "Service B",
              description: "B",
              technology: "Java",
            },
          ],
          components: [
            {
              id: "mod-b1",
              containerId: "svc-b",
              name: "Main",
              description: "Core",
              technology: "Java",
              moduleIds: ["mod-b1"],
            },
          ],
          relationships: [],
        });
      },
    };

    const config = makeConfig();

    // Programming errors must propagate — NOT silently degrade to deterministic seeds
    await expect(
      buildModelParallel({
        rawStructure: raw,
        config,
        provider: buggyProvider,
        onStatus: () => {},
      }),
    ).rejects.toThrow(TypeError);
  });

  it("propagates system resource errors (ENOMEM) instead of wrapping as LLMCallError", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    // Provider throws a system resource error (ENOMEM)
    const enomemProvider: LLMProvider = {
      name: "enomem-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (_systemPrompt: string, userMessage: string) => {
        if (userMessage.includes("svc-a")) {
          const err = new Error("Cannot allocate memory") as NodeJS.ErrnoException;
          err.code = "ENOMEM";
          throw err;
        }
        return stringifyYaml({
          version: 1,
          system: { name: "", description: "" },
          actors: [],
          externalSystems: [],
          containers: [
            { id: "svc-b", applicationId: "svc-b", name: "B", description: "B", technology: "Java" },
          ],
          components: [
            { id: "mod-b1", containerId: "svc-b", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-b1"] },
          ],
          relationships: [],
        });
      },
    };

    const config = makeConfig();

    // System resource errors must propagate — NOT silently degrade to deterministic seeds
    await expect(
      buildModelParallel({
        rawStructure: raw,
        config,
        provider: enomemProvider,
        onStatus: () => {},
      }),
    ).rejects.toThrow("Cannot allocate memory");
  });

  it("injects cross-app relationships from deterministic model", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: ["com.a.Service"],
            imports: [],
            metadata: {},
          },
        ],
        internalImports: [
          {
            sourceModuleId: "mod-a1",
            targetApplicationId: "svc-b",
            targetPath: "apps/svc-b/src/main",
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: ["com.b.Service"],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-a",
          applicationId: "svc-a",
          name: "Service A",
          description: "A",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-a1",
          containerId: "svc-a",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-a1"],
        },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "B",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-b1",
          containerId: "svc-b",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-b1"],
        },
      ],
      relationships: [],
    };

    const synthesisYaml = stringifyYaml({
      system: { name: "Platform", description: "A platform" },
    });

    const responses = new Map<string, string>();
    responses.set("svc-a", stringifyYaml(partialA));
    responses.set("svc-b", stringifyYaml(partialB));
    responses.set("__synthesis__", synthesisYaml);

    const provider = makeMockProvider(responses);
    const config = makeConfig();

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    // Cross-app relationship should have been injected from deterministic model
    // (svc-a has internalImports pointing to svc-b)
    const crossAppRels = result.relationships.filter(
      (r) =>
        (r.sourceId === "svc-a" && r.targetId === "svc-b") ||
        (r.sourceId === "mod-a1" && r.targetId === "mod-b1"),
    );
    expect(crossAppRels.length).toBeGreaterThan(0);
  });

  it("synthesis rollback restores external systems", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [
        { id: "postgres", name: "PostgreSQL", description: "Main DB", technology: "PostgreSQL" },
      ],
      containers: [
        { id: "svc-a", applicationId: "svc-a", name: "A", description: "A", technology: "Java" },
      ],
      components: [
        { id: "mod-a1", containerId: "svc-a", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-a1"] },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "svc-b", applicationId: "svc-b", name: "B", description: "B", technology: "Java" },
      ],
      components: [
        { id: "mod-b1", containerId: "svc-b", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-b1"] },
      ],
      relationships: [],
    };

    const synthFailProvider: LLMProvider = {
      name: "synth-fail-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        if (systemPrompt.includes("synthesis agent")) {
          throw new LLMCallError("Synthesis timed out");
        }
        if (userMessage.includes("svc-b")) return stringifyYaml(partialB);
        return stringifyYaml(partialA);
      },
    };

    const config = makeConfig({
      system: { name: "Config Name", description: "Config Desc" },
    });

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: synthFailProvider,
      onStatus: () => {},
    });

    // External systems from per-app models should survive synthesis rollback
    expect(result.externalSystems).toHaveLength(1);
    expect(result.externalSystems[0].id).toBe("postgres");
  });

  it("falls back to deterministic seed when per-app LLM returns invalid YAML", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const validPartialB: ArchitectureModel = {
      version: 1,
      system: { name: "Service B", description: "B service" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "svc-b", applicationId: "svc-b", name: "Service B", description: "B", technology: "Java" },
      ],
      components: [
        { id: "mod-b1", containerId: "svc-b", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-b1"] },
      ],
      relationships: [],
    };

    // svc-a returns garbage YAML, svc-b returns valid model
    const badYamlProvider: LLMProvider = {
      name: "bad-yaml-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        if (systemPrompt.includes("synthesis agent")) {
          return stringifyYaml({
            system: { name: "Platform", description: "A platform" },
          });
        }
        if (userMessage.includes("svc-a")) {
          return "Here is the model:\nNot valid yaml [[[";
        }
        return stringifyYaml(validPartialB);
      },
    };

    const config = makeConfig();
    const statuses: string[] = [];

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: badYamlProvider,
      onStatus: (s) => statuses.push(s),
    });

    // svc-a should fall back to deterministic seed, svc-b from LLM
    expect(result.containers).toHaveLength(2);
    // Should have logged a fallback warning
    const fallbackMsg = statuses.find((s) => s.includes("svc-a") && s.includes("deterministic seed"));
    expect(fallbackMsg).toBeDefined();
  });

  it("falls back to deterministic seed when per-app LLM returns schema-invalid YAML", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const validPartialB: ArchitectureModel = {
      version: 1,
      system: { name: "Service B", description: "B service" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "svc-b", applicationId: "svc-b", name: "Service B", description: "B", technology: "Java" },
      ],
      components: [
        { id: "mod-b1", containerId: "svc-b", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-b1"] },
      ],
      relationships: [],
    };

    // svc-a returns valid YAML that fails schema validation
    const schemaFailProvider: LLMProvider = {
      name: "schema-fail-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        if (systemPrompt.includes("synthesis agent")) {
          return stringifyYaml({
            system: { name: "Platform", description: "A platform" },
          });
        }
        if (userMessage.includes("svc-a")) {
          // Valid YAML but wrong schema: containers should be an array, not a string
          return "version: 1\ncontainers: 'not-an-array'";
        }
        return stringifyYaml(validPartialB);
      },
    };

    const config = makeConfig();
    const statuses: string[] = [];

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: schemaFailProvider,
      onStatus: (s) => statuses.push(s),
    });

    // svc-a should fall back to deterministic seed
    expect(result.containers).toHaveLength(2);
    const fallbackMsg = statuses.find((s) => s.includes("svc-a") && s.includes("deterministic seed"));
    expect(fallbackMsg).toBeDefined();
  });

  it("rolls back synthesis when synthesis returns invalid YAML", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [{ id: "user", name: "User", description: "App user" }],
      externalSystems: [{ id: "db", name: "DB", description: "Database", technology: "PostgreSQL" }],
      containers: [
        { id: "svc-a", applicationId: "svc-a", name: "A", description: "A", technology: "Java" },
      ],
      components: [
        { id: "mod-a1", containerId: "svc-a", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-a1"] },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "svc-b", applicationId: "svc-b", name: "B", description: "B", technology: "Java" },
      ],
      components: [
        { id: "mod-b1", containerId: "svc-b", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-b1"] },
      ],
      relationships: [],
    };

    // Synthesis returns garbage
    const synthGarbageProvider: LLMProvider = {
      name: "synth-garbage-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        if (systemPrompt.includes("synthesis agent")) {
          return "system:\n  name: [invalid yaml structure";
        }
        if (userMessage.includes("svc-b")) return stringifyYaml(partialB);
        return stringifyYaml(partialA);
      },
    };

    const config = makeConfig({
      system: { name: "Config System", description: "Config desc" },
    });

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: synthGarbageProvider,
      onStatus: () => {},
    });

    // System should fall back to config defaults
    expect(result.system.name).toBe("Config System");
    // Pre-synthesis actors and external systems should be preserved
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0].id).toBe("user");
    expect(result.externalSystems).toHaveLength(1);
    expect(result.externalSystems[0].id).toBe("db");
  });

  it("enforces concurrency limit on parallel LLM calls", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [{
          id: "mod-a1", path: "apps/svc-a/src/main", name: "svc-a.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
      makeApp("svc-b", {
        modules: [{
          id: "mod-b1", path: "apps/svc-b/src/main", name: "svc-b.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
      makeApp("svc-c", {
        modules: [{
          id: "mod-c1", path: "apps/svc-c/src/main", name: "svc-c.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
      makeApp("svc-d", {
        modules: [{
          id: "mod-d1", path: "apps/svc-d/src/main", name: "svc-d.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
      makeApp("svc-e", {
        modules: [{
          id: "mod-e1", path: "apps/svc-e/src/main", name: "svc-e.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
    ]);

    let running = 0;
    let maxRunning = 0;
    const barriers: Array<() => void> = [];

    const concurrencyProvider: LLMProvider = {
      name: "concurrency-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        if (systemPrompt.includes("synthesis agent")) {
          return stringifyYaml({
            system: { name: "Test", description: "Test" },
          });
        }

        running++;
        maxRunning = Math.max(maxRunning, running);

        // Wait for barrier to release — simulates async LLM work
        await new Promise<void>((resolve) => barriers.push(resolve));

        running--;

        // Find which app this is for
        for (const id of ["svc-a", "svc-b", "svc-c", "svc-d", "svc-e"]) {
          if (userMessage.includes(id)) {
            return stringifyYaml({
              version: 1,
              system: { name: "", description: "" },
              actors: [],
              externalSystems: [],
              containers: [
                { id, applicationId: id, name: id, description: id, technology: "Java" },
              ],
              components: [
                { id: `mod-${id.split("-")[1]}1`, containerId: id, name: "Main", description: "Core", technology: "Java", moduleIds: [`mod-${id.split("-")[1]}1`] },
              ],
              relationships: [],
            });
          }
        }
        throw new Error("Unexpected app");
      },
    };

    const config = makeConfig({ llm: { concurrency: 2 } });

    const resultPromise = buildModelParallel({
      rawStructure: raw,
      config,
      provider: concurrencyProvider,
      onStatus: () => {},
    });

    // Let microtasks run so concurrency slots fill
    await new Promise((r) => setTimeout(r, 10));

    // With concurrency 2, exactly 2 should be running
    expect(running).toBe(2);
    expect(maxRunning).toBe(2);

    // Release first two, let next two start
    barriers.shift()!();
    barriers.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    expect(running).toBe(2);

    // Release next two
    barriers.shift()!();
    barriers.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    expect(running).toBe(1);

    // Release last one
    barriers.shift()!();
    await new Promise((r) => setTimeout(r, 10));

    const result = await resultPromise;
    expect(result.containers).toHaveLength(5);
    // Concurrency was never exceeded
    expect(maxRunning).toBe(2);
  });

  it("synthesis updates relationship labels on merged model", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [{
          id: "mod-a1", path: "apps/svc-a/src/main", name: "svc-a.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
      makeApp("svc-b", {
        modules: [{
          id: "mod-b1", path: "apps/svc-b/src/main", name: "svc-b.main",
          files: ["Main.java"], exports: [], imports: [], metadata: {},
        }],
      }),
    ]);

    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [
        { id: "postgresql", name: "PostgreSQL", description: "Database", technology: "PostgreSQL" },
      ],
      containers: [
        { id: "svc-a", applicationId: "svc-a", name: "Service A", description: "A", technology: "Java" },
      ],
      components: [
        { id: "mod-a1", containerId: "svc-a", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-a1"] },
      ],
      relationships: [
        { sourceId: "mod-a1", targetId: "postgresql", label: "Uses" },
      ],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "svc-b", applicationId: "svc-b", name: "Service B", description: "B", technology: "Java" },
      ],
      components: [
        { id: "mod-b1", containerId: "svc-b", name: "Main", description: "Core", technology: "Java", moduleIds: ["mod-b1"] },
      ],
      relationships: [],
    };

    // Synthesis returns updated relationship labels
    const synthesisYaml = stringifyYaml({
      system: { name: "Platform", description: "Multi-service platform" },
      relationships: [
        { sourceId: "mod-a1", targetId: "postgresql", label: "Reads/writes user profiles via JDBC" },
      ],
    });

    const responses = new Map<string, string>();
    responses.set("svc-a", stringifyYaml(partialA));
    responses.set("svc-b", stringifyYaml(partialB));
    responses.set("__synthesis__", synthesisYaml);

    const provider = makeMockProvider(responses);
    const config = makeConfig();

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    // The generic "Uses" label should be updated by synthesis
    const pgRel = result.relationships.find(
      (r) => r.sourceId === "mod-a1" && r.targetId === "postgresql",
    );
    expect(pgRel).toBeDefined();
    expect(pgRel!.label).toBe("Reads/writes user profiles via JDBC");
  });

  it("synthesis rollback restores actors and relationship labels", async () => {
    const raw = makeRawStructure([
      makeApp("svc-a", {
        modules: [
          {
            id: "mod-a1",
            path: "apps/svc-a/src/main",
            name: "svc-a.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
      makeApp("svc-b", {
        modules: [
          {
            id: "mod-b1",
            path: "apps/svc-b/src/main",
            name: "svc-b.main",
            files: ["Main.java"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
      }),
    ]);

    // Per-app models that include actors
    const partialA: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [
        { id: "user", name: "User", description: "Pre-synthesis actor from app A" },
      ],
      externalSystems: [],
      containers: [
        {
          id: "svc-a",
          applicationId: "svc-a",
          name: "Service A",
          description: "A",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-a1",
          containerId: "svc-a",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-a1"],
        },
      ],
      relationships: [],
    };

    const partialB: ArchitectureModel = {
      version: 1,
      system: { name: "", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "svc-b",
          applicationId: "svc-b",
          name: "Service B",
          description: "B",
          technology: "Java",
        },
      ],
      components: [
        {
          id: "mod-b1",
          containerId: "svc-b",
          name: "Main",
          description: "Core",
          technology: "Java",
          moduleIds: ["mod-b1"],
        },
      ],
      relationships: [],
    };

    let callCount = 0;
    const synthFailProvider: LLMProvider = {
      name: "synth-fail-mock",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (systemPrompt: string, userMessage: string) => {
        callCount++;
        const isSynthesis = systemPrompt.includes("synthesis agent");
        if (isSynthesis) {
          throw new LLMCallError("Synthesis timed out");
        }
        if (userMessage.includes("svc-b")) return stringifyYaml(partialB);
        return stringifyYaml(partialA);
      },
    };

    const config = makeConfig({
      system: { name: "Config Name", description: "Config Desc" },
    });
    const statuses: string[] = [];

    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider: synthFailProvider,
      onStatus: (s) => statuses.push(s),
    });

    // System info should be rolled back to config defaults
    expect(result.system.name).toBe("Config Name");

    // Actors should be rolled back to pre-synthesis state (from merged partials)
    expect(result.actors).toHaveLength(1);
    expect(result.actors[0].description).toBe("Pre-synthesis actor from app A");

    // Warning should mention the full rollback scope
    const rollbackMsg = statuses.find((s) => s.includes("rolling back"));
    expect(rollbackMsg).toBeDefined();
    expect(rollbackMsg).toContain("actors");
    expect(rollbackMsg).toContain("relationship labels");
  });

  it("creates its own UI when onStatus/onProgress are omitted", async () => {
    const provider: LLMProvider = {
      name: "test-provider",
      supportsTools: false,
      isAvailable: () => true,
      generate: async (_sys, userMessage, _model, _onProgress) => {
        const isSynthesis = _sys.includes("synthesis agent");
        if (isSynthesis) {
          return stringifyYaml({
            system: { name: "Test", description: "test" },
          });
        }
        const appId = userMessage.includes("app-a") ? "app-a" : "app-b";
        return stringifyYaml(makePartialModel({
          system: { name: "Test", description: "test" },
          containers: [{ id: appId, applicationId: appId, name: appId, description: "c", technology: "java" }],
          components: [],
          relationships: [],
        }));
      },
    };

    const raw = makeRawStructure([makeApp("app-a"), makeApp("app-b")]);
    const config = configSchema.parse({
      system: { name: "Test", description: "test" },
      llm: { model: "test", concurrency: 2 },
    });

    // Call WITHOUT onStatus/onProgress — should not throw
    const result = await buildModelParallel({
      rawStructure: raw,
      config,
      provider,
    });

    expect(result.containers.length).toBeGreaterThanOrEqual(2);
  });
});
