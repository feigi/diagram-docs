# Technology Stack

**Analysis Date:** 2025-01-27

## Languages

**Primary:**

- TypeScript 5.7+ - All source code (`src/`), tests (`tests/`), and configuration files

**Secondary:**

- JavaScript (generated) - Compiled output in `dist/` (ES2022 target, Node16 module format)

## Runtime

**Environment:**

- Node.js >= 20 (enforced via `engines` in `package.json`)
- Current development environment: Node.js v25.8.1

**Package Manager:**

- npm 11.11.0
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**

- Commander.js ^13.1.0 - CLI framework for command parsing (`src/cli/index.ts`)
- Zod ^3.24.2 - Schema validation for config and model files (`src/config/schema.ts`, `src/core/model.ts`)
- YAML ^2.7.0 - YAML parsing/serialization for config, models, and manifests
- Chalk ^5.6.2 - Terminal output coloring and styling
- Glob ^11.0.1 - File discovery and pattern matching across analyzers

**Testing:**

- Vitest ^3.0.0 - Test runner and assertion library (`vitest.config.ts`)

**Build/Dev:**

- TypeScript ^5.7.0 - Type checking and compilation (`tsconfig.json`)
- tsx ^4.19.0 - Development-time TypeScript execution (`npm run dev`)
- ESLint ^9.19.0 - Linting with flat config (`eslint.config.mjs`)
- Prettier ^3.8.1 - Code formatting (`.prettierrc`)
- Husky ^9.1.7 - Git hooks (`.husky/pre-commit`)
- typescript-eslint ^8.57.2 - TypeScript-specific ESLint rules

## Key Dependencies

**Critical (runtime):**

- `commander` ^13.1.0 - Entire CLI interface; defines all 5 commands (init, scan, model, generate, remove)
- `zod` ^3.24.2 - Config validation (`src/config/schema.ts`), model schema validation (`src/core/model.ts`), and LLM output validation
- `yaml` ^2.7.0 - All YAML I/O: config files, architecture models, manifests, per-project caches
- `glob` ^11.0.1 - File discovery in analyzers, checksum computation, config file collection
- `chalk` ^5.6.2 - Terminal UI: progress frames, interactive prompts, colored output

**Dev-only:**

- `diff` ^8.0.3 / `@types/diff` ^7.0.2 - Test utilities for quality/drift tests
- `gpt-tokenizer` ^3.4.0 - Token counting in quality tests (`tests/quality/token-efficiency.test.ts`)
- `jsondiffpatch` ^0.7.3 - JSON comparison in tests

## Module System

**Type:** ES Modules (`"type": "module"` in `package.json`)

**TypeScript Configuration (`tsconfig.json`):**

- Target: ES2022
- Module: Node16
- Module Resolution: Node16
- Strict mode: enabled
- Source maps: enabled
- Declaration files: generated
- Root dir: `src/`
- Out dir: `dist/`

**Import Style:** All internal imports use `.js` extension (required by Node16 module resolution):

```typescript
import { loadConfig } from "../../config/loader.js";
```

## Configuration

**Project Configuration:**

- `diagram-docs.yaml` or `diagram-docs.yml` - Main config file, auto-created on first run
- Schema defined in `src/config/schema.ts` via Zod
- Key sections: system, scan, levels, abstraction, output, llm, externalSystems, submodules

**Build Configuration:**

- `tsconfig.json` - TypeScript compiler config
- `eslint.config.mjs` - ESLint flat config (recommended + typescript-eslint + prettier)
- `.prettierrc` - Prettier config: `{ trailingComma: "all", tabWidth: 2, useTabs: false }`
- `vitest.config.ts` - Test runner config (tests in `tests/`, benchmarks in `tests/bench/`)

**Git Hooks:**

- `.husky/pre-commit` - Runs `npm run format` and `npm run lint -- --fix` on staged files

## CLI Binary

**Distribution:**

- Published as npm package `diagram-docs` v0.1.0
- Binary entry point: `./dist/cli/index.js` (mapped to `diagram-docs` command)
- Pre-pack step: `tsc` (compiles TypeScript before publishing)
- Packaged tarball present: `diagram-docs-0.1.0.tgz`

**Commands:**

- `diagram-docs init` - Initialize configuration (`src/cli/commands/init.ts`)
- `diagram-docs scan` - Discover and analyze applications (`src/cli/commands/scan.ts`)
- `diagram-docs model` - Build architecture model (`src/cli/commands/model.ts`)
- `diagram-docs generate` - Generate D2 diagrams from model (`src/cli/commands/generate.ts`)
- `diagram-docs remove` - Clean up generated files (`src/cli/commands/remove.ts`)

## Node.js Built-in Usage

Heavily uses Node.js built-in modules (no external alternatives):

- `node:fs` - All file I/O (sync operations throughout)
- `node:path` - Path manipulation
- `node:child_process` - `execFileSync` and `spawn` for LLM CLI delegation and D2 rendering
- `node:crypto` - SHA-256 checksums for cache invalidation (`src/core/checksum.ts`)
- `node:readline` - Interactive setup prompts (`src/cli/interactive-setup.ts`)
- `node:os` - Temp directory for LLM prompt files

## Platform Requirements

**Development:**

- Node.js >= 20
- npm (for dependency management)
- Optional: D2 CLI (for rendering diagrams to SVG/PNG)
- Optional: Claude Code CLI or GitHub Copilot CLI (for LLM-powered model generation)

**Production/Runtime:**

- Node.js >= 20
- Filesystem access (reads source code, writes diagrams)
- No network access required (all LLM interaction via local CLI tools)
- No database required (file-based caching in `.diagram-docs/` directories)

---

_Stack analysis: 2025-01-27_
