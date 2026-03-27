import { describe, it, expect } from "vitest";
import {
  rollUpShellParents,
  matchCrossAppCoordinates,
} from "../../src/core/scan.js";
import type { ScannedApplication } from "../../src/analyzers/types.js";

function makeApp(overrides: Partial<ScannedApplication>): ScannedApplication {
  return {
    id: "app",
    path: "app",
    name: "App",
    language: "java",
    buildFile: "build.gradle",
    modules: [],
    externalDependencies: [],
    internalImports: [],
    ...overrides,
  };
}

const MODULE_A = {
  id: "mod-a",
  path: "src/main/java/com/example/a",
  name: "com.example.a",
  files: ["A.java"],
  exports: ["A"],
  imports: [],
  metadata: {},
};

const MODULE_B = {
  id: "mod-b",
  path: "src/main/java/com/example/b",
  name: "com.example.b",
  files: ["B.java"],
  exports: ["B"],
  imports: [],
  metadata: {},
};

describe("rollUpShellParents", () => {
  it("returns apps unchanged when no shell parents exist", () => {
    const apps = [
      makeApp({ id: "svc-a", path: "svc-a", modules: [MODULE_A] }),
      makeApp({ id: "svc-b", path: "svc-b", modules: [MODULE_B] }),
    ];
    const result = rollUpShellParents(apps);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id).sort()).toEqual(["svc-a", "svc-b"]);
  });

  it("rolls up single child into parent identity", () => {
    const apps = [
      makeApp({
        id: "los-cha",
        path: "los-cha",
        name: "Los Cha",
        modules: [],
      }),
      makeApp({
        id: "los-cha-app",
        path: "los-cha/app",
        name: "app",
        language: "java",
        modules: [MODULE_A, MODULE_B],
        externalDependencies: [{ name: "spring-boot" }],
        publishedAs: "com.example:los-cha",
      }),
    ];

    const result = rollUpShellParents(apps);

    expect(result).toHaveLength(1);
    const merged = result[0];
    expect(merged.id).toBe("los-cha");
    expect(merged.path).toBe("los-cha");
    expect(merged.name).toBe("Los Cha");
    expect(merged.modules).toHaveLength(2);
    expect(merged.externalDependencies).toEqual([{ name: "spring-boot" }]);
    expect(merged.publishedAs).toBe("com.example:los-cha");
    expect(merged.language).toBe("java");
  });

  it("merges multiple children into parent", () => {
    const apps = [
      makeApp({
        id: "los-tariffdb",
        path: "los-tariffdb",
        name: "Los Tariffdb",
        modules: [],
      }),
      makeApp({
        id: "los-tariffdb-migration",
        path: "los-tariffdb/migration",
        name: "migration",
        modules: [MODULE_A],
        externalDependencies: [{ name: "flyway" }],
      }),
      makeApp({
        id: "los-tariffdb-model",
        path: "los-tariffdb/model",
        name: "model",
        modules: [MODULE_B],
        externalDependencies: [{ name: "flyway" }, { name: "hibernate" }],
      }),
    ];

    const result = rollUpShellParents(apps);

    expect(result).toHaveLength(1);
    const merged = result[0];
    expect(merged.id).toBe("los-tariffdb");
    expect(merged.path).toBe("los-tariffdb");
    expect(merged.name).toBe("Los Tariffdb");
    expect(merged.modules).toHaveLength(2);
    // External deps deduplicated by name
    expect(merged.externalDependencies).toHaveLength(2);
    expect(merged.externalDependencies.map((d) => d.name).sort()).toEqual([
      "flyway",
      "hibernate",
    ]);
  });

  it("rewrites internalImports.targetApplicationId in other apps", () => {
    const apps = [
      makeApp({
        id: "los-cha",
        path: "los-cha",
        modules: [],
      }),
      makeApp({
        id: "los-cha-app",
        path: "los-cha/app",
        modules: [MODULE_A],
      }),
      makeApp({
        id: "los-ahu",
        path: "los-ahu",
        modules: [MODULE_B],
        internalImports: [
          {
            sourceModuleId: "los-ahu",
            targetApplicationId: "los-cha-app",
            targetPath: "los-cha/app",
          },
        ],
      }),
    ];

    const result = rollUpShellParents(apps);

    const ahu = result.find((a) => a.id === "los-ahu")!;
    expect(ahu.internalImports).toHaveLength(1);
    expect(ahu.internalImports[0].targetApplicationId).toBe("los-cha");
    expect(ahu.internalImports[0].targetPath).toBe("los-cha");
  });

  it("removes intra-group internalImports during merge", () => {
    const apps = [
      makeApp({
        id: "los-tariffdb",
        path: "los-tariffdb",
        modules: [],
      }),
      makeApp({
        id: "los-tariffdb-migration",
        path: "los-tariffdb/migration",
        modules: [MODULE_A],
        internalImports: [
          {
            sourceModuleId: "los-tariffdb-migration",
            targetApplicationId: "los-tariffdb-model",
            targetPath: "los-tariffdb/model",
          },
        ],
      }),
      makeApp({
        id: "los-tariffdb-model",
        path: "los-tariffdb/model",
        modules: [MODULE_B],
        internalImports: [
          {
            sourceModuleId: "los-tariffdb-model",
            targetApplicationId: "los-external-svc",
            targetPath: "los-external-svc",
          },
        ],
      }),
      makeApp({
        id: "los-external-svc",
        path: "los-external-svc",
        modules: [MODULE_A],
      }),
    ];

    const result = rollUpShellParents(apps);

    const tariffdb = result.find((a) => a.id === "los-tariffdb")!;
    // Intra-group import (migration→model) removed, external import kept
    expect(tariffdb.internalImports).toHaveLength(1);
    expect(tariffdb.internalImports[0].targetApplicationId).toBe(
      "los-external-svc",
    );
  });

  it("does NOT roll up root shell parent at '.'", () => {
    const apps = [
      makeApp({
        id: "root",
        path: ".",
        modules: [],
      }),
      makeApp({
        id: "svc-a",
        path: "svc-a",
        modules: [MODULE_A],
      }),
      makeApp({
        id: "svc-b",
        path: "svc-b",
        modules: [MODULE_B],
      }),
    ];

    const result = rollUpShellParents(apps);

    // Root stays, children stay — no roll-up
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id).sort()).toEqual([
      "root",
      "svc-a",
      "svc-b",
    ]);
  });

  it("only considers direct children (one level deeper)", () => {
    const apps = [
      makeApp({
        id: "parent",
        path: "parent",
        modules: [],
      }),
      makeApp({
        id: "parent-child",
        path: "parent/child",
        modules: [],
      }),
      makeApp({
        id: "parent-child-grandchild",
        path: "parent/child/grandchild",
        modules: [MODULE_A],
      }),
    ];

    const result = rollUpShellParents(apps);

    // parent/child is a shell parent of grandchild → rolls up grandchild
    // parent is a shell parent of parent/child (direct child) → rolls up the 0-module child
    // grandchild is NOT a direct child of parent (two levels deep)
    // Net result: parent (0 modules from original child) + parent-child (grandchild's modules)
    expect(result).toHaveLength(2);
    // parent-child rolled up grandchild
    const child = result.find((a) => a.id === "parent-child");
    expect(child).toBeDefined();
    expect(child!.modules).toHaveLength(1);
  });

  it("merges configFiles from all children", () => {
    const apps = [
      makeApp({
        id: "svc",
        path: "svc",
        modules: [],
      }),
      makeApp({
        id: "svc-app",
        path: "svc/app",
        modules: [MODULE_A],
        configFiles: [{ path: "application.yml", content: "port: 8080" }],
      }),
    ];

    const result = rollUpShellParents(apps);

    expect(result).toHaveLength(1);
    expect(result[0].configFiles).toHaveLength(1);
    expect(result[0].configFiles![0].path).toBe("application.yml");
  });
});
