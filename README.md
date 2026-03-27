# diagram-docs

Generate [C4 architecture diagrams](https://c4model.com) in [D2](https://d2lang.com) format from source code — automatically.

Point it at a codebase, get context, container, and component diagrams. No manual diagramming, no config required to start.

## Quick start

```bash
cd your-project
npx github:feigi/diagram-docs generate
```

This discovers source code, scans it, builds an architecture model, and generates D2 diagrams. A `diagram-docs.yaml` config is created automatically if one doesn't exist.

If you prefer using `npx diagram-docs ...`, install from GitHub first:

```bash
npm install --save-dev github:feigi/diagram-docs
npx diagram-docs generate
```

Or install globally so `diagram-docs` is available anywhere without `npx`:

```bash
npm install --global github:feigi/diagram-docs
diagram-docs generate
```

To render diagrams to SVG or PNG, install the [D2 CLI](https://d2lang.com/releases/install). Without it you still get `.d2` source files.

### LLM-enhanced modeling

By default, if [Claude Code](https://claude.ai/download) or [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) is installed, diagram-docs uses it to produce richer descriptions, smarter component grouping, and more meaningful relationship labels. Without either, a deterministic rule-based builder is used. You can force deterministic mode:

```bash
diagram-docs generate --deterministic
```

## How it works

```
Source code  ──▶  .diagram-docs/raw-structure.json  ──▶  architecture-model.yaml  ──▶  D2 diagrams
               Scan                                   Model                      Generate
```

**Scan** — Static analysis reads source code and produces `.diagram-docs/raw-structure.json`: applications, modules, imports, dependencies, annotations. Applications are discovered by build files (`pom.xml`, `build.gradle`, `pyproject.toml`, `CMakeLists.txt`, etc.). Results are cached by checksum; unchanged files are skipped.

**Model** — Scan output is converted into `architecture-model.yaml`. In deterministic mode, a rule-based builder maps modules to components, detects external systems from dependencies, and infers actors from annotations. In LLM mode, the deterministic model is generated first as an anchor, then refined by an LLM agent for better descriptions, grouping, and relationship labels. The tool shells out to Claude Code or Copilot CLI — it never calls an LLM API directly.

**Generate** — The architecture model is rendered as D2 diagrams at three C4 levels:

| Level | File | Shows |
|-------|------|-------|
| Context (L1) | `c1-context.d2` | System, actors, external systems |
| Container (L2) | `c2-container.d2` | Applications within the system |
| Component (L3) | `c3-component.d2` | Components within each application |

## Supported languages

| Language | Discovered by | Extracted |
|----------|--------------|-----------|
| Java | `pom.xml`, `build.gradle`, `build.gradle.kts` | Packages, imports, Spring annotations, Maven/Gradle dependencies, multi-module subprojects, published coordinates |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt` | Modules, imports, framework detection (FastAPI, Flask, Django), dependencies |
| TypeScript | `tsconfig.json`, `package.json` | Modules from tsconfig source roots, imports, framework detection (Express, NestJS, Next.js), package dependencies |
| C | `CMakeLists.txt`, `Makefile` | Header/source structure, `#include` directives, public API from header exports |

## Output structure

```
diagram-docs.yaml              # Config — created on first run
architecture-model.yaml        # Architecture model — edit to refine diagrams

.diagram-docs/
  manifest.yaml              # Checksums for incremental builds
  raw-structure.json         # Scan output

docs/architecture/
  c1-context.d2              # User-facing — scaffolded once, never overwritten
  c2-container.d2
  styles.d2
  _generated/                # Overwritten each run
    c1-context.d2
    c2-container.d2
  containers/
    <id>/
      c3-component.d2       # User-facing
      _generated/
        c3-component.d2
```

All output should be checked into version control. The `manifest.yaml` checksums enable incremental builds — without it, CI will re-scan and rebuild everything on each run.

User-facing files use D2 `@import` to pull in generated content. Edit them freely — your changes survive regeneration. Generated files in `_generated/` are overwritten on every run.

Container diagrams include drill-down links to component diagrams. All output is deterministic and sorted for stable diffs.

### Submodule docs

With submodules enabled, each application also gets its own docs directory:

```
<app-path>/docs/architecture/
  c3-component.d2
  architecture-model.yaml    # Model fragment for reference
  styles.d2
  _generated/
    c3-component.d2
```

## Configuration

`diagram-docs.yaml` is created automatically on first run. Key options:

```yaml
system:
  name: "My System"             # Inferred from directory name if not set
  description: ""

scan:
  include: ["**"]
  exclude: ["**/*test*/**", "**/node_modules/**", "**/build/**", "**/dist/**", "**/target/**"]

levels:
  context: true                 # L1
  container: true               # L2
  component: true               # L3

abstraction:
  granularity: balanced         # detailed | balanced | overview
  excludePatterns:              # Cross-cutting concerns to omit from diagrams
    - logging
    - metrics
    - middleware
    - config
    - utils

externalSystems:                # Declare known external systems
  - name: PostgreSQL
    technology: SQL
    usedBy: [user-api]

output:
  dir: docs/architecture
  format: svg                   # svg | png
  theme: 0                      # D2 theme ID
  layout: elk                   # D2 layout engine

llm:
  provider: auto                # auto | claude-code | copilot
  model: sonnet
  concurrency: 10               # Max parallel LLM calls

submodules:
  enabled: true
  docsDir: docs
  overrides:
    some-app:
      docsDir: documentation
      exclude: false
```

### Granularity

| Level | Behavior |
|-------|----------|
| `detailed` | 1:1 module-to-component mapping |
| `balanced` | Groups modules into up to 20 components using common-prefix grouping |
| `overview` | One component per container |

### External systems

Dependencies like PostgreSQL, Kafka, and Redis are auto-detected from build files. Config entries take precedence and let you specify `usedBy` relationships explicitly.

## Architecture model

`architecture-model.yaml` bridges scan output and diagrams. It's generated automatically but designed to be edited:

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
    technology: SMTP

containers:
  - id: user-api
    applicationId: services-user-api
    name: User API
    technology: Java / Spring Boot

components:
  - id: user-controller
    containerId: user-api
    name: User Controller
    technology: Spring MVC
    moduleIds: [services-user-api-com-example-user]

relationships:
  - sourceId: user
    targetId: user-api
    label: "Manages users via"
    technology: HTTPS
```

Delete this file to regenerate from scratch on the next run.

## Commands

`generate` runs the full pipeline. Each phase is also available standalone:

```bash
diagram-docs init                    # Create config
diagram-docs scan                    # Scan only → .diagram-docs/raw-structure.json
diagram-docs model                   # Build model → architecture-model.yaml
diagram-docs model --llm             # Build model with LLM refinement
diagram-docs generate                # Full pipeline
diagram-docs generate --deterministic  # Full pipeline, no LLM
```

### Flags

**scan**
| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Config file path |
| `-o, --output <path>` | Output file (default: stdout) |
| `--force` | Skip cache, re-scan everything |

**model**
| Flag | Description |
|------|-------------|
| `-i, --input <path>` | Path to `raw-structure.json` |
| `-o, --output <path>` | Output file path |
| `-c, --config <path>` | Config file path |
| `--llm` | Use LLM for model generation |

**generate**
| Flag | Description |
|------|-------------|
| `-m, --model <path>` | Path to `architecture-model.yaml` |
| `-c, --config <path>` | Config file path |
| `--submodules` | Generate per-application docs |
| `--deterministic` | Skip LLM, use rule-based builder |

## Development

```bash
npm run dev -- scan --help    # Run without building
npm run build                 # Compile TypeScript
npm test                      # All tests
npm run typecheck             # Type-check only
npm run lint                  # ESLint
```

### Quality suites

```bash
npm run test:correctness      # Precision/recall/F1 against ground truth
npm run test:drift            # Output stability across model mutations
npm run test:tokens           # Token efficiency of scan output
npm run bench                 # Performance benchmarks
```

### Adding a language analyzer

1. Create `src/analyzers/<language>/index.ts` implementing `LanguageAnalyzer`
2. Register in `src/analyzers/registry.ts`
3. Add a ground truth fixture in `tests/quality/fixtures/` (see `TEMPLATE.md`)
