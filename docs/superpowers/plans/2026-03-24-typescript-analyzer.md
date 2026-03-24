# TypeScript Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TypeScript language analyzer that discovers TS projects by `tsconfig.json`, extracts modules/imports/dependencies, and integrates with the existing scan→model→generate pipeline.

**Architecture:** New `src/analyzers/typescript/` directory with three files (`index.ts`, `imports.ts`, `modules.ts`) following the same plugin pattern as Java/Python/C analyzers. Registered in `registry.ts`, type union extended in `types.ts`. Test fixture added to `tests/fixtures/monorepo/`.

**Tech Stack:** TypeScript, vitest, glob, regex-based parsing (no AST)

**Spec:** `docs/superpowers/specs/2026-03-24-typescript-analyzer-design.md`

---

### Task 1: Create test fixture

A small TypeScript app under the monorepo fixtures to test against.

**Files:**
- Create: `tests/fixtures/monorepo/services/api-gateway/tsconfig.json`
- Create: `tests/fixtures/monorepo/services/api-gateway/package.json`
- Create: `tests/fixtures/monorepo/services/api-gateway/src/routes/index.ts`
- Create: `tests/fixtures/monorepo/services/api-gateway/src/routes/users.ts`
- Create: `tests/fixtures/monorepo/services/api-gateway/src/middleware/auth.ts`
- Create: `tests/fixtures/monorepo/services/api-gateway/src/index.ts`

- [ ] **Step 1: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "@monorepo/api-gateway",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "zod": "^3.22.0",
    "@monorepo/shared-lib": "file:../../libs/shared-lib"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/express": "^4.17.0"
  }
}
```

Note: `@monorepo/shared-lib` uses `file:` to test internal import resolution. `devDependencies` should be skipped by the analyzer.

- [ ] **Step 3: Create `src/index.ts`** (root-level file, goes into root module)

```typescript
import express from "express";
import { registerRoutes } from "./routes/index";

export const app = express();
registerRoutes(app);
app.listen(3000);
```

- [ ] **Step 4: Create `src/routes/index.ts`**

```typescript
import type { Express } from "express";
import { usersRouter } from "./users";

export function registerRoutes(app: Express): void {
  app.use("/users", usersRouter);
}
```

- [ ] **Step 5: Create `src/routes/users.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

export const usersRouter = Router();

usersRouter.get("/", authenticate, (_req, res) => {
  res.json([]);
});

export type User = z.infer<typeof UserSchema>;
```

- [ ] **Step 6: Create `src/middleware/auth.ts`**

```typescript
import type { Request, Response, NextFunction } from "express";

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = req.headers.authorization;
  if (token) {
    next();
  }
}

export const AUTH_HEADER = "Authorization";
```

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/monorepo/services/api-gateway/
git commit -m "test: add TypeScript fixture for api-gateway"
```

---

### Task 2: Add `"typescript"` to the language union type

**Files:**
- Modify: `src/analyzers/types.ts:16`

- [ ] **Step 1: Update the `language` field on `ScannedApplication`**

In `src/analyzers/types.ts`, change line 16 from:

```typescript
  language: "java" | "python" | "c";
```

to:

```typescript
  language: "java" | "python" | "c" | "typescript";
```

- [ ] **Step 2: Run typecheck to verify**

Run: `npm run typecheck`
Expected: PASS (no errors — adding a union member is backwards compatible)

- [ ] **Step 3: Commit**

```bash
git add src/analyzers/types.ts
git commit -m "feat: add typescript to ScannedApplication language union"
```

---

### Task 3: Implement import parser (`imports.ts`)

**Files:**
- Create: `src/analyzers/typescript/imports.ts`
- Test: `tests/analyzers/typescript.test.ts`

- [ ] **Step 1: Write failing tests for the import parser**

Create `tests/analyzers/typescript.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analyzers/typescript.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/analyzers/typescript/imports.ts`**

