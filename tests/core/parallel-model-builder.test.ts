import { describe, it, expect } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import {
  splitRawStructure,
  mergePartialModels,
  buildModelParallel,
} from "../../src/core/parallel-model-builder.js";
import type { LLMProvider, ProgressEvent } from "../../src/core/llm-model-builder.js";
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
});
