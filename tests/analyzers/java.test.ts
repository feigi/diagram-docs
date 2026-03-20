import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { javaAnalyzer } from "../../src/analyzers/java/index.js";
import { parseJavaImports, parseJavaPackage } from "../../src/analyzers/java/imports.js";

const FIXTURES = path.resolve(__dirname, "../fixtures/monorepo/services/user-api");

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
    expect(controllerModule!.metadata["spring.stereotypes"]).toContain(
      "@RestController",
    );

    const repoModule = result.modules.find((m) => m.name.includes("repo"));
    expect(repoModule).toBeTruthy();
    expect(repoModule!.metadata["spring.stereotypes"]).toContain(
      "@Repository",
    );
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
    expect(imports.some((i) => i.source === "com.example.repo.UserRepository")).toBe(true);
    expect(imports.some((i) => i.source.includes("springframework"))).toBe(true);
  });

  it("parses package declaration", () => {
    const pkg = parseJavaPackage(controllerPath);
    expect(pkg).toBe("com.example.user");
  });
});