```typescript
import * as fs from "node:fs";

export interface TypeScriptImportInfo {
  source: string;
  isRelative: boolean;
}

// import ... from "source"  /  import type ... from "source"
const STATIC_IMPORT = /^\s*import\s+(?:type\s+)?(?:[^\n]*?)\s+from\s+["']([^"']+)["']/gm;

// import("source")
const DYNAMIC_IMPORT = /import\(\s*["']([^"']+)["']\s*\)/g;

// require("source")
const REQUIRE = /require\(\s*["']([^"']+)["']\s*\)/g;

// export ... from "source"  /  export type ... from "source"
const REEXPORT = /^\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/gm;

export function parseTypeScriptImports(filePath: string): TypeScriptImportInfo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const imports: TypeScriptImportInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, REQUIRE, REEXPORT]) {
    for (const match of content.matchAll(pattern)) {
      const source = match[1];
      if (!seen.has(source)) {
        seen.add(source);
        imports.push({
          source,
          isRelative: source.startsWith("."),
        });
      }
    }
  }

  return imports;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analyzers/typescript.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/typescript/imports.ts tests/analyzers/typescript.test.ts
git commit -m "feat: add TypeScript import parser with tests"
```

---

### Task 4: Implement module discovery (`modules.ts`)

**Files:**
- Create: `src/analyzers/typescript/modules.ts`
- Modify: `tests/analyzers/typescript.test.ts`

- [ ] **Step 1: Add failing tests for module discovery**

Append to the existing `tests/analyzers/typescript.test.ts`:

```typescript
import { extractTypeScriptModules } from "../../src/analyzers/typescript/modules.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analyzers/typescript.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/analyzers/typescript/modules.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

export interface TypeScriptModule {
  name: string;
  path: string;
  files: string[];
  exports: string[];
}

// Matches: export class/function/const/let/var/interface/type/enum Name
const NAMED_EXPORT = /^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$]\w*)/gm;

/**
 * Read tsconfig.json and resolve the source root directory.
 * Falls back to the project root if no rootDir or include is configured.
 */
export function resolveSourceRoot(appPath: string): string {
  const tsconfigPath = path.join(appPath, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return appPath;

  try {
    // Strip comments (// and /* */) for JSON parsing
    const raw = fs.readFileSync(tsconfigPath, "utf-8");
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const tsconfig = JSON.parse(stripped);

    // Prefer rootDir
    const rootDir = tsconfig.compilerOptions?.rootDir;
    if (rootDir) {
      const resolved = path.resolve(appPath, rootDir);
      if (fs.existsSync(resolved)) return resolved;
    }

    // Fall back to first include pattern directory
    const include = tsconfig.include;
    if (Array.isArray(include) && include.length > 0) {
      // Take the first include entry as base (e.g., "src" from ["src"])
      const first = include[0].replace(/\/\*.*$/, ""); // strip glob suffix
      const resolved = path.resolve(appPath, first);
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch {
    // Parse error — fall back to appPath
  }

  return appPath;
}

export async function extractTypeScriptModules(
  appPath: string,
  exclude: string[],
): Promise<TypeScriptModule[]> {
  const sourceRoot = resolveSourceRoot(appPath);

  const tsFiles = await glob("**/*.{ts,tsx}", {
    cwd: sourceRoot,
    ignore: [
      ...exclude,
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/*.d.ts",
    ],
    nodir: true,
  });

  const moduleMap = new Map<string, TypeScriptModule>();

  for (const file of tsFiles) {
    const parts = file.split("/");
    let moduleName: string;
    let modulePath: string;

    if (parts.length === 1) {
      // Root-level file
      moduleName = path.basename(appPath);
      modulePath = ".";
    } else {
      moduleName = parts[0];
      modulePath = parts[0];
    }

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        name: moduleName,
        path: modulePath,
        files: [],
        exports: [],
      });
    }

    const mod = moduleMap.get(moduleName)!;
    mod.files.push(file);

    // Extract exports
    const fullPath = path.join(sourceRoot, file);
    const content = fs.readFileSync(fullPath, "utf-8");

    for (const match of content.matchAll(NAMED_EXPORT)) {
      const name = match[1];
      if (!mod.exports.includes(name)) {
        mod.exports.push(name);
      }
    }
  }

  return Array.from(moduleMap.values());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analyzers/typescript.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/typescript/modules.ts tests/analyzers/typescript.test.ts
git commit -m "feat: add TypeScript module discovery from tsconfig source roots"
```

---

### Task 5: Implement the analyzer (`index.ts`) and register it

**Files:**
- Create: `src/analyzers/typescript/index.ts`
- Modify: `src/analyzers/registry.ts`
- Modify: `tests/analyzers/typescript.test.ts`

- [ ] **Step 1: Add failing tests for the full analyzer**

