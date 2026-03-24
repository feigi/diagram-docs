# diagram-docs

Generate [C4 architecture diagrams](https://c4model.com) in [D2](https://d2lang.com) from source code.

## Quick start

```bash
cd your-project
diagram-docs generate
```

That's it. `generate` discovers source code, scans it, builds an architecture model, generates D2 diagrams, and renders SVG files. If no `diagram-docs.yaml` config exists, one is created with sensible defaults.

Install the [D2 CLI](https://d2lang.com/releases/install) to get rendered SVG/PNG output. Without it, you still get `.d2` source files.

For LLM-enhanced modeling (better descriptions, smarter component grouping), install [Claude Code](https://claude.ai/download) or [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli). Without either, a deterministic rule-based model builder is used. You can also force deterministic mode explicitly:

```bash
diagram-docs generate --deterministic
```

## How it works

`generate` runs a three-phase pipeline:

```
1. Scan       Source code  ──▶  raw-structure.json
                                       │
2. Model      Static analysis (or LLM) reasons about
              structure, groups modules into components
                                       │
3. Generate   architecture-model.yaml  ──▶  D2 diagrams + SVG/PNG
```

### Phase 1: Scan

Static analysis reads your source code and produces `raw-structure.json` — a structured representation of applications, modules, imports, dependencies, and metadata (like Java annotations).

Applications are discovered by build files (`pom.xml`, `build.gradle`, `pyproject.toml`, `CMakeLists.txt`, etc.). Results are cached by file checksum; unchanged files skip re-analysis.

### Phase 2: Model

The scan output is converted into `architecture-model.yaml` — the bridge between raw code structure and diagrams. This is where architectural decisions happen: how modules are grouped into components, what actors exist, which external systems are in play, and how things relate to each other.

**Deterministic mode** (no LLM needed): A rule-based builder maps scan output directly. It creates one container per application, groups modules by package prefix, detects external systems from dependencies (PostgreSQL, Kafka, Redis, etc.), and infers actors from annotations (controllers → API consumer, listeners → upstream system). Output is correct but generic — descriptions are formulaic and relationship labels are pattern-matched.

**LLM mode** (default when a CLI is available): The deterministic model is generated first as a "seed", then handed to an LLM agent to improve. The agent rewrites descriptions to be specific and meaningful, regroups components by architectural role (controller/service/repository), replaces generic "Uses" labels with descriptive verb phrases, and detects actors and external systems from code evidence. The tool shells out to Claude Code or Copilot CLI — it never calls an LLM API directly.

For multi-app projects, per-app LLM calls run in parallel, then a synthesis step merges the results and refines cross-app relationships.

The model file is written to disk and reused on subsequent runs. Delete it to regenerate.

### Phase 3: Generate

The architecture model is rendered as D2 diagrams at three C4 levels:

| Level | File | What it shows |
|-------|------|---------------|
| L1 Context | `c1-context.d2` | System, actors, external systems |
| L2 Container | `c2-container.d2` | Containers (applications) within the system |
| L3 Component | `c3-component.d2` | Components within each container |

Generated files go in `_generated/` subdirectories (overwritten each run). User-facing files are scaffolded once and never overwritten — they use D2 `@import` to merge with generated content. This means you can customize diagrams freely without losing changes on regeneration.

If the D2 CLI is installed, diagrams are rendered to SVG or PNG. Rendering is skipped for files whose output is already up-to-date.

## Supported languages

| Language | Build files | What's extracted |
|----------|------------|------------------|
| Java | `pom.xml`, `build.gradle`, `build.gradle.kts` | Packages, imports, class-level annotations (e.g. Spring stereotypes), Maven/Gradle dependencies, multi-module subprojects, `publishedAs` coordinates for cross-app matching, config/resource files |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt` | Modules, imports, framework detection (FastAPI, Flask, Django), dependencies, config files |
| C | `CMakeLists.txt`, `Makefile` | Header/source structure, `#include` directives (system vs local), public API from header exports |

## Configuration

Running `generate` without a config file creates a `diagram-docs.yaml` with defaults. Edit it to customize behavior:

```yaml
system:
  name: "My System"           # Inferred from directory name if not set
  description: ""

scan:
  include: ["**"]
  exclude:
    - "**/*test*/**"
    - "**/*test*"
    - "**/node_modules/**"
    - "**/build/**"
    - "**/dist/**"
    - "**/target/**"

levels:
  context: true                # L1 — system + actors + external systems
  container: true              # L2 — containers within the system
  component: true              # L3 — components within each container

abstraction:
  granularity: balanced        # detailed | balanced | overview
  excludePatterns:             # cross-cutting concerns to omit
    - logging
    - metrics
    - middleware
    - config
    - utils

externalSystems:               # declare known external systems
  - name: PostgreSQL
    technology: SQL
    usedBy: [user-api]         # container IDs that use this system
  - name: Redis
    technology: Cache

output:
  dir: docs/architecture
  format: svg                  # svg | png
  theme: 0                     # D2 theme ID
  layout: elk                  # D2 layout engine

llm:
  provider: auto               # auto | claude-code | copilot
  model: sonnet                # Model to use for LLM-driven modeling
  concurrency: 4               # Max parallel LLM calls (1-16)

submodules:
  enabled: true                # generate per-app docs alongside root diagrams
  docsDir: docs                # docs folder within each app
  overrides:                   # per-app overrides
    some-app:
      docsDir: documentation
      exclude: false
```

### Granularity levels

| Level | Behavior |
|-------|----------|
| `detailed` | 1:1 module-to-component mapping with disambiguation for duplicate names |
| `balanced` | Groups modules into up to 20 components using common-prefix-aware grouping |
| `overview` | One component per container |

### External systems

The `externalSystems` config declares infrastructure dependencies that appear on diagrams. Dependencies like PostgreSQL, Kafka, and Redis are also auto-detected from build files — config entries take precedence and let you specify `usedBy` relationships explicitly.

## Output structure

```
docs/architecture/
  _generated/                          # Overwritten each run
    c1-context.d2
    c2-container.d2
  containers/
    <id>/_generated/
      c3-component.d2
    <id>/
      c3-component.d2                 # User-facing, scaffolded once
  c1-context.d2                        # User-facing — imports _generated, never overwritten
  c2-container.d2
  styles.d2
```

Container diagrams include drill-down links to component diagrams when L3 is enabled. All generated output is deterministic and sorted by ID for stable diffs.

### Submodule docs

When submodules are enabled, each application also gets its own docs:

```
<app-path>/docs/architecture/
  _generated/
    c3-component.d2
  architecture-model.yaml              # Model fragment for reference
  c3-component.d2                      # User-facing with breadcrumb link to root
  styles.d2
```

## Architecture model

The `architecture-model.yaml` is the bridge between scan output and diagrams. It's generated automatically but designed to be human-editable:

```yaml
version: 1
system:
  name: "My System"
  description: "What this system does"

actors:
  - id: user
    name: User
    description: "End user"

externalSystems:
  - id: email-provider
    name: Email Provider
    description: "Third-party email delivery service"
    technology: SMTP

containers:
  - id: user-api
    applicationId: services-user-api    # links to ScannedApplication.id
    name: User API
    description: "Manages user accounts and profiles"
    technology: Java / Spring Boot

components:
  - id: user-controller
    containerId: user-api
    name: User Controller
    description: "REST endpoints for user management"
    technology: Spring MVC
    moduleIds:
      - services-user-api-com-example-user

relationships:
  - sourceId: user
    targetId: user-api
    label: "Manages users via"
    technology: HTTPS
```

Edit this file to refine names, descriptions, and relationships. Delete it to regenerate from scratch on the next `generate` run.

JSON schemas for both `raw-structure.json` and `architecture-model.yaml` are in `src/schemas/`.

## Individual commands

`generate` runs the full pipeline, but each phase is also available as a standalone command for debugging or fine-grained control:

| Command | Purpose |
|---------|---------|
| `diagram-docs init` | Create a `diagram-docs.yaml` config (also happens automatically on `generate`) |
| `diagram-docs scan` | Run static analysis only, output `raw-structure.json` for inspection |
| `diagram-docs model` | Generate `architecture-model.yaml` from scan output (use `--llm` for LLM mode) |
| `diagram-docs generate` | Full pipeline: scan → model → diagrams → render |

### `diagram-docs scan`

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to `diagram-docs.yaml` |
| `-o, --output <path>` | Output file (default: stdout) |
| `--force` | Skip cache, re-scan everything |

### `diagram-docs model`

| Flag | Description |
|------|-------------|
| `-i, --input <path>` | Path to `raw-structure.json` (default: `.diagram-docs/raw-structure.json`) |
| `-o, --output <path>` | Output file path (default: `architecture-model.yaml`) |
| `-c, --config <path>` | Path to `diagram-docs.yaml` |
| `--llm` | Use LLM to generate model (requires Claude Code or Copilot CLI) |

### `diagram-docs generate`

| Flag | Description |
|------|-------------|
| `-m, --model <path>` | Path to `architecture-model.yaml` |
| `-c, --config <path>` | Path to `diagram-docs.yaml` |
| `--submodules` | Generate per-application docs alongside root diagrams |
| `--deterministic` | Use deterministic model builder (skip LLM) |

## Quality checks

```bash
npm run test:correctness    # Precision/recall/F1 against ground truth fixtures
npm run test:drift          # Output stability across model mutations
npm run test:tokens         # Token efficiency of scan output
npm run test:quality        # All of the above
npm run bench               # Execution speed benchmarks
```

## Development

```bash
npm run dev -- scan --help   # Run without building
npm run build
npm test                     # All tests
npm run typecheck
npm run lint
```

### Adding a language analyzer

1. Create `src/analyzers/<language>/index.ts` implementing `LanguageAnalyzer`
2. Register in `src/analyzers/registry.ts`
3. Add a ground truth fixture in `tests/quality/fixtures/`

See `tests/quality/fixtures/TEMPLATE.md` for a guided workflow.
