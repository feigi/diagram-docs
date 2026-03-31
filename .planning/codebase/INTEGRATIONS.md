# External Integrations

**Analysis Date:** 2025-01-27

## APIs & External Services

**LLM Providers (CLI delegation — no SDK, no API keys managed by this tool):**

- **Claude Code CLI** - Architecture model generation via `claude` CLI
  - CLI Binary: `claude` (detected via `which claude`)
  - Communication: `spawn()` with streaming JSON output format
  - Args: `-p --verbose --output-format stream-json --include-partial-messages --system-prompt-file <tmpfile> --model <model> --allowedTools Write Read Edit`
  - Timeout: 15 minutes (900,000ms)
  - Models: `sonnet`, `opus`, `haiku` (static list in `src/cli/interactive-setup.ts`)
  - Implementation: `src/core/llm-model-builder.ts` (claudeCodeProvider, lines 443-511)

- **GitHub Copilot CLI** - Alternative architecture model generation via `copilot` CLI
  - CLI Binary: `copilot` (detected via `which copilot`)
  - Communication: `spawn()` with JSONL output format
  - Args: `-p <prompt> --output-format json --allow-all-tools --model <model>`
  - Timeout: 15 minutes (900,000ms)
  - Large prompt handling: prompts > 200KB bytes written to temp file with `--allow-all-paths`
  - Models: dynamically queried via `copilot help config` (parsed by `parseCopilotHelpConfigOutput()` in `src/cli/interactive-setup.ts`)
  - Implementation: `src/core/llm-model-builder.ts` (copilotProvider, lines 782-795; spawnCopilotJsonl, lines 533-780)

**Provider Resolution:**

- Config option `llm.provider`: `"auto"` | `"claude-code"` | `"copilot"` (default: `"auto"`)
- Auto mode tries providers in order: Claude Code first, then Copilot (`src/core/llm-model-builder.ts`, line 797)
- Fallback: deterministic model builder when no LLM available (`src/core/model-builder.ts`)

**D2 Rendering Engine:**

- **D2 CLI** - Diagram rendering (D2 source → SVG/PNG)
  - CLI Binary: `d2` (optional external tool)
  - Invocation: `execFileSync("d2", [...])` in `src/cli/commands/generate.ts` (renderD2Files function, line 485)
  - Args: `--theme=<n> --layout=<layout> <input.d2> <output.svg|png>`
  - Default layout: `elk`
  - Default theme: `0`
  - Timeout: configurable via `output.renderTimeout` (default: 120 seconds)
  - Graceful degradation: warns if `d2` not found (ENOENT), continues without rendering

## Data Storage

**Databases:**

- None — entirely file-based

**File Storage (local filesystem only):**

- **Project Configuration:** `diagram-docs.yaml` at project root
  - Schema: `src/config/schema.ts`
  - Loader: `src/config/loader.ts`

- **Architecture Model:** `architecture-model.yaml` at project root
  - Schema: `src/core/model.ts` (architectureModelSchema)
  - Format: YAML, validated with Zod

- **Raw Scan Output:** `.diagram-docs/raw-structure.json`
  - Contains: discovered applications, modules, dependencies, imports
  - Schema: `src/analyzers/types.ts` (RawStructure interface)

- **Manifest:** `.diagram-docs/manifest.yaml`
  - Tracks: last scan timestamp/checksum, last model timestamp/checksum
  - Implementation: `src/core/manifest.ts`
  - V2 format also supported with per-project tracking

- **Per-Project Cache:** `<project-dir>/.diagram-docs/`
  - `checksum` - SHA-256 hash of source files + config fingerprint
  - `scan.json` - Cached scan results
  - `model.yaml` - Cached per-container model fragment
  - Implementation: `src/core/per-project-cache.ts`

- **Generated Output:** `docs/architecture/` (configurable via `output.dir`)
  - `_generated/c1-context.d2` - L1 Context diagram
  - `_generated/c2-container.d2` - L2 Container diagram
  - `containers/<id>/_generated/c3-component.d2` - L3 Component diagrams
  - Rendered SVG/PNG alongside D2 files
  - User-customizable scaffold files (not overwritten)

- **Debug Logs:** `.diagram-docs/debug/` and `.diagram-docs/logs/`
  - Per-LLM-call log files (`src/core/debug-logger.ts`)
  - Per-agent log files for parallel builds (`src/core/agent-logger.ts`)
  - Only written when `--debug` flag is used

**Caching:**

- File-based checksum caching (SHA-256 of source files)
- Implementation: `src/core/checksum.ts`
- Cache invalidation: checksum includes config fingerprint (exclude patterns, abstraction settings)
- Per-project granularity: each sub-project has independent cache in its own `.diagram-docs/`

## Authentication & Identity

**Auth Provider:**

- None managed by diagram-docs
- LLM authentication delegated entirely to the CLI tools (Claude Code CLI / Copilot CLI handle their own auth)
- No API keys, tokens, or credentials stored or managed

## Monitoring & Observability

**Error Tracking:**

- None (CLI tool, no remote error reporting)

**Logs:**

- All operational output to `stderr` (keeping `stdout` clean for potential piping)
- Debug logging to `.diagram-docs/debug/` when `--debug` flag is passed
- Per-agent logs for parallel LLM builds in `.diagram-docs/logs/`
- Error classification system: `isProgrammingError()`, `isSystemResourceError()`, `isRecoverableLLMError()` in `src/core/llm-model-builder.ts`

## CI/CD & Deployment

**CI Pipeline:**

- GitHub Actions (`.github/workflows/ci.yml`)
- Triggers: push to `main`, pull requests
- Node.js 22 on ubuntu-latest
- Steps: `npm ci` → typecheck → lint → format check → tests

**Hosting:**

- Distributed as npm package (local CLI tool)
- No server deployment

## Environment Configuration

**Required env vars:**

- None — this tool has no environment variable dependencies

**Config file locations:**

- `diagram-docs.yaml` / `diagram-docs.yml` in project root (auto-discovered)
- `.diagram-docs/` directory for cache and manifest data

## Webhooks & Callbacks

**Incoming:**

- None

**Outgoing:**

- None

## External Tool Dependencies

**Required:**

- None strictly required for basic operation (scan + deterministic model)

**Optional:**

- `d2` CLI - Required for rendering D2 files to SVG/PNG. Install: https://d2lang.com/releases/install
- `claude` CLI (Claude Code) - Required for LLM-powered model generation
- `copilot` CLI (GitHub Copilot) - Alternative LLM provider for model generation

## Source Code Analysis Targets

The tool analyzes (reads but does not execute) codebases in these languages:

- **Java** - via `src/analyzers/java/` (Gradle/Maven build files, package structure, imports)
- **Python** - via `src/analyzers/python/` (setup.py/pyproject.toml, module structure, imports)
- **C** - via `src/analyzers/c/` (CMakeLists.txt, include structure, header analysis)
- **TypeScript** - via `src/analyzers/typescript/` (package.json, module structure, imports)

Each analyzer is registered in `src/analyzers/registry.ts` and implements the `LanguageAnalyzer` interface from `src/analyzers/types.ts`.

---

_Integration audit: 2025-01-27_
