import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { parseTypeScriptImports } from "../../src/analyzers/typescript/imports.js";
import { extractTypeScriptModules } from "../../src/analyzers/typescript/modules.js";
import { typescriptAnalyzer } from "../../src/analyzers/typescript/index.js";

const FIXTURES = path.resolve(
  __dirname,
  "../fixtures/monorepo/services/api-gateway",
);

const defaultConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: {
    granularity: "balanced" as const,
    excludePatterns: [],
  },
};

describe("TypeScript Imports Parser", () => {
  it("parses ES module static imports", () => {
    const imports = parseTypeScriptImports(
      path.join(FIXTURES, "src/routes/users.ts"),
    );

    expect(imports.some((i) => i.source === "express")).toBe(true);
    expect(imports.some((i) => i.source === "zod")).toBe(true);
  });

  it("parses relative imports", () => {
    const imports = parseTypeScriptImports(
      path.join(FIXTURES, "src/routes/users.ts"),
    );

    const authImport = imports.find((i) => i.source === "../middleware/auth");
    expect(authImport).toBeTruthy();
    expect(authImport!.isRelative).toBe(true);
  });

  it("classifies bare specifiers as non-relative", () => {
    const imports = parseTypeScriptImports(
      path.join(FIXTURES, "src/routes/users.ts"),
    );

    const expressImport = imports.find((i) => i.source === "express");
    expect(expressImport).toBeTruthy();
    expect(expressImport!.isRelative).toBe(false);
  });

  it("parses import type statements", () => {
    const imports = parseTypeScriptImports(
      path.join(FIXTURES, "src/routes/index.ts"),
    );

    expect(imports.some((i) => i.source === "express")).toBe(true);
  });

  it("parses multi-line imports", () => {
    const tmpFile = path.join(os.tmpdir(), "dd-test-multiline.ts");
    fs.writeFileSync(tmpFile, [
      'import {',
      '  Controller,',
      '  Get,',
      '  Post,',
      '} from "@nestjs/common";',
      'import { Injectable } from "@nestjs/core";',
    ].join("\n"), "utf-8");
    try {
      const imports = parseTypeScriptImports(tmpFile);
      expect(imports.some((i) => i.source === "@nestjs/common")).toBe(true);
      expect(imports.some((i) => i.source === "@nestjs/core")).toBe(true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("TypeScript Imports Parser - error handling", () => {
  it("throws on missing file", () => {
    expect(() =>
      parseTypeScriptImports("/nonexistent/path/file.ts"),
    ).toThrow();
  });
});

describe("TypeScript Module Discovery", () => {
  it("discovers modules from tsconfig source roots", async () => {
    const modules = await extractTypeScriptModules(FIXTURES, defaultConfig.exclude);

    expect(modules.length).toBeGreaterThan(0);
    const moduleNames = modules.map((m) => m.name);
    expect(moduleNames).toContain("routes");
    expect(moduleNames).toContain("middleware");
  });

  it("groups root-level files into a root module", async () => {
    const modules = await extractTypeScriptModules(FIXTURES, defaultConfig.exclude);

    const rootModule = modules.find((m) => m.path === ".");
    expect(rootModule).toBeTruthy();
    expect(rootModule!.files.some((f) => f.endsWith("index.ts"))).toBe(true);
  });

  it("extracts exports from TypeScript files", async () => {
    const modules = await extractTypeScriptModules(FIXTURES, defaultConfig.exclude);

    const routesModule = modules.find((m) => m.name === "routes");
    expect(routesModule).toBeTruthy();
    expect(routesModule!.exports).toContain("registerRoutes");
    expect(routesModule!.exports).toContain("usersRouter");
    expect(routesModule!.exports).toContain("User");
  });
});

describe("TypeScript Analyzer", () => {
  it("detects TypeScript build file patterns", () => {
    expect(typescriptAnalyzer.buildFilePatterns).toContain("tsconfig.json");
  });

  it("analyzes a TypeScript application", async () => {
    const result = await typescriptAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.language).toBe("typescript");
    expect(result.buildFile).toBe("tsconfig.json");
    expect(result.modules.length).toBeGreaterThan(0);

    const routesModule = result.modules.find((m) => m.name === "routes");
    expect(routesModule).toBeTruthy();
    expect(routesModule!.files.length).toBeGreaterThan(0);
  });

  it("extracts external dependencies from package.json", async () => {
    const result = await typescriptAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.externalDependencies.some((d) => d.name === "express")).toBe(true);
    expect(result.externalDependencies.some((d) => d.name === "zod")).toBe(true);
    // devDependencies should NOT appear
    expect(result.externalDependencies.some((d) => d.name === "typescript")).toBe(false);
  });

  it("excludes file: deps from externalDependencies and writes internalImports", async () => {
    const result = await typescriptAnalyzer.analyze(FIXTURES, defaultConfig);

    // file: dep should not be in external deps
    expect(result.externalDependencies.some((d) => d.name === "@monorepo/shared-lib")).toBe(false);

    // Should have an internalImport for the file: dep
    expect(result.internalImports.length).toBeGreaterThan(0);
    expect(result.internalImports[0].targetPath).toContain("shared-lib");
  });

  it("sets publishedAs from package.json name", async () => {
    const result = await typescriptAnalyzer.analyze(FIXTURES, defaultConfig);

    expect(result.publishedAs).toBe("@monorepo/api-gateway");
  });

  it("detects Express framework in module metadata", async () => {
    const result = await typescriptAnalyzer.analyze(FIXTURES, defaultConfig);

    const routesModule = result.modules.find((m) => m.name === "routes");
    expect(routesModule?.metadata["framework"]).toBe("Express");
  });

  it("classifies internal vs external imports", async () => {
    const result = await typescriptAnalyzer.analyze(FIXTURES, defaultConfig);

    const routesModule = result.modules.find((m) => m.name === "routes");
    const externalImports = routesModule!.imports.filter((i) => i.isExternal);
    const internalImports = routesModule!.imports.filter((i) => !i.isExternal);

    expect(externalImports.some((i) => i.source === "express")).toBe(true);
    expect(internalImports.some((i) => i.source === "../middleware/auth")).toBe(true);
  });
});
