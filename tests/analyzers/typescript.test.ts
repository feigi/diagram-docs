import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { parseTypeScriptImports } from "../../src/analyzers/typescript/imports.js";
import { extractTypeScriptModules } from "../../src/analyzers/typescript/modules.js";

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