Append to `tests/analyzers/typescript.test.ts`:

```typescript
import { typescriptAnalyzer } from "../../src/analyzers/typescript/index.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analyzers/typescript.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/analyzers/typescript/index.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ExternalDep,
  InternalImport,
  ModuleImport,
} from "../types.js";
import { slugify } from "../../core/slugify.js";
import { parseTypeScriptImports } from "./imports.js";
import { extractTypeScriptModules, resolveSourceRoot } from "./modules.js";
import { collectConfigFiles } from "../config-files.js";

const KNOWN_FRAMEWORKS: Record<string, string> = {
  "express": "Express",
  "fastify": "Fastify",
  "@nestjs/core": "NestJS",
  "next": "Next.js",
  "hono": "Hono",
  "@angular/core": "Angular",
  "nuxt": "Nuxt",
  "remix": "Remix",
  "koa": "Koa",
};

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(appPath: string): PackageJson | null {
  const pkgPath = path.join(appPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

function parseDependencies(
  appPath: string,
  pkg: PackageJson,
): { external: ExternalDep[]; internal: InternalImport[] } {
  const external: ExternalDep[] = [];
  const internal: InternalImport[] = [];
  const deps = pkg.dependencies ?? {};

  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith("file:") || version.startsWith("link:")) {
      // Resolve path to target application
      const prefix = version.startsWith("file:") ? "file:" : "link:";
      const targetRelPath = version.slice(prefix.length);
      const targetPath = path.resolve(appPath, targetRelPath);

      internal.push({
        sourceModuleId: slugify(appPath),
        targetApplicationId: slugify(targetPath),
        targetPath: targetRelPath,
      });
    } else {
      external.push({ name, version: version.replace(/^(?:workspace:|[\^~>=<]+)/, "") || undefined });
    }
  }

  return { external, internal };
}

function detectFrameworks(pkg: PackageJson): Set<string> {
  const detected = new Set<string>();
  const deps = pkg.dependencies ?? {};
  for (const depName of Object.keys(deps)) {
    const framework = KNOWN_FRAMEWORKS[depName];
    if (framework) detected.add(framework);
  }
  return detected;
}

export const typescriptAnalyzer: LanguageAnalyzer = {
  id: "typescript",
  name: "TypeScript",
  buildFilePatterns: ["tsconfig.json"],

  async analyze(
    appPath: string,
    config: ScanConfig,
  ): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const pkg = readPackageJson(appPath);
    const appName = pkg?.name ?? path.basename(appPath);

    const tsModules = await extractTypeScriptModules(appPath, config.exclude);
    const sourceRoot = resolveSourceRoot(appPath);
    const detectedFrameworks = pkg ? detectFrameworks(pkg) : new Set<string>();

    // Build module name lookup for classifying relative imports
    const allModuleNames = new Set(tsModules.map((m) => m.name));

    const modules: ScannedModule[] = [];

    for (const mod of tsModules) {
      const imports: ModuleImport[] = [];
      const metadata: Record<string, string> = {};
      const moduleFrameworks: string[] = [];

      for (const file of mod.files) {
        const fullPath = path.join(sourceRoot, file);
        const tsImports = parseTypeScriptImports(fullPath);

        for (const imp of tsImports) {
          // Classify: relative imports are internal if they resolve to a known module
          const isExternal = !imp.isRelative;

          imports.push({
            source: imp.source,
            isExternal,
          });

          // Check if this import references a detected framework
          if (isExternal) {
            for (const [depName, frameworkName] of Object.entries(KNOWN_FRAMEWORKS)) {
              if (
                detectedFrameworks.has(frameworkName) &&
                (imp.source === depName || imp.source.startsWith(depName + "/"))
              ) {
                if (!moduleFrameworks.includes(frameworkName)) {
                  moduleFrameworks.push(frameworkName);
                }
              }
            }
          }
        }
      }

      if (moduleFrameworks.length > 0) {
        metadata["framework"] = moduleFrameworks.join(",");
      }

      modules.push({
        id: slugify(`${appPath}/${mod.path}`),
        path: mod.path,
        name: mod.name,
        files: mod.files,
        exports: mod.exports,
        imports: deduplicateImports(imports),
        metadata,
      });
    }

    // Parse dependencies
    const { external: externalDependencies, internal: internalImports } =
      pkg ? parseDependencies(appPath, pkg) : { external: [], internal: [] };

    // Collect config files
    const configFiles = collectConfigFiles(appPath, appPath);

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "typescript",
      buildFile: "tsconfig.json",
      modules,
      externalDependencies,
      internalImports,
      publishedAs: pkg?.name,
      configFiles: configFiles.length > 0 ? configFiles : undefined,
    };
  },
};

function deduplicateImports(imports: ModuleImport[]): ModuleImport[] {
  const seen = new Set<string>();
  return imports.filter((imp) => {
    if (seen.has(imp.source)) return false;
    seen.add(imp.source);
    return true;
  });
}
```

