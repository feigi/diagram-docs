# Codebase Structure

**Analysis Date:** 2025-07-14

## Directory Layout

```
diagram-docs/
├── src/                        # All source code (rootDir for tsc)
│   ├── analyzers/              # Language-specific static analyzers (plugin system)
│   │   ├── c/                  # C language analyzer
│   │   ├── java/               # Java language analyzer (Maven + Gradle)
│   │   ├── python/             # Python language analyzer
│   │   ├── typescript/         # TypeScript/Node.js analyzer
│   │   ├── config-files.ts     # Shared config file collector for LLM context
│   │   ├── registry.ts         # Analyzer registration and lookup
│   │   └── types.ts            # Shared types (RawStructure, ArchitectureModel, LanguageAnalyzer)
│   ├── cli/                    # CLI entry point and commands
│   │   ├── commands/           # One file per CLI command
│   │   │   ├── generate.ts     # `generate` — full pipeline command
│   │   │   ├── init.ts         # `init` — scaffold config
│   │   │   ├── model.ts        # `model` — build architecture model
│   │   │   ├── remove.ts       # `remove` — clean up generated files
│   │   │   └── scan.ts         # `scan` — static analysis only
│   │   ├── frame.ts            # Live-updating boxed frame (TTY UI component)
│   │   ├── index.ts            # CLI entry point (Commander.js program)
│   │   ├── interactive-setup.ts # First-run LLM provider/model selection
│   │   ├── parallel-progress.ts # Multi-app parallel progress display
│   │   └── terminal-utils.ts   # Shared terminal helpers (spinner, formatting)
│   ├── config/                 # Configuration loading and schema
│   │   ├── loader.ts           # Config file discovery, loading, and writing
│   │   └── schema.ts           # Zod schema for diagram-docs.yaml
│   ├── core/                   # Pipeline orchestration and business logic
│   │   ├── agent-logger.ts     # Per-agent log file writer (parallel LLM builds)
│   │   ├── cascading-config.ts # Multi-level config resolution (walk up tree)
│   │   ├── checksum.ts         # SHA-256 checksum computation for cache invalidation
│   │   ├── classify.ts         # Project type classification (container vs library)
│   │   ├── debug-logger.ts     # Per-LLM-call debug log writer (--debug flag)
│   │   ├── discovery.ts        # Application discovery via build file patterns
│   │   ├── humanize.ts         # Name conversion (kebab/snake → Title Case)
│   │   ├── llm-model-builder.ts # LLM-powered model generation via CLI delegation
│   │   ├── manifest.ts         # .diagram-docs/manifest.yaml read/write
│   │   ├── model-builder.ts    # Deterministic RawStructure → ArchitectureModel builder
│   │   ├── model-fragment.ts   # Extract per-container model subsets
│   │   ├── model.ts            # Zod schema for ArchitectureModel + YAML loader
│   │   ├── parallel-model-builder.ts # Parallel split/merge for multi-app LLM builds
│   │   ├── patterns.ts         # Role detection, external system detection, label inference
│   │   ├── per-project-cache.ts # Per-project scan/model cache (read/write)
│   │   ├── remove.ts           # File collection and deletion for `remove` command
│   │   ├── scan.ts             # Scan pipeline (runScan, runScanAll, rollUpShellParents)
│   │   └── slugify.ts          # URL-safe ID generation from paths
│   ├── generator/              # Diagram output generation
│   │   └── d2/                 # D2 format generator (sole output format)
│   │       ├── component.ts    # L3 Component diagram generator
│   │       ├── container.ts    # L2 Container diagram generator
│   │       ├── context.ts      # L1 Context diagram generator
│   │       ├── drift.ts        # Stale reference detection in user D2 files
│   │       ├── scaffold.ts     # User-editable D2 file scaffolding (create-once)
│   │       ├── stability.ts    # Deterministic ID sorting for stable output
│   │       ├── styles.ts       # C4 visual style definitions (D2 classes)
│   │       ├── submodule-scaffold.ts # Per-application docs folder generation
│   │       ├── svg-post-process.ts   # Interactive edge highlighting injection
│   │       ├── validate.ts     # D2 syntax validation via `d2 validate`
│   │       └── writer.ts       # Low-level D2 syntax builder (fluent API)
│   └── schemas/                # JSON Schema files for data interchange
│       ├── architecture-model.schema.json
│       └── raw-structure.schema.json
├── tests/                      # All test files (excluded from tsc)
│   ├── analyzers/              # Analyzer unit tests
│   │   ├── c.test.ts
│   │   ├── java.test.ts
│   │   ├── java/gradle.test.ts
│   │   ├── python.test.ts
│   │   └── typescript.test.ts
│   ├── bench/                  # Vitest benchmarks
│   │   ├── analyzers.bench.ts
│   │   └── pipeline.bench.ts
│   ├── benchmark/              # Benchmark documentation
│   │   ├── README.md
│   │   ├── prompt-minimal.md
│   │   └── prompt-prescriptive.md
│   ├── cli/                    # CLI utility tests
│   │   ├── interactive-setup.test.ts
│   │   ├── parallel-progress.test.ts
│   │   └── terminal-utils.test.ts
│   ├── config/                 # Config tests
│   │   └── effective-excludes.test.ts
│   ├── core/                   # Core logic tests
│   │   ├── agent-logger.test.ts
│   │   ├── cascading-config.test.ts
│   │   ├── classify.test.ts
│   │   ├── debug-logger.test.ts
│   │   ├── error-classification.test.ts
│   │   ├── humanize.test.ts
│   │   ├── llm-yaml-repair.test.ts
│   │   ├── model-builder.test.ts
│   │   ├── model-fragment.test.ts
│   │   ├── parallel-model-builder.test.ts
│   │   ├── patterns.test.ts
│   │   ├── per-project-cache.test.ts
│   │   └── scan-rollup.test.ts
│   ├── fixtures/               # Shared test fixtures
│   │   └── monorepo/           # Fixture: a complete monorepo with model + diagrams
│   ├── generator/              # Generator tests
│   │   ├── d2.test.ts
│   │   ├── svg-post-process.test.ts
│   │   └── validate.test.ts
│   ├── integration/            # Integration tests
│   │   ├── pipeline.test.ts
│   │   └── submodule.test.ts
│   └── quality/                # Quality metrics tests
│       ├── correctness.test.ts
│       ├── drift.test.ts
│       ├── fixtures/           # Quality test expected outputs
│       ├── helpers/            # Quality test utilities
│       └── token-efficiency.test.ts
├── dist/                       # Compiled output (tsc → ES2022 + Node16 modules)
├── docs/                       # Project documentation
├── .diagram-docs/              # Runtime cache (scan data, LLM logs, manifest)
├── .planning/                  # GSD planning documents
├── diagram-docs.yaml           # N/A — config file for analyzed repos (not this project)
├── eslint.config.mjs           # ESLint flat config
├── package.json                # Project manifest and scripts
├── tsconfig.json               # TypeScript configuration
└── vitest.config.ts            # Vitest test runner configuration
```

