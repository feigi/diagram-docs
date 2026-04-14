import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { pythonAnalyzer } from "../../src/analyzers/python/index.js";
import { parsePythonImports } from "../../src/analyzers/python/imports.js";

const FIXTURES = path.resolve(
  __dirname,
  "../fixtures/monorepo/services/order-service",
);

const defaultConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: {
    granularity: "balanced" as const,
    excludePatterns: [],
  },
};

describe("Python Analyzer", () => {
  it("detects Python build file patterns", () => {
    expect(pythonAnalyzer.buildFilePatterns).toContain("pyproject.toml");
    expect(pythonAnalyzer.buildFilePatterns).toContain("requirements.txt");
  });

  it("analyzes a Python application", async () => {
    const result = await pythonAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.language).toBe("python");
    expect(result.buildFile).toBe("pyproject.toml");
    expect(result.modules.length).toBeGreaterThan(0);

    // Should find the orders module
    const ordersModule = result.modules.find((m) => m.name === "orders");
    expect(ordersModule).toBeTruthy();
    expect(ordersModule!.files.length).toBeGreaterThan(0);
  });

  it("detects FastAPI framework", async () => {
    const result = await pythonAnalyzer.analyze(FIXTURES, defaultConfig);

    const ordersModule = result.modules.find((m) => m.name === "orders");
    expect(ordersModule?.metadata["framework"]).toBe("fastapi");
  });

  it("extracts external dependencies from pyproject.toml", async () => {
    const result = await pythonAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.externalDependencies.length).toBe(3);
    expect(result.externalDependencies.some((d) => d.name === "fastapi")).toBe(
      true,
    );
    expect(
      result.externalDependencies.some((d) => d.name === "sqlalchemy"),
    ).toBe(true);
  });

  it("extracts class exports", async () => {
    const result = await pythonAnalyzer.analyze(FIXTURES, defaultConfig);

    const ordersModule = result.modules.find((m) => m.name === "orders");
    expect(ordersModule!.exports).toContain("Order");
    expect(ordersModule!.exports).toContain("OrderHandler");
  });

  it("populates codeElements on each module when levels.code is on", async () => {
    const result = await pythonAnalyzer.analyze(FIXTURES, {
      ...defaultConfig,
      levels: { context: true, container: true, component: true, code: true },
      code: { includePrivate: false, includeMembers: true, minElements: 2 },
    });
    const anyModuleHasCode = result.modules.some(
      (m) => m.codeElements && m.codeElements.length > 0,
    );
    expect(anyModuleHasCode).toBe(true);
  });

  it("omits codeElements when levels.code is off", async () => {
    const result = await pythonAnalyzer.analyze(FIXTURES, defaultConfig);
    for (const m of result.modules) {
      expect(m.codeElements).toBeUndefined();
    }
  });
});

describe("Python Imports Parser", () => {
  it("parses import and from...import statements", () => {
    const apiPath = path.join(FIXTURES, "orders/api.py");
    const imports = parsePythonImports(apiPath);

    expect(imports.some((i) => i.source === "fastapi")).toBe(true);
    expect(imports.some((i) => i.source === "orders.models")).toBe(true);
    expect(imports.some((i) => i.source === "orders.db")).toBe(true);
  });

  it("returns [] for a non-existent file", () => {
    const result = parsePythonImports("/nonexistent/path/module.py");
    expect(result).toEqual([]);
  });
});
