# TypeScript Analyzer Design

## Goal

Add a TypeScript language analyzer to diagram-docs, following the same `LanguageAnalyzer` plugin pattern used by Java, Python, and C analyzers. This enables the tool to scan TypeScript/Node.js codebases and produce C4 architecture diagrams.

## File Structure

```
src/analyzers/typescript/
├── index.ts       # LanguageAnalyzer implementation (main entry)
├── imports.ts     # Parse import/require statements from .ts/.tsx files
└── modules.ts     # Discover modules from tsconfig source roots + export extraction
```

## Discovery

- **Build file pattern**: `tsconfig.json`
- Cleanly distinguishes TypeScript projects from plain JavaScript
- `package.json` must also exist in the same directory; if missing, the analyzer returns empty dependencies and uses the directory name as app name
- `tsconfig.json` is the discovery trigger; `package.json` is supplementary metadata

## Module Discovery (`modules.ts`)

- Read `tsconfig.json` to find source roots:
  - `compilerOptions.rootDir` if set
  - `include` patterns if set
  - Fall back to project root if neither is configured
- Glob for `*.{ts,tsx}` under the resolved source root
- Exclude: test files, `node_modules`, `dist`, `build`, declaration files (`*.d.ts`)
- Group files by top-level directory under the source root — each directory becomes a module (same strategy as the Python analyzer's package grouping)
- Files directly in the source root (no subdirectory) become a root module

This approach is framework-agnostic — works with `src/`, `lib/`, `app/`, flat structures, or whatever `tsconfig.json` specifies.

### Export Extraction

Scan files for these export forms:
- `export class Foo` / `export default class Foo`
- `export function foo` / `export default function foo`
- `export const/let/var foo`
- `export interface Foo` / `export type Foo` / `export enum Foo`

Re-exports (`export { X } from "..."` / `export * from "..."`) are recorded as imports but not followed — they appear in the module's import list, and the re-exported names are not added to exports.

## Import Parsing (`imports.ts`)

Regex-based parsing (consistent with all existing analyzers — no AST dependency):

- `import ... from "..."` (ES module static imports)
- `import("...")` (dynamic imports)
- `require("...")` (CommonJS)

Classification:
- Starts with `.` or `..` → internal
- Otherwise → external

Resolution of the `ModuleImport.resolved` field for internal imports: resolve relative to the importing file's directory, then map to the enclosing module ID. `tsconfig.json` path aliases (`compilerOptions.paths`) are not resolved in v1 — aliased imports (e.g., `@/services/user`) will be classified as external. This is a known limitation; path alias support can be added later.

## Dependencies

- Parse `dependencies` from `package.json` (skip `devDependencies`)
- Each entry becomes an `ExternalDep` with name and version
- If `package.json` is missing or unparseable, dependencies are empty

## Internal Imports

Two mechanisms:

1. **`file:` / `link:` deps** — the version contains an explicit path. The analyzer resolves the path, reads the target's `package.json` `name` field, and writes an `InternalImport` directly. This handles aliased dependencies where the key doesn't match the target's actual package name. These are excluded from `externalDependencies`.

2. **Everything else** (`^1.0.0`, `workspace:*`, etc.) — goes into `externalDependencies` by name. The existing `matchCrossAppCoordinates()` post-processing in `scan.ts` matches dependency names against other apps' `publishedAs` values and promotes matches. Since we set `publishedAs` from `package.json` `name`, this handles the common case where the dependency key matches the target package name.

## Published As

Set `publishedAs` to the `name` field from `package.json`, if present. This enables cross-app coordinate matching in monorepos (same mechanism as Java's Maven/Gradle coordinates).

## Framework Detection

Supplementary metadata — the scanner works identically regardless of framework. Two-step process:

1. **Detect**: Check `package.json` `dependencies` keys against a known-frameworks map:

```typescript
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
```

2. **Assign**: For each module, check if any of its imports reference a detected framework's package name. If so, set `metadata.framework` on that module. Multiple matches stored comma-separated (same pattern as Java annotation metadata).

Easy to extend; scanner never breaks if a framework isn't listed — it just omits the metadata tag.

## Config Files

Use the existing shared `collectConfigFiles()` utility to gather config/resource files for LLM-based architecture analysis.

## Type Change

Add `"typescript"` to the `ScannedApplication.language` union type in `src/analyzers/types.ts`.

## Registration

Register `typescriptAnalyzer` in `src/analyzers/registry.ts` alongside existing analyzers.

## Known Limitations (v1)

- `tsconfig.json` path aliases (`compilerOptions.paths`) are not resolved — aliased imports classified as external
- `workspace:*` cross-app matching requires both apps to be discovered in the same scan
- `file:`/`link:` path resolution requires the target's `package.json` to be readable
- `.js`/`.mjs`/`.cjs` files under source roots are excluded (only `.ts`/`.tsx` scanned)
- The `ScanConfig.abstraction` parameter is accepted but not used, consistent with other analyzers

## Tests

### Unit Tests

`tests/analyzers/typescript.test.ts` — following the pattern of existing analyzer tests:

- Detects TypeScript build file patterns
- Analyzes a TypeScript application fixture
- Extracts modules from `tsconfig.json`-defined source roots
- Classifies internal vs external imports
- Extracts dependencies from `package.json`
- Detects framework metadata from dependencies

Separate import parser tests (`describe('TypeScript Imports Parser')`) covering:
- ES static imports (`import X from "..."`)
- Dynamic imports (`import("...")`)
- Require calls (`require("...")`)
- Relative vs bare specifier classification

### Fixture

New TypeScript app fixture under `tests/fixtures/monorepo/` with:
- `tsconfig.json` (with `rootDir` or `include`)
- `package.json` (with Express dependency for framework detection)
- `src/` with 2-3 modules containing `.ts` files with imports

### Quality Fixture

`tests/quality/fixtures/typescript-express/expected.json` — ground truth for precision/recall tests.

### Housekeeping

Update `tests/quality/fixtures/TEMPLATE.md` to include `typescript` in the language union.
