import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { cAnalyzer } from "../../src/analyzers/c/index.js";
import { parseCIncludes } from "../../src/analyzers/c/includes.js";

const FIXTURES = path.resolve(__dirname, "../fixtures/monorepo/libs/mathlib");

const defaultConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: {
    granularity: "balanced" as const,
    excludePatterns: [],
  },
};

describe("C Analyzer", () => {
  it("detects C build file patterns", () => {
    expect(cAnalyzer.buildFilePatterns).toContain("CMakeLists.txt");
    expect(cAnalyzer.buildFilePatterns).toContain("Makefile");
  });

  it("analyzes a C project", async () => {
    const result = await cAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.language).toBe("c");
    expect(result.buildFile).toBe("CMakeLists.txt");
    expect(result.modules.length).toBeGreaterThan(0);
  });

  it("separates headers and sources into modules", async () => {
    const result = await cAnalyzer.analyze(FIXTURES, defaultConfig);

    // Should have modules for include/ and src/ directories
    expect(result.modules.length).toBeGreaterThanOrEqual(2);

    const includeModule = result.modules.find((m) =>
      m.files.some((f) => f.endsWith(".h")),
    );
    expect(includeModule).toBeTruthy();
    expect(includeModule!.exports.length).toBeGreaterThan(0);
  });
});

describe("C Includes Parser", () => {
  it("parses #include statements", () => {
    const srcPath = path.join(FIXTURES, "src/math.c");
    const includes = parseCIncludes(srcPath);

    expect(includes.length).toBe(2);
    expect(
      includes.find((i) => i.path === "math_ops.h" && !i.isSystem),
    ).toBeTruthy();
    expect(
      includes.find((i) => i.path === "stdio.h" && i.isSystem),
    ).toBeTruthy();
  });

  it("throws for a non-existent file", () => {
    expect(() => parseCIncludes("/nonexistent/path/file.c")).toThrow();
  });
});
