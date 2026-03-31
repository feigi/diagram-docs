# Architecture

**Analysis Date:** 2025-07-14

## Pattern Overview

**Overall:** Pipeline architecture — a multi-stage CLI tool that transforms source code into C4 architecture diagrams via static analysis, model building (deterministic or LLM-assisted), and D2 diagram generation.

**Key Characteristics:**

- Plugin-based language analyzers registered in a central registry
- Two-phase model building: deterministic (rule-based) or LLM-powered (via external CLI delegation)
- C4 model hierarchy: System → Containers → Components with relationships
- Generated/user file separation pattern — generated D2 files are imported by scaffolded user-editable files via D2's `...@` spread syntax
- Content-addressable caching at both project-level and root-level using SHA-256 checksums
- Zero external SDK dependency for LLM — delegates to CLI tools (`claude`, `copilot`)

## Layers

**CLI Layer:**

- Purpose: Parse commands, handle user interaction, orchestrate pipeline execution
- Location: `src/cli/`
- Contains: Commander.js command definitions, interactive setup, terminal UI components (Frame, ParallelProgress)
- Depends on: Core Layer, Config Layer, Generator Layer
- Used by: End users via `diagram-docs` binary

**Config Layer:**

- Purpose: Load, validate, and merge YAML configuration files
- Location: `src/config/`
- Contains: Zod schema definition (`schema.ts`), config file discovery and loading (`loader.ts`)
- Depends on: Core Layer (humanize utility)
- Used by: CLI Layer, Core Layer

**Analyzers Layer:**

- Purpose: Language-specific static analysis — discover modules, parse imports, detect annotations
- Location: `src/analyzers/`
- Contains: Per-language analyzers (Java, Python, TypeScript, C), shared types, analyzer registry
- Depends on: Core Layer (slugify)
- Used by: Core Layer (scan pipeline)

**Core Layer:**

- Purpose: Pipeline orchestration — scanning, model building, caching, and cross-cutting utilities
- Location: `src/core/`
- Contains: Scan pipeline, deterministic model builder, LLM model builder, parallel model builder, caching, checksum computation, pattern detection
- Depends on: Analyzers Layer (registry, types), Config Layer (schema)
- Used by: CLI Layer, Generator Layer

**Generator Layer:**

- Purpose: Transform ArchitectureModel into D2 diagram files and rendered SVGs
- Location: `src/generator/d2/`
- Contains: C4 diagram generators (context, container, component), D2 writer, scaffolding, validation, drift detection, SVG post-processing
- Depends on: Core Layer (model types, model-fragment, slugify), Analyzers Layer (types)
- Used by: CLI Layer (generate command)

**Schemas:**

- Purpose: JSON Schema definitions for data interchange formats
- Location: `src/schemas/`
- Contains: `architecture-model.schema.json`, `raw-structure.schema.json`
- Used by: External tooling/validation (not imported by source code)

## Data Flow

**Main Pipeline (`diagram-docs generate`):**

1. **Config Resolution** — `src/config/loader.ts` loads and validates `diagram-docs.yaml` using Zod schema. Creates default config if none exists. Interactive LLM setup via `src/cli/interactive-setup.ts` on first run.
2. **Discovery** — `src/core/discovery.ts` walks the filesystem using glob patterns per registered analyzer's `buildFilePatterns`. Classifies each project as `container` or `library` via `src/core/classify.ts`.
3. **Scanning** — `src/core/scan.ts` runs per-project scans via `runScanAll()`. Each project is analyzed by its matched `LanguageAnalyzer.analyze()` method. Results are cached per-project in `{project}/.diagram-docs/` with SHA-256 checksums (`src/core/per-project-cache.ts`). Post-scan passes: `matchCrossAppCoordinates()` promotes cross-app deps, `rollUpShellParents()` merges build-system-only parents.
4. **Model Building** — Two paths:
   - **Deterministic** (`src/core/model-builder.ts`): Rule-based mapping from `RawStructure` → `ArchitectureModel`. Maps applications to containers, modules to components (filtered by granularity: detailed/balanced/overview). Detects roles (controller/service/repository/listener) from annotations. Infers external systems from dependency names.
   - **LLM-powered** (`src/core/llm-model-builder.ts`, `src/core/parallel-model-builder.ts`): Splits `RawStructure` per-app, runs concurrent LLM calls via `claude` or `copilot` CLI, merges partial models, runs a synthesis pass for system-level naming and cross-cutting relationships. Falls back to deterministic per-app on LLM failure.
5. **Diagram Generation** — `src/generator/d2/` generates D2 files at three C4 levels:
   - L1 Context: `src/generator/d2/context.ts` — actors, system, external systems
   - L2 Container: `src/generator/d2/container.ts` — containers within system boundary
   - L3 Component: `src/generator/d2/component.ts` — components per container
6. **Scaffolding** — `src/generator/d2/scaffold.ts` creates user-editable D2 wrapper files that `...@import` generated files. Never overwrites existing user files.
7. **Rendering** — Calls `d2` CLI (`execFileSync`) to convert D2 → SVG/PNG. Skips up-to-date outputs.
8. **Post-processing** — `src/generator/d2/svg-post-process.ts` injects CSS/JS for interactive edge highlighting in SVGs.
9. **Drift Detection** — `src/generator/d2/drift.ts` warns about stale ID references in user-edited D2 files.

**State Management:**

