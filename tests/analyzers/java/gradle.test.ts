import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { parseSettingsGradle } from "../../../src/analyzers/java/gradle.js";

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
    const result = parseSettingsGradle(
      path.join(FIXTURES, "with-projectdir"),
    );
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
});
