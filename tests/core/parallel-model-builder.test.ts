import { describe, it, expect } from "vitest";
import {
  splitRawStructure,
  mergePartialModels,
} from "../../src/core/parallel-model-builder.js";
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
