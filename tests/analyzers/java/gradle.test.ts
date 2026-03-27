import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  parseSettingsGradle,
  parseGradleDependencies,
} from "../../../src/analyzers/java/gradle.js";

const FIXTURES = path.resolve(__dirname, "../../fixtures/gradle-multimodule");

describe("parseSettingsGradle", () => {
  it("extracts root project name and subprojects", () => {
    const result = parseSettingsGradle(FIXTURES);
    expect(result).not.toBeNull();
    expect(result!.rootProjectName).toBe("my-system");
    expect(result!.subprojects).toEqual([
      { name: "app", dir: "app" },
      { name: "lib", dir: "lib" },
    ]);
  });

  it("handles projectDir overrides", () => {
    const result = parseSettingsGradle(path.join(FIXTURES, "with-projectdir"));
    expect(result).not.toBeNull();
    expect(result!.rootProjectName).toBe("my-db");
    expect(result!.subprojects).toEqual([
      { name: "my-db-model", dir: "model" },
    ]);
  });

  it("returns null when no settings file exists", () => {
    const result = parseSettingsGradle("/tmp/nonexistent-dir");
    expect(result).toBeNull();
  });

  it("handles settings.gradle.kts (Kotlin DSL)", () => {
    const result = parseSettingsGradle(path.join(FIXTURES, "kts-project"));
    expect(result).not.toBeNull();
    expect(result!.rootProjectName).toBe("kts-system");
    expect(result!.subprojects).toEqual([
      { name: "api", dir: "api" },
      { name: "core", dir: "core" },
    ]);
  });
});

describe("parseGradleDependencies", () => {
  it("extracts group, project deps, and maven deps", () => {
    const buildFile = path.join(FIXTURES, "app", "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(result.group).toBe("com.example.myapp");
    expect(result.projectDeps).toEqual(["lib"]);
    expect(result.mavenDeps).toContainEqual({
      group: "org.springframework.boot",
      artifact: "spring-boot-starter-web",
    });
    expect(result.mavenDeps).toContainEqual({
      group: "com.bmw.losnext",
      artifact: "los-chargingdb-model",
      version: "4.1.4",
    });
  });

  it("returns empty results for shell build files", () => {
    const buildFile = path.join(FIXTURES, "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(result.group).toBeNull();
    expect(result.projectDeps).toEqual([]);
    expect(result.mavenDeps).toEqual([]);
  });

  it("handles Groovy shorthand group syntax (no equals sign)", () => {
    const buildFile = path.join(FIXTURES, "groovy-shorthand", "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(result.group).toBe("com.example.shorthand");
  });

  it("handles build.gradle.kts (Kotlin DSL)", () => {
    const buildFile = path.join(
      FIXTURES,
      "kts-project",
      "api",
      "build.gradle.kts",
    );
    const result = parseGradleDependencies(buildFile);

    expect(result.group).toBe("com.example.kts");
    expect(result.projectDeps).toEqual(["core"]);
    expect(result.mavenDeps).toContainEqual({
      group: "org.example",
      artifact: "kts-lib",
      version: "2.0",
    });
  });

  it("excludes test dependencies", () => {
    const buildFile = path.join(FIXTURES, "app", "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(
      result.mavenDeps.some((d) => d.artifact === "spring-boot-starter-test"),
    ).toBe(false);
  });
});
