import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { parseTypeScriptImports } from "../../src/analyzers/typescript/imports.js";

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