- [ ] **Step 4: Register in `src/analyzers/registry.ts`**

Add the import and registration:

```typescript
import { typescriptAnalyzer } from "./typescript/index.js";
```

Add `typescriptAnalyzer` to the `analyzers` array:

```typescript
const analyzers: LanguageAnalyzer[] = [javaAnalyzer, pythonAnalyzer, cAnalyzer, typescriptAnalyzer];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/analyzers/typescript.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/analyzers/typescript/index.ts src/analyzers/registry.ts tests/analyzers/typescript.test.ts
git commit -m "feat: implement TypeScript analyzer with framework detection and file: dep resolution"
```

---

### Task 6: Add quality fixture and register in correctness tests

**Files:**
- Create: `tests/quality/fixtures/typescript-express/expected.json`
- Modify: `tests/quality/correctness.test.ts`
- Modify: `tests/quality/fixtures/TEMPLATE.md`

- [ ] **Step 1: Create `tests/quality/fixtures/typescript-express/expected.json`**

Hand-verified ground truth matching the api-gateway fixture:

```json
{
  "$comment": "Ground truth for services/api-gateway. Hand-verified from source.",
  "language": "typescript",
  "modules": [
    {
      "name": "api-gateway",
      "exports": ["app"]
    },
    {
      "name": "routes",
      "exports": ["registerRoutes", "usersRouter", "User"]
    },
    {
      "name": "middleware",
      "exports": ["authenticate", "AUTH_HEADER"]
    }
  ],
  "imports": [
    { "source": "express", "inModule": "api-gateway", "isExternal": true },
    { "source": "./routes/index", "inModule": "api-gateway", "isExternal": false },
    { "source": "express", "inModule": "routes", "isExternal": true },
    { "source": "./users", "inModule": "routes", "isExternal": false },
    { "source": "express", "inModule": "middleware", "isExternal": true },
    { "source": "zod", "inModule": "routes", "isExternal": true },
    { "source": "../middleware/auth", "inModule": "routes", "isExternal": false }
  ],
  "externalDependencies": [
    { "name": "express" },
    { "name": "zod" }
  ],
  "metadata": {
    "routes": { "framework": "Express" }
  }
}
```

- [ ] **Step 2: Register in `tests/quality/correctness.test.ts`**

Add to the `FIXTURES` array:

```typescript
{
  name: "typescript-express",
  appPath: path.resolve(MONOREPO, "services/api-gateway"),
  expectedPath: path.resolve(QUALITY_FIXTURES, "typescript-express/expected.json"),
  analyzerId: "typescript",
},
```

- [ ] **Step 3: Update `tests/quality/fixtures/TEMPLATE.md`**

Change the language line from:

```json
"language": "java | python | c",
```

to:

```json
"language": "java | python | c | typescript",
```

- [ ] **Step 4: Run correctness tests**

Run: `npm run test:correctness`
Expected: PASS with reasonable F1 scores for the typescript-express fixture

- [ ] **Step 5: Commit**

```bash
git add tests/quality/fixtures/typescript-express/ tests/quality/correctness.test.ts tests/quality/fixtures/TEMPLATE.md
git commit -m "test: add TypeScript quality fixture and register in correctness suite"
```

---

### Task 7: Smoke test end-to-end

**Files:** None (manual verification)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (fix any issues if needed)

- [ ] **Step 4: Run generate against the fixture monorepo**

Run: `npm run dev -- generate --deterministic -c tests/fixtures/monorepo/diagram-docs.yaml`
Expected: Discovers the api-gateway as a TypeScript application, generates diagrams

- [ ] **Step 5: Commit any fixes**

If any lint/type fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address lint and type issues from TypeScript analyzer"
```
