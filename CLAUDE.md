# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

diagram-docs is a TypeScript CLI that generates C4 architecture diagrams — as D2 (default) or drawio — from source code. It implements a three-phase pipeline:

1. **Scan** — Static analysis extracts code structure → `.diagram-docs/raw-structure.json`
2. **Model** — Deterministic or LLM-agent-driven conversion → `architecture-model.yaml`
3. **Generate** — Produces D2 diagrams at up to four C4 levels (context/container/component/code) → `docs/architecture/`. The code level (L4) is opt-in via `levels.code: true`.

The tool never calls an LLM itself. The agent sits between scan and generate, reading scan output and writing the architecture model.

## Commands

```bash
npm run prepack            # Compile TypeScript (tsc → dist/); also runs automatically on `npm install -g .`
npm run dev -- <cmd>       # Run without building (tsx)
npm test                   # All tests (vitest)
npm run typecheck          # Type check only
npm run lint               # ESLint on src/

# Run a single test file
npx vitest run tests/analyzers/java.test.ts

# Quality suites
npm run test:correctness   # Precision/recall/F1 against ground truth
npm run test:drift         # Output stability across model mutations
npm run test:tokens        # Token efficiency of scan output
npm run bench              # Performance benchmarks (vitest bench)
```

## Architecture

### Pipeline Flow

`discovery.ts` finds apps by build files → language analyzers extract modules/imports/deps (plus code elements for L4 when `levels.code: true`) → `model-builder.ts` converts raw→architecture deterministically → D2 generators produce diagrams at up to four C4 levels.

### Key Modules

- **`src/analyzers/`** — Plugin-based language analyzers (Java, TypeScript, Python, C). Each implements `LanguageAnalyzer` interface from `types.ts`, registered in `registry.ts`. `tree-sitter.ts` is a shared WASM grammar loader used for code-level extraction.
- **`src/cli/commands/`** — Commander.js commands: `init`, `scan`, `generate`, `model`.
- **`src/config/`** — Zod-validated config from `diagram-docs.yaml` (`schema.ts` + `loader.ts`).
- **`src/core/`** — Discovery, manifest caching (checksums for skip-unchanged), model building, humanization, slugification. `code-model.ts` resolves code elements and qualified IDs for L4.
- **`src/generator/d2/`** — D2 generators per C4 level (`context.ts`, `container.ts`, `component.ts`, `code.ts`), plus `writer.ts` (D2 syntax builder), `stability.ts` (deterministic ordering), `drift.ts` (stale reference detection), `scaffold.ts`/`submodule-scaffold.ts`/`code-scaffold.ts` (user-facing file generation). `code-profiles.ts` provides language-specific rendering profiles for the L4 generator.
- **`src/generator/drawio/`** — Parallel generator emitting `.drawio` (mxGraph XML). Id-based merge preserves hand-edited geometry, style, and freehand cells across regenerations. Uses `fast-xml-parser` for round-trip and `elkjs` for deterministic layout.
- **`src/schemas/`** — JSON Schemas for `raw-structure.json` and `architecture-model.yaml`.
- **`assets/tree-sitter/`** — Bundled tree-sitter WASM grammars (Java, TypeScript, Python, C) loaded by `src/analyzers/tree-sitter.ts` for code-level parsing.

### Core Types (`src/analyzers/types.ts`)

- `RawStructure` / `ScannedApplication` / `ScannedModule` — scan output
- `ArchitectureModel` — the bridge between scan and generation
- `LanguageAnalyzer` — plugin interface for adding language support

### Output Structure

Generated files go in `_generated/` subdirs (overwritten each run). User-facing files are scaffolded once and never overwritten — they use D2 `@import` to merge with generated content. When L4 is enabled (`levels.code: true`), per-component diagrams are written under `docs/architecture/containers/<container>/components/<component>/c4-code.d2` (with a matching `_generated/` sibling).

## Code Conventions

- **ES modules** with `.js` extensions in TypeScript imports (required by Node16 module resolution)
- **Zod** for runtime validation at boundaries (config loading, model parsing)
- **Deterministic output** — all generated content sorted by ID via `stability.ts` for consistent diffs
- IDs use kebab-case (`slugify()`), D2 identifiers use underscores (`toD2Id()`)
- Strict TypeScript (`strict: true`, target ES2022)

## Testing

Tests live in `tests/` using vitest with globals enabled. Fixtures in `tests/fixtures/monorepo/` (multi-language Java/TypeScript/Python/C sample). Quality tests measure precision/recall against ground truth fixtures in `tests/quality/fixtures/`.

### Adding a Language Analyzer

1. Create `src/analyzers/<language>/index.ts` implementing `LanguageAnalyzer`
2. Register in `src/analyzers/registry.ts`
3. Add ground truth fixture in `tests/quality/fixtures/` (see `TEMPLATE.md`)

For L4 (code-level) support in the new language:

4. Drop the tree-sitter WASM grammar into `assets/tree-sitter/tree-sitter-<language>.wasm` and add a matching ABI-v14-compatible dev dep in `package.json`
5. Write the capture query at `src/analyzers/<language>/queries/code.scm`
6. Implement `src/analyzers/<language>/code.ts` exporting an `extract<Language>Code` that calls `runQueryScoped` from `../tree-sitter.js`
7. Gate the extraction inside `index.ts` on `config.levels?.code` and feed files through `extractCodeElementsForFiles`
8. Add a rendering profile (or reuse an existing one) in `src/generator/d2/code-profiles.ts` and extend `normalizeLanguage`/`languageFromKind` in `src/cli/commands/generate.ts` so the profile is selected
