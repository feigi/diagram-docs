import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { javaAnalyzer } from "../../src/analyzers/java/index.js";
import {
  parseJavaImports,
  parseJavaPackage,
} from "../../src/analyzers/java/imports.js";

const FIXTURES = path.resolve(
  __dirname,
  "../fixtures/monorepo/services/user-api",
);
const GRADLE_FIXTURES = path.resolve(
  __dirname,
  "../fixtures/gradle-multimodule",
);

const defaultConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: {
    granularity: "balanced" as const,
    excludePatterns: [],
  },
};

describe("Java Analyzer", () => {
  it("detects Java build file patterns", () => {
    expect(javaAnalyzer.buildFilePatterns).toContain("pom.xml");
    expect(javaAnalyzer.buildFilePatterns).toContain("build.gradle");
  });

  it("analyzes a Java application", async () => {
    const result = await javaAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.language).toBe("java");
    expect(result.buildFile).toBe("pom.xml");
    expect(result.modules.length).toBeGreaterThan(0);
    expect(result.externalDependencies.length).toBe(2);
    expect(
      result.externalDependencies.find((d) =>
        d.name.includes("spring-boot-starter-web"),
      ),
    ).toBeTruthy();
  });

  it("extracts packages with Spring annotations", async () => {
    const result = await javaAnalyzer.analyze(FIXTURES, defaultConfig);

    const controllerModule = result.modules.find((m) =>
      m.name.includes("user"),
    );
    expect(controllerModule).toBeTruthy();
    expect(controllerModule!.metadata["annotations"]).toContain(
      "RestController",
    );

    const repoModule = result.modules.find((m) => m.name.includes("repo"));
    expect(repoModule).toBeTruthy();
    expect(repoModule!.metadata["annotations"]).toContain("Repository");
  });
});

describe("Java Analyzer — Gradle multi-module", () => {
  it("excludes subproject directories from root scan", async () => {
    const result = await javaAnalyzer.analyze(GRADLE_FIXTURES, defaultConfig);
    // Root has settings.gradle with include 'app' and 'lib'
    // Root has no src/main/java, so without exclusion it would scan app/ and lib/
    // With exclusion, it should find 0 modules
    expect(result.modules).toHaveLength(0);
  });

  it("parses Gradle dependencies as externalDependencies", async () => {
    const appPath = path.join(GRADLE_FIXTURES, "app");
    const result = await javaAnalyzer.analyze(appPath, defaultConfig);

    expect(
      result.externalDependencies.some((d) =>
        d.name.includes("spring-boot-starter-web"),
      ),
    ).toBe(true);
  });

  it("populates internalImports for project deps", async () => {
    const appPath = path.join(GRADLE_FIXTURES, "app");
    const result = await javaAnalyzer.analyze(appPath, defaultConfig);

    expect(result.internalImports).toHaveLength(1);
    expect(result.internalImports[0].targetPath).toBe("lib");
  });

  it("sets publishedAs from group and artifact name", async () => {
    const appPath = path.join(GRADLE_FIXTURES, "app");
    const result = await javaAnalyzer.analyze(appPath, defaultConfig);

    // app is a subproject of 'my-system', so artifact is 'app'
    // group is 'com.example.myapp'
    expect(result.publishedAs).toBe("com.example.myapp:app");
  });

  it("sets publishedAs using rootProject.name for root projects", async () => {
    const result = await javaAnalyzer.analyze(GRADLE_FIXTURES, defaultConfig);
    // Root project: rootProject.name = 'my-system', no group in root build.gradle
    expect(result.publishedAs).toBeUndefined();
  });

  it("sets publishedAs for lib subproject", async () => {
    const libPath = path.join(GRADLE_FIXTURES, "lib");
    const result = await javaAnalyzer.analyze(libPath, defaultConfig);
    expect(result.publishedAs).toBe("com.example.mylib:lib");
  });
});

describe("Java Imports Parser", () => {
  const controllerPath = path.join(
    FIXTURES,
    "src/main/java/com/example/user/UserController.java",
  );

  it("parses import statements", () => {
    const imports = parseJavaImports(controllerPath);
    expect(imports.length).toBeGreaterThan(0);
    expect(
      imports.some((i) => i.source === "com.example.repo.UserRepository"),
    ).toBe(true);
    expect(imports.some((i) => i.source.includes("springframework"))).toBe(
      true,
    );
  });

  it("parses package declaration", () => {
    const pkg = parseJavaPackage(controllerPath);
    expect(pkg).toBe("com.example.user");
  });

  it("returns [] for a non-existent file", () => {
    const result = parseJavaImports("/nonexistent/path/Foo.java");
    expect(result).toEqual([]);
  });

  it("returns null for a non-existent file in parseJavaPackage", () => {
    const result = parseJavaPackage("/nonexistent/path/Foo.java");
    expect(result).toBeNull();
  });
});