## Directory Purposes

**`src/analyzers/`:**

- Purpose: Language-specific code scanners that produce `ScannedApplication` data
- Contains: One subdirectory per language (`c/`, `java/`, `python/`, `typescript/`), each with an `index.ts` entry point implementing `LanguageAnalyzer` interface
- Key files: `types.ts` (shared data types for the entire pipeline), `registry.ts` (analyzer lookup)
- Internal structure per language:
  - `index.ts` — `LanguageAnalyzer` implementation with `analyze()` method
  - `imports.ts` — Import/include statement parser
  - `modules.ts` or `packages.ts` or `structure.ts` — Module/package discovery

**`src/cli/`:**

- Purpose: User-facing CLI interface and terminal UI
- Contains: Command implementations, progress display components, interactive prompts
- Key files: `index.ts` (entry point), `commands/generate.ts` (primary pipeline command)

**`src/cli/commands/`:**

- Purpose: One file per CLI subcommand
- Contains: Commander.js `Command` objects with `.action()` handlers
- Key files: `generate.ts` (most complex — full pipeline orchestration)

**`src/config/`:**

- Purpose: Configuration management
- Contains: Zod schema definition and file I/O utilities
- Key files: `schema.ts` (canonical config shape), `loader.ts` (discovery, loading, writing, effective excludes)

**`src/core/`:**

- Purpose: Business logic and pipeline orchestration
- Contains: Scan pipeline, model builders (deterministic + LLM), caching, and utility functions
- Key files: `scan.ts` (scan pipeline), `model-builder.ts` (deterministic builder), `llm-model-builder.ts` (LLM builder), `parallel-model-builder.ts` (parallel orchestration)

**`src/generator/d2/`:**

- Purpose: D2 diagram file generation
- Contains: Per-level diagram generators, D2 writer, scaffolding, validation, post-processing
- Key files: `context.ts`, `container.ts`, `component.ts` (one per C4 level), `writer.ts` (D2 syntax builder)

**`src/schemas/`:**

- Purpose: JSON Schema definitions for data interchange validation
- Contains: Schema files for `raw-structure.json` and `architecture-model.yaml`
- Generated: No — hand-maintained
- Committed: Yes

**`tests/`:**

- Purpose: All test files, mirroring `src/` directory structure
- Contains: Unit tests, integration tests, quality metric tests, benchmarks, fixtures
- Key files: Tests mirror source structure (e.g., `tests/core/model-builder.test.ts` tests `src/core/model-builder.ts`)

**`.diagram-docs/`:**

- Purpose: Runtime cache directory for scan data and LLM logs
- Contains: `manifest.yaml`, `raw-structure.json`, `logs/`, `debug/`
- Generated: Yes — by the tool at runtime
- Committed: Should be in `.gitignore`

## Key File Locations

**Entry Points:**

- `src/cli/index.ts`: CLI binary entry point — all commands registered here
- `src/cli/commands/generate.ts`: Primary pipeline command — scans, models, generates, renders

**Configuration:**

