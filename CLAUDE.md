# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

diagram-docs is a TypeScript CLI that generates C4 architecture diagrams in D2 format from source code. It implements a three-phase pipeline:

1. **Scan** — Static analysis extracts code structure → `.diagram-docs/raw-structure.json`
2. **Model** — Deterministic or LLM-agent-driven conversion → `architecture-model.yaml`
3. **Generate** — Produces D2 diagrams (context/container/component levels) → `docs/architecture/`

The tool never calls an LLM itself. The agent sits between scan and generate, reading scan output and writing the architecture model.

## Commands

```bash
npm run prepare            # Compile TypeScript (tsc → dist/)
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

`discovery.ts` finds apps by build files → language analyzers extract modules/imports/deps → `model-builder.ts` converts raw→architecture deterministically → D2 generators produce diagrams at three C4 levels.

### Key Modules

- **`src/analyzers/`** — Plugin-based language analyzers (Java, Python, C). Each implements `LanguageAnalyzer` interface from `types.ts`, registered in `registry.ts`.
- **`src/cli/commands/`** — Commander.js commands: `init`, `scan`, `generate`, `model`.
- **`src/config/`** — Zod-validated config from `diagram-docs.yaml` (`schema.ts` + `loader.ts`).
- **`src/core/`** — Discovery, manifest caching (checksums for skip-unchanged), model building, humanization, slugification.
- **`src/generator/d2/`** — D2 generators per C4 level (`context.ts`, `container.ts`, `component.ts`), plus `writer.ts` (D2 syntax builder), `stability.ts` (deterministic ordering), `drift.ts` (stale reference detection), `scaffold.ts`/`submodule-scaffold.ts` (user-facing file generation).
- **`src/schemas/`** — JSON Schemas for `raw-structure.json` and `architecture-model.yaml`.

### Core Types (`src/analyzers/types.ts`)

- `RawStructure` / `ScannedApplication` / `ScannedModule` — scan output
- `ArchitectureModel` — the bridge between scan and generation
- `LanguageAnalyzer` — plugin interface for adding language support

### Output Structure

Generated files go in `_generated/` subdirs (overwritten each run). User-facing files are scaffolded once and never overwritten — they use D2 `@import` to merge with generated content.

## Code Conventions

- **ES modules** with `.js` extensions in TypeScript imports (required by Node16 module resolution)
- **Zod** for runtime validation at boundaries (config loading, model parsing)
- **Deterministic output** — all generated content sorted by ID via `stability.ts` for consistent diffs
- IDs use kebab-case (`slugify()`), D2 identifiers use underscores (`toD2Id()`)
- Strict TypeScript (`strict: true`, target ES2022)

## Testing

Tests live in `tests/` using vitest with globals enabled. Fixtures in `tests/fixtures/monorepo/` (multi-language Java/Python/C sample). Quality tests measure precision/recall against ground truth fixtures in `tests/quality/fixtures/`.

### Adding a Language Analyzer

1. Create `src/analyzers/<language>/index.ts` implementing `LanguageAnalyzer`
2. Register in `src/analyzers/registry.ts`
3. Add ground truth fixture in `tests/quality/fixtures/` (see `TEMPLATE.md`)
