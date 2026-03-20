import { describe, it, expect } from "vitest";
import { buildModel } from "../../src/core/model-builder.js";
import type { RawStructure } from "../../src/analyzers/types.js";
import { configSchema } from "../../src/config/schema.js";

function makeConfig(overrides = {}) {
  return configSchema.parse(overrides);
}

function makeRawStructure(
  apps: RawStructure["applications"] = [],
): RawStructure {
  return {
    version: 1,
    scannedAt: "2026-01-01T00:00:00Z",
    checksum: "test",
    applications: apps,
  };
}

describe("buildModel", () => {
  it("produces a valid model with system info from config", () => {
    const config = makeConfig({
      system: { name: "Test System", description: "A test" },
    });
    const raw = makeRawStructure();
    const model = buildModel({ config, rawStructure: raw });

    expect(model.version).toBe(1);
    expect(model.system.name).toBe("Test System");
    expect(model.system.description).toBe("A test");
    expect(model.actors).toEqual([]);
  });

  it("creates containers from applications", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "services-user-api",
        path: "services/user-api",
        name: "user-api",
        language: "java",
        buildFile: "pom.xml",
        modules: [],
        externalDependencies: [{ name: "spring-boot-starter-web" }],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(model.containers).toHaveLength(1);
    expect(model.containers[0].id).toBe("services-user-api");
    expect(model.containers[0].name).toBe("User Api");
    expect(model.containers[0].technology).toBe("Java / Spring Boot");
    expect(model.containers[0].path).toBe("services/user-api");
  });

  it("creates components from modules", () => {
    const config = makeConfig({
      abstraction: { granularity: "detailed" },
    });
    const raw = makeRawStructure([
      {
        id: "services-user-api",
        path: "services/user-api",
        name: "user-api",
        language: "java",
        buildFile: "pom.xml",
        modules: [
          {
            id: "services-user-api-com-example-user",
            path: "src/main/java/com/example/user",
            name: "com.example.user",
            files: ["UserController.java"],
            exports: ["UserController"],
            imports: [],
            metadata: { "spring.stereotype": "Controller" },
          },
          {
            id: "services-user-api-com-example-repo",
            path: "src/main/java/com/example/repo",
            name: "com.example.repo",
            files: ["UserRepository.java"],
            exports: ["UserRepository"],
            imports: [],
            metadata: { "spring.stereotype": "Repository" },
          },
        ],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(model.components).toHaveLength(2);
    expect(model.components[0].containerId).toBe("services-user-api");
    expect(model.components[0].name).toBe("User");
    expect(model.components[0].technology).toBe("Spring MVC");
    expect(model.components[1].name).toBe("Repo");
    expect(model.components[1].technology).toBe("Spring Data JPA");
  });

  it("produces one component per container in overview mode", () => {
    const config = makeConfig({
      abstraction: { granularity: "overview" },
    });
    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "python",
        buildFile: "pyproject.toml",
        modules: [
          {
            id: "app-models",
            path: "models",
            name: "models",
            files: ["models.py"],
            exports: [],
            imports: [],
            metadata: {},
          },
          {
            id: "app-views",
            path: "views",
            name: "views",
            files: ["views.py"],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(model.components).toHaveLength(1);
    expect(model.components[0].id).toBe("app-core");
    expect(model.components[0].moduleIds).toEqual(["app-models", "app-views"]);
  });

  it("filters modules by excludePatterns in balanced mode", () => {
    const config = makeConfig({
      abstraction: {
        granularity: "balanced",
        excludePatterns: ["utils", "config"],
      },
    });
    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "python",
        buildFile: "pyproject.toml",
        modules: [
          {
            id: "app-api",
            path: "api",
            name: "api",
            files: [],
            exports: [],
            imports: [],
            metadata: {},
          },
          {
            id: "app-utils",
            path: "utils",
            name: "utils",
            files: [],
            exports: [],
            imports: [],
            metadata: {},
          },
          {
            id: "app-config",
            path: "config",
            name: "config",
            files: [],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(model.components).toHaveLength(1);
    expect(model.components[0].name).toBe("Api");
  });

  it("promotes known external dependencies to external systems", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "python",
        buildFile: "pyproject.toml",
        modules: [],
        externalDependencies: [
          { name: "psycopg2" },
          { name: "redis" },
        ],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    // psycopg2 doesn't match, but redis does
    expect(model.externalSystems.some((e) => e.name === "Redis")).toBe(true);
  });

  it("deduplicates external systems across apps", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "app-a",
        path: "a",
        name: "a",
        language: "java",
        buildFile: "pom.xml",
        modules: [],
        externalDependencies: [{ name: "postgresql" }],
        internalImports: [],
      },
      {
        id: "app-b",
        path: "b",
        name: "b",
        language: "python",
        buildFile: "pyproject.toml",
        modules: [],
        externalDependencies: [{ name: "postgres" }],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    const pgSystems = model.externalSystems.filter((e) =>
      e.name === "PostgreSQL",
    );
    expect(pgSystems).toHaveLength(1);
  });

  it("creates cross-app relationships from internalImports", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "app-a",
        path: "a",
        name: "a",
        language: "java",
        buildFile: "pom.xml",
        modules: [],
        externalDependencies: [],
        internalImports: [
          {
            sourceModuleId: "app-a-core",
            targetApplicationId: "app-b",
            targetPath: "b/api",
          },
        ],
      },
      {
        id: "app-b",
        path: "b",
        name: "b",
        language: "python",
        buildFile: "pyproject.toml",
        modules: [],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(model.relationships).toContainEqual({
      sourceId: "app-a",
      targetId: "app-b",
      label: "Uses",
    });
  });

  it("creates intra-app relationships from module imports", () => {
    const config = makeConfig({
      abstraction: { granularity: "detailed" },
    });
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
            imports: [
              {
                source: "repo",
                resolved: "app-repo",
                isExternal: false,
              },
            ],
            metadata: {},
          },
          {
            id: "app-repo",
            path: "repo",
            name: "repo",
            files: [],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(
      model.relationships.some(
        (r) =>
          r.sourceId === "app-controller" && r.targetId === "app-repo",
      ),
    ).toBe(true);
  });

  it("deduplicates relationships between same source/target", () => {
    const config = makeConfig({
      abstraction: { granularity: "detailed" },
    });
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
            imports: [
              { source: "repo.a", resolved: "app-repo", isExternal: false },
              { source: "repo.b", resolved: "app-repo", isExternal: false },
            ],
            metadata: {},
          },
          {
            id: "app-repo",
            path: "repo",
            name: "repo",
            files: [],
            exports: [],
            imports: [],
            metadata: {},
          },
        ],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    const controllerToRepo = model.relationships.filter(
      (r) => r.sourceId === "app-controller" && r.targetId === "app-repo",
    );
    expect(controllerToRepo).toHaveLength(1);
  });

  it("is deterministic across runs", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "app-a",
        path: "a",
        name: "a",
        language: "java",
        buildFile: "pom.xml",
        modules: [],
        externalDependencies: [{ name: "redis" }],
        internalImports: [],
      },
    ]);
    const a = buildModel({ config, rawStructure: raw });
    const b = buildModel({ config, rawStructure: raw });

    expect(a).toEqual(b);
  });
});
