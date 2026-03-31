# Coding Conventions

**Analysis Date:** 2025-01-20

## Naming Patterns

**Files:**

- Source files use `kebab-case.ts`: `model-builder.ts`, `config-files.ts`, `llm-model-builder.ts`
- Test files mirror source structure with `.test.ts` suffix: `model-builder.test.ts`
- Index files (`index.ts`) serve as module entry points for analyzers and CLI
- Language analyzers live in their own subdirectory: `src/analyzers/java/index.ts`

**Functions:**

- Use `camelCase` for all functions: `buildModel()`, `detectRole()`, `humanizeName()`
- Prefix boolean returns with `is`: `isProgrammingError()`, `isProjectStale()`, `isDirectChild()`
- Use verb-first naming: `computeChecksum()`, `loadConfig()`, `generateContextDiagram()`
- Factory/builder functions use `make` (in tests) or `build`/`create`: `makeConfig()`, `buildModel()`, `createParallelProgress()`

**Variables:**

- Use `camelCase` for variables and parameters: `rawStructure`, `configPath`, `shellParents`
- Constants use `UPPER_SNAKE_CASE`: `MAX_COMPONENTS`, `SPINNER_FRAMES`, `CONFIG_FILENAMES`, `EXTERNAL_SYSTEM_PATTERNS`
- Sets used for deduplication named with `seen` prefix: `const seen = new Set<string>()`

**Types:**

- Interfaces use `PascalCase`: `LanguageAnalyzer`, `ScannedApplication`, `ArchitectureModel`
- Type aliases use `PascalCase`: `ProjectType`, `Role`, `SystemType`
- Use `type` keyword for unions and simple aliases: `type ProjectType = "container" | "library"`
- Use `interface` for object shapes with methods or complex structure
- Import types with `import type` when the import is type-only: `import type { Config } from "../config/schema.js"`

**IDs:**

- Model IDs use kebab-case via `slugify()`: `"services-user-api"`, `"api-consumer"`
- D2 diagram IDs use underscores via `toD2Id()`: `services_user_api` (hyphens cause D2 parse errors)

## Code Style

**Formatting:**

- Prettier with explicit config in `.prettierrc`:
  - `trailingComma: "all"` — trailing commas everywhere
  - `tabWidth: 2` — 2-space indentation
  - `useTabs: false` — spaces only
- Run with `npm run format` (auto-formats) or `npm run format:check` (CI check)

**Linting:**

- ESLint 9 with flat config in `eslint.config.mjs`
- Uses `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-config-prettier`
- Run with `npm run lint`
- Ignores `node_modules/`, `dist/`, `.worktrees/`

**Pre-commit:**

- Husky pre-commit hook runs `npm run format` and `npm run lint -- --fix`
- Automatically stages formatted files

**TypeScript:**

- Strict mode enabled (`strict: true` in `tsconfig.json`)
- Target: ES2022, Module: Node16, ModuleResolution: Node16
- Declaration maps and source maps enabled
- All imports use `.js` extension (required by Node16 module resolution):
  ```typescript
  import { slugify } from "./slugify.js";
  import type { Config } from "../config/schema.js";
  ```

## Import Organization

**Order:**

1. Node built-in modules with `node:` prefix: `import * as fs from "node:fs"`
2. Third-party packages: `import { z } from "zod"`
3. Internal modules with relative paths: `import { slugify } from "./slugify.js"`

**Style:**

- Named imports preferred: `import { buildModel } from "../../src/core/model-builder.js"`
- Namespace imports for Node builtins: `import * as fs from "node:fs"`, `import * as path from "node:path"`
- Type-only imports use `import type`: `import type { Config } from "../config/schema.js"`
- No barrel files — import from specific modules directly

**Path Aliases:**

- None — all imports use relative paths with `.js` extension

## Error Handling

**Custom Error Classes:**

- Domain-specific error classes extend `Error` with descriptive `name` property:
  ```typescript
  export class ScanError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ScanError";
    }
  }
  ```
- LLM error hierarchy in `src/core/llm-model-builder.ts`:
  - `LLMUnavailableError` — provider not installed/accessible (non-recoverable)
  - `LLMCallError` — provider call failed (recoverable with retry)
  - `LLMOutputError` — provider returned invalid output (recoverable with retry)
    - Stores truncated `rawOutput` for debugging

**Error Classification Pattern:**

- `isProgrammingError(err)` — detects TypeError, RangeError, etc. (never swallow)
- `isSystemResourceError(err)` — detects ENOMEM, ENOSPC, etc. (re-throw immediately)
- `isRecoverableLLMError(err)` — LLMCallError or LLMOutputError (safe to retry)
- `rethrowIfFatal(err)` — re-throws programming and system errors, lets others pass