- `src/config/schema.ts`: Canonical `Config` type (Zod schema) — all config options defined here
- `src/config/loader.ts`: Config loading, writing, exclude computation
- `src/core/cascading-config.ts`: Multi-level config resolution for monorepos

**Core Logic:**

- `src/analyzers/types.ts`: Central type definitions (`RawStructure`, `ArchitectureModel`, `LanguageAnalyzer`, `ScannedApplication`, `ScannedModule`)
- `src/core/scan.ts`: Scan pipeline — discovery, analysis, caching, post-processing
- `src/core/model-builder.ts`: Deterministic `RawStructure` → `ArchitectureModel` mapping
- `src/core/llm-model-builder.ts`: LLM-powered model builder (prompts, CLI delegation, YAML parsing)
- `src/core/parallel-model-builder.ts`: Parallel split/merge orchestration for multi-app LLM builds
- `src/core/patterns.ts`: Role detection and external system identification patterns

**Generator:**

- `src/generator/d2/writer.ts`: D2 syntax builder
- `src/generator/d2/context.ts`: L1 Context diagram
- `src/generator/d2/container.ts`: L2 Container diagram
- `src/generator/d2/component.ts`: L3 Component diagram
- `src/generator/d2/scaffold.ts`: User-editable file scaffolding

**Testing:**

- `vitest.config.ts`: Test runner configuration
- `tests/fixtures/monorepo/`: Complete fixture with model and diagram files

## Naming Conventions

**Files:**

- `kebab-case.ts`: All source files use kebab-case (e.g., `model-builder.ts`, `svg-post-process.ts`)
- `index.ts`: Used as analyzer entry points (e.g., `src/analyzers/java/index.ts`)
- `*.test.ts`: Test files use `.test.ts` suffix
- `*.bench.ts`: Benchmark files use `.bench.ts` suffix

**Directories:**

- `kebab-case/`: All directories use lowercase (e.g., `parallel-progress`, though most are single-word)
- Language analyzer dirs match the language ID: `c/`, `java/`, `python/`, `typescript/`
- Test dirs mirror source dirs: `tests/core/`, `tests/analyzers/`, `tests/cli/`, `tests/generator/`

**Exports:**

- Named exports only — no default exports anywhere in the codebase
- Analyzer instances are const exports: `export const javaAnalyzer: LanguageAnalyzer = {...}`
- Commands are const exports: `export const generateCommand = new Command("generate")`

## Where to Add New Code

**New Language Analyzer:**

1. Create `src/analyzers/{language}/index.ts` implementing `LanguageAnalyzer` interface
2. Add helper files as needed: `imports.ts`, `modules.ts`/`packages.ts`/`structure.ts`
3. Register in `src/analyzers/registry.ts` — import and add to `analyzers` array
4. Add tests in `tests/analyzers/{language}.test.ts`

**New CLI Command:**

1. Create `src/cli/commands/{command}.ts` exporting a `Command` object
2. Register in `src/cli/index.ts` via `program.addCommand()`
3. Add tests in `tests/cli/{command}.test.ts`

**New Generator Output Format:**

1. Create `src/generator/{format}/` directory with per-level generators
2. Follow the D2 generator pattern: separate files for context, container, component
3. Add a writer utility similar to `src/generator/d2/writer.ts`

**New Core Feature:**

- Pipeline logic: `src/core/{feature}.ts`
- Tests: `tests/core/{feature}.test.ts`

**New Config Option:**

1. Add to Zod schema in `src/config/schema.ts`
2. Use in relevant pipeline stage
3. Update default config template in `src/config/loader.ts` if needed

**New Utility:**

- Core utilities: `src/core/{utility}.ts` (e.g., `humanize.ts`, `slugify.ts`)
- CLI utilities: `src/cli/terminal-utils.ts` or new file in `src/cli/`
- Tests: `tests/core/{utility}.test.ts`

## Special Directories

**`dist/`:**

- Purpose: TypeScript compiler output (ES2022 + Node16 module resolution)
- Generated: Yes — by `tsc` (via `prepack` script)
- Committed: Yes — published as npm package, `bin` points to `dist/cli/index.js`

**`.diagram-docs/`:**

- Purpose: Runtime cache and logs created by the tool itself
- Contains: `manifest.yaml`, `raw-structure.json`, `logs/`, `debug/`
- Generated: Yes — at runtime
- Committed: No (should be gitignored)

**`src/schemas/`:**

- Purpose: JSON Schema definitions for external validation/documentation
- Generated: No — hand-maintained
- Committed: Yes

**`tests/fixtures/`:**

- Purpose: Test data files representing complete project structures
- Contains: `monorepo/` fixture with config, model, raw-structure, and generated D2/SVG files
- Generated: No — hand-maintained
- Committed: Yes

**`tests/quality/`:**

- Purpose: Quality assurance tests measuring correctness, drift detection, and token efficiency
- Contains: Test files + `fixtures/` with expected outputs per language stack + `helpers/` with metric utilities
- Generated: No
- Committed: Yes

---

_Structure analysis: 2025-07-14_