- **Scan Cache**: Per-project cache in `{project}/.diagram-docs/` containing `scan.json`, `model.yaml`, `checksum`
- **Root Manifest**: `.diagram-docs/manifest.yaml` tracks last scan/model timestamps and checksums
- **ManifestV2**: Tracks per-project type, path, language, and synthesis timestamps
- **Architecture Model**: `architecture-model.yaml` at repo root — the central artifact users can edit

## Key Abstractions

**LanguageAnalyzer:**

- Purpose: Plugin interface for language-specific static analysis
- Examples: `src/analyzers/java/index.ts`, `src/analyzers/typescript/index.ts`, `src/analyzers/python/index.ts`, `src/analyzers/c/index.ts`
- Pattern: Registry pattern — all analyzers registered in `src/analyzers/registry.ts` via `getRegistry()`. Each implements `LanguageAnalyzer` interface from `src/analyzers/types.ts` with `id`, `buildFilePatterns`, `defaultExcludes`, and `analyze()` method.

**RawStructure:**

- Purpose: Intermediate representation of scanned source code before model building
- Defined in: `src/analyzers/types.ts`
- Pattern: Contains `ScannedApplication[]` → each has `ScannedModule[]` with imports, exports, metadata (annotations, framework)

**ArchitectureModel:**

- Purpose: The C4-based architecture model that drives diagram generation
- Defined in: `src/analyzers/types.ts`, validated by Zod schema in `src/core/model.ts`
- Pattern: Hierarchical — system → actors + externalSystems + containers → components + relationships

**D2Writer:**

- Purpose: Low-level D2 syntax builder that produces well-formed D2 diagram files
- Location: `src/generator/d2/writer.ts`
- Pattern: Builder pattern with fluent API — `shape()`, `container()`, `connection()`, `blank()`, `comment()`

**Frame / ParallelProgress:**

- Purpose: Terminal UI components for real-time progress display during LLM operations
- Location: `src/cli/frame.ts`, `src/cli/parallel-progress.ts`
- Pattern: TTY-aware rendering with mouse scroll support, cursor management, spinner animations. Falls back to line-based output for non-TTY environments.

## Entry Points

**CLI Entry:**

- Location: `src/cli/index.ts`
- Triggers: `diagram-docs` binary (defined in `package.json` bin field)
- Responsibilities: Registers 5 commands via Commander.js: `init`, `scan`, `model`, `generate`, `remove`

**Commands:**

- `init` (`src/cli/commands/init.ts`): Scaffold `diagram-docs.yaml` config with interactive LLM setup
- `scan` (`src/cli/commands/scan.ts`): Run static analysis, produce `raw-structure.json`
- `model` (`src/cli/commands/model.ts`): Transform `raw-structure.json` → `architecture-model.yaml` (deterministic or `--llm`)
- `generate` (`src/cli/commands/generate.ts`): Full pipeline — auto-scan + model + D2 generation + rendering. The primary user-facing command.
- `remove` (`src/cli/commands/remove.ts`): Clean up all generated files

## Error Handling

**Strategy:** Custom error classes with typed error handling at command boundaries

**Patterns:**

- `ScanError` (`src/core/scan.ts`): Thrown when no applications are discovered. Caught in CLI scan command to show user-friendly message.
- `LLMUnavailableError`, `LLMCallError`, `LLMOutputError` (`src/core/llm-model-builder.ts`): Three-tier LLM error classification. Checked with `instanceof` at CLI boundaries (`src/cli/commands/generate.ts`, `src/cli/commands/model.ts`) for specific error messages and exit codes.
- `isProgrammingError()` (`src/core/llm-model-builder.ts`): Guard function that identifies native JS errors (TypeError, RangeError, etc.) to prevent them from being silently swallowed by LLM error catch blocks.
- `rethrowIfFatal()` (`src/core/llm-model-builder.ts`): Rethrows system-level errors (ENOMEM, ENOSPC) and programming errors.
- Graceful degradation: `src/core/parallel-model-builder.ts` falls back to deterministic model building per-app if LLM call fails.
- File I/O: `ENOENT`/`EACCES` errors are caught with warnings (e.g., analyzer import scanning), other errors are rethrown.

## Cross-Cutting Concerns

**Logging:**

- All user-facing output goes to `stderr` (via `console.error()` and direct `process.stderr.write()`)
- JSON/YAML data output goes to `stdout` (scan command with no `-o` flag)
- Debug logging: `src/core/debug-logger.ts` writes per-LLM-call log files to `.diagram-docs/debug/` when `--debug` flag is set
- Agent logging: `src/core/agent-logger.ts` writes per-app agent logs to `.diagram-docs/logs/` during parallel LLM builds

**Validation:**

- Config validation: Zod schema with defaults (`src/config/schema.ts`)
- Model validation: Zod schema at `src/core/model.ts` (`architectureModelSchema`)
- D2 validation: Calls `d2 validate` CLI command (`src/generator/d2/validate.ts`)
- Drift detection: `src/generator/d2/drift.ts` checks user D2 files for references to model IDs that no longer exist

**Caching:**

- Content-addressable: SHA-256 checksum of source files + config fingerprint
- Per-project: `{project}/.diagram-docs/` with `scan.json`, `model.yaml`, `checksum`
- Root-level: `.diagram-docs/manifest.yaml` for global scan/model staleness checks
- Config changes invalidate cache (config fingerprint included in checksum)

**Deterministic Output:**

- D2 identifiers sorted alphabetically via `src/generator/d2/stability.ts`
- Relationships sorted by sourceId then targetId
- Module IDs derived from paths via `slugify()` for stability

---

_Architecture analysis: 2025-07-14_