**File System Error Handling:**

- Check error codes via `(err as NodeJS.ErrnoException).code`:
  ```typescript
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "EACCES") {
    process.stderr.write(
      `Warning: skipping file ${fullPath}: ${(err as Error).message}\n`,
    );
    continue;
  }
  throw err;
  ```
- Pattern: warn and skip for expected FS errors, re-throw unexpected ones

**Graceful Degradation:**

- Functions return `null` or empty arrays for missing/unreadable files:
  ```typescript
  function readFileIfExists(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }
  ```
- Parse errors in non-critical files (e.g., JSON parse of package.json) default to `"container"` type

## Logging

**Framework:** `console.error` (stderr) for all user-facing output

**Patterns:**

- Progress messages go to stderr: `console.error("Discovering applications...")`
- Structured format for found items: `console.error(\` Found: ${app.path} (${app.buildFile})\`)`
- Warnings use `process.stderr.write()` with `Warning:` prefix
- Debug logging uses `DebugLogWriter` class (writes to `.diagram-docs/logs/`)
- No `console.log` in source code — stdout is reserved for machine-readable output

## Comments

**When to Comment:**

- Module-level JSDoc block at top of each file explaining purpose:
  ```typescript
  /**
   * Deterministic mapping: RawStructure → ArchitectureModel.
   * No LLM involved — produces a starting point users can refine.
   */
  ```
- Section separators in large files use comment blocks:
  ```typescript
  // ---------------------------------------------------------------------------
  // Error types
  // ---------------------------------------------------------------------------
  ```
- Inline comments for non-obvious logic (e.g., why a pattern exists, false-positive avoidance)

**JSDoc/TSDoc:**

- JSDoc on all exported functions with `@param` for complex params:
  ```typescript
  /**
   * Convert a kebab-case, snake_case, or dot.separated name to Title Case.
   *
   * Examples:
   *   "user-api"        → "User Api"
   *   "order_service"   → "Order Service"
   */
  export function humanizeName(input: string): string {
  ```
- Include concrete examples in JSDoc when the transformation is non-obvious
- JSDoc on interfaces and type exports for documentation

## Function Design

**Size:**

- Functions tend to be focused and single-purpose (20-60 lines typical)
- Larger orchestration functions (`buildModel`, `runScan`) delegate to helpers
- Helper functions are `function` declarations (not arrow functions) at module scope

**Parameters:**

- Use options objects for functions with multiple config inputs:
  ```typescript
  export interface BuildModelOptions {
    readonly config: Config;
    readonly rawStructure: RawStructure;
    readonly libraries?: Array<{ id: string; name: string; language: string; path: string; }>;
  }
  export function buildModel({ config, rawStructure, libraries }: BuildModelOptions): ArchitectureModel {
  ```
- Use `readonly` on options interface properties
- Optional properties use `?` suffix

**Return Values:**

- Functions return concrete types, not `any`
- Use `| null` or `| undefined` for absence (not exceptions)
- Async functions return `Promise<T>` with specific types

## Module Design

**Exports:**

- Named exports only — no default exports anywhere in the codebase
- Export individual functions, interfaces, and constants
- One module = one cohesive concept (e.g., `humanize.ts` exports name-conversion utilities)

**Barrel Files:**

- Not used — each consumer imports directly from the specific module

## Validation Pattern

**Zod at Boundaries:**

- Config schema defined with Zod in `src/config/schema.ts`
- Schema provides defaults via `.default()`:
  ```typescript
  export const configSchema = z.object({
    system: z
      .object({
        name: z.string().default("My System"),
        description: z.string().default(""),
      })
      .default({}),
    // ...
  });
  ```
- Parse config files through schema: `configSchema.parse(parsed ?? {})`
- Type derived from schema: `export type Config = z.infer<typeof configSchema>`

**Plugin Interface Pattern:**

- Language analyzers implement `LanguageAnalyzer` interface
- Registered in `src/analyzers/registry.ts` as a simple array
- Each analyzer is a plain object implementing the interface (not a class):
  ```typescript
  export const javaAnalyzer: LanguageAnalyzer = {
    id: "java",
    name: "Java",
    buildFilePatterns: ["pom.xml", "build.gradle", "build.gradle.kts"],
    analyze: async (appPath, config) => {
      /* ... */
    },
  };
  ```

## Determinism Pattern

- All generated output is sorted deterministically via `src/generator/d2/stability.ts`
- `sortById()` and `sortRelationships()` ensure consistent ordering
- Deduplication uses `Set<string>` with composite keys: `const key = \`${sourceId}->${targetId}\``
- Results sorted by `.localeCompare()` for locale-independent ordering

---

_Convention analysis: 2025-01-20_
