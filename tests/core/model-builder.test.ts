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
            metadata: { annotations: "Controller" },
          },
          {
            id: "services-user-api-com-example-repo",
            path: "src/main/java/com/example/repo",
            name: "com.example.repo",
            files: ["UserRepository.java"],
            exports: ["UserRepository"],
            imports: [],
            metadata: { annotations: "Repository" },
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

  it("groups deeply-nested Java packages into multiple components in balanced mode", () => {
    const config = makeConfig({
      abstraction: {
        granularity: "balanced",
        excludePatterns: [],
      },
    });

    // Simulate a Java app with 25+ modules sharing a deep common prefix
    const prefix = "com.example.app";
    const packages = [
      "api", "api.controller", "api.mapper", "api.model", "api.filter",
      "api.config", "api.validator", "api.serializer",
      "domain", "domain.model", "domain.service", "domain.exceptions",
      "domain.events", "domain.context",
      "infrastructure", "infrastructure.db", "infrastructure.db.mapper",
      "infrastructure.db.model", "infrastructure.cache",
      "infrastructure.search", "infrastructure.search.mapper",
      "infrastructure.search.model",
      "config", "metrics", "utils",
    ];

    const modules = packages.map((pkg) => ({
      id: `app-${pkg.replace(/\./g, "-")}`,
      path: `src/main/java/${prefix.replace(/\./g, "/")}/${pkg.replace(/\./g, "/")}`,
      name: `${prefix}.${pkg}`,
      files: ["Foo.java"],
      exports: ["Foo"],
      imports: [],
      metadata: {},
    }));

    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "java",
        buildFile: "build.gradle",
        modules,
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    // Should produce multiple components, not collapse to 1
    expect(model.components.length).toBeGreaterThan(1);
    expect(model.components.length).toBeLessThanOrEqual(20);

    // Each component should carry all grouped module IDs
    const totalModuleIds = model.components.flatMap((c) => c.moduleIds);
    expect(totalModuleIds).toHaveLength(modules.length);
  });

  it("groups modules from sibling top-level packages correctly", () => {
    const config = makeConfig({
      abstraction: {
        granularity: "balanced",
        excludePatterns: [],
      },
    });

    // Three sibling packages: charging, chargingcn, chargingrow
    const modules = [
      "com.bmw.los.next.charging.api",
      "com.bmw.los.next.charging.api.controller",
      "com.bmw.los.next.charging.api.mapper",
      "com.bmw.los.next.charging.domain",
      "com.bmw.los.next.charging.domain.model",
      "com.bmw.los.next.charging.domain.service",
      "com.bmw.los.next.charging.infrastructure",
      "com.bmw.los.next.charging.infrastructure.db",
      "com.bmw.los.next.charging.infrastructure.search",
      "com.bmw.los.next.chargingcn.api",
      "com.bmw.los.next.chargingcn.domain",
      "com.bmw.los.next.chargingcn.infrastructure",
      "com.bmw.los.next.chargingrow.api",
      "com.bmw.los.next.chargingrow.domain",
      "com.bmw.los.next.chargingrow.infrastructure",
      "com.bmw.los.next.charging.api.filter",
      "com.bmw.los.next.charging.api.model",
      "com.bmw.los.next.charging.domain.exceptions",
      "com.bmw.los.next.charging.domain.context",
      "com.bmw.los.next.charging.infrastructure.cache",
      "com.bmw.los.next.charging.infrastructure.search.mapper",
    ].map((name) => ({
      id: `app-${name.replace(/\./g, "-")}`,
      path: `src/main/java/${name.replace(/\./g, "/")}`,
      name,
      files: ["Foo.java"],
      exports: ["Foo"],
      imports: [],
      metadata: {},
    }));

    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "java",
        buildFile: "build.gradle",
        modules,
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    // Should have separate groups for charging/chargingcn/chargingrow subpackages
    expect(model.components.length).toBeGreaterThan(3);
    expect(model.components.length).toBeLessThanOrEqual(20);

    // Verify all module IDs are accounted for
    const totalModuleIds = model.components.flatMap((c) => c.moduleIds);
    expect(totalModuleIds).toHaveLength(modules.length);
  });

  it("creates external systems from config", () => {
    const config = makeConfig({
      externalSystems: [
        { name: "Redis", technology: "Cache" },
        { name: "OpenSearch", technology: "Search Engine" },
      ],
    });
    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "python",
        buildFile: "pyproject.toml",
        modules: [],
        externalDependencies: [{ name: "redis" }],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    expect(model.externalSystems).toHaveLength(2);
    expect(model.externalSystems.some((e) => e.name === "Redis")).toBe(true);
    expect(model.externalSystems.some((e) => e.name === "OpenSearch")).toBe(true);
  });

  it("creates relationships from config usedBy", () => {
    const config = makeConfig({
      externalSystems: [
        { name: "PostgreSQL", technology: "Database", usedBy: ["app-a", "app-b"] },
      ],
    });
    const raw = makeRawStructure([
      {
        id: "app-a",
        path: "a",
        name: "a",
        language: "java",
        buildFile: "pom.xml",
        modules: [],
        externalDependencies: [],
        internalImports: [],
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

    expect(model.externalSystems).toHaveLength(1);
    expect(model.externalSystems[0].name).toBe("PostgreSQL");
    // Both apps should have relationships to PostgreSQL
    const pgRels = model.relationships.filter((r) => r.targetId === "postgresql");
    expect(pgRels).toHaveLength(2);
    expect(pgRels.map((r) => r.sourceId).sort()).toEqual(["app-a", "app-b"]);
  });

  it("produces no external systems without config", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "app",
        path: "app",
        name: "app",
        language: "java",
        buildFile: "pom.xml",
        modules: [],
        externalDependencies: [{ name: "org.postgresql:postgresql" }],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    // Without config, no external systems are created (deterministic path is config-only)
    expect(model.externalSystems).toHaveLength(0);
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

  it("excludes root shell parent at '.' with child apps", () => {
    const config = makeConfig();
    const raw = makeRawStructure([
      {
        id: "",
        path: ".",
        name: "los-cha",
        language: "java",
        buildFile: "build.gradle",
        modules: [],
        externalDependencies: [],
        internalImports: [],
      },
      {
        id: "services-api",
        path: "services/api",
        name: "api",
        language: "java",
        buildFile: "build.gradle",
        modules: [
          {
            id: "services-api-com-example",
            path: "src/main/java/com/example",
            name: "com.example",
            files: ["Main.java"],
            exports: ["Main"],
            imports: [],
            metadata: {},
          },
        ],
        externalDependencies: [],
        internalImports: [],
      },
    ]);
    const model = buildModel({ config, rawStructure: raw });

    // Root shell parent should be excluded — only the child container remains
    expect(model.containers).toHaveLength(1);
    expect(model.containers[0].id).toBe("services-api");
  });

  it("is deterministic across runs", () => {
    const config = makeConfig({
      externalSystems: [{ name: "Redis", technology: "Cache", usedBy: ["app-a"] }],
    });
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
