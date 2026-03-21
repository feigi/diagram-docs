# diagram-docs

Generate [C4 architecture diagrams](https://c4model.com) in [D2](https://d2lang.com) from source code. Static analysis extracts code structure; an LLM agent provides the semantic reasoning.

## How it works

```
Source code  ──▶  diagram-docs scan   ──▶  raw-structure.json
                                                │
                                          Agent reasons about
                                          structure, writes model
                                          (or use deterministic model command)
                                                │
Model YAML   ──▶  diagram-docs generate ──▶  D2 diagrams + SVG/PNG
```

`scan` reads code. `generate` writes diagrams. The agent sits in between — it reads the scan output, decides how to group modules into components, names things, identifies actors and external systems, and writes `architecture-model.yaml`. The tool never calls an LLM itself.

Alternatively, `model` produces a deterministic architecture model directly from scan output — no LLM needed. Use it as a starting point and refine from there.

## Quick start

```bash
npm install && npm run build
```

### Zero-config (simplest)

Run `generate` in any project directory — it discovers source code, scans, builds a model, and generates diagrams automatically:

```bash
diagram-docs generate
```

### Step-by-step

For more control over each stage:

```bash
# Scaffold config
diagram-docs init

# Scan your codebase
diagram-docs scan -o raw-structure.json

# Generate a deterministic model (or write one by hand / via LLM agent)
diagram-docs model -i raw-structure.json -o architecture-model.yaml

# Generate diagrams
diagram-docs generate --model architecture-model.yaml
```

If the [D2 CLI](https://d2lang.com/releases/install) is installed, `generate` also renders SVG or PNG files automatically.

## Supported languages

| Language | Build files | What's extracted |
|----------|------------|------------------|
| Java | `pom.xml`, `build.gradle`, `build.gradle.kts` | Packages, imports, Spring annotations (`@Controller`, `@Service`, `@Repository`, `@Component`, `@Configuration`, `@Entity`), Maven/Gradle dependencies, multi-module subprojects, `publishedAs` coordinates for cross-app matching |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt` | Modules, imports, framework detection (FastAPI, Flask, Django), dependencies |
| C | `CMakeLists.txt`, `Makefile` | Header/source structure, `#include` directives (system vs local), public API from header exports |

## CLI reference

### `diagram-docs init`

Create a `diagram-docs.yaml` config file.

| Flag | Description |
|------|-------------|
| `-f, --force` | Overwrite existing config |

### `diagram-docs scan`

Analyze source code and produce `raw-structure.json`.

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to `diagram-docs.yaml` |
| `-o, --output <path>` | Output file (default: stdout) |
| `--force` | Skip cache, re-scan everything |

Results are cached in `.diagram-docs/manifest.yaml` — unchanged files skip re-analysis. A post-scan pass matches `publishedAs` coordinates across applications for cross-app import resolution.

### `diagram-docs model`

Generate `architecture-model.yaml` deterministically from scan output, without an LLM.

| Flag | Description |
|------|-------------|
| `-i, --input <path>` | Path to `raw-structure.json` (default: `.diagram-docs/raw-structure.json`) |
| `-o, --output <path>` | Output file path (default: `architecture-model.yaml`) |
| `-c, --config <path>` | Path to `diagram-docs.yaml` |

The deterministic model builder:
- Creates one container per scanned application (skipping shell parent projects like Gradle multi-module roots)
- Groups modules into components based on the configured `granularity` level
- Promotes known dependencies (PostgreSQL, Redis, Kafka, etc.) to external systems
- Derives cross-container relationships from import analysis

### `diagram-docs generate`

Generate D2 diagrams from an architecture model.

| Flag | Description |
|------|-------------|
| `-m, --model <path>` | Path to `architecture-model.yaml` |
| `-c, --config <path>` | Path to `diagram-docs.yaml` |
| `--submodules` | Generate per-application docs alongside root diagrams |

Model resolution when `-m` is not provided:
1. Look for `architecture-model.yaml` near the config file
2. Auto-generate from `.diagram-docs/raw-structure.json` if it exists
3. Auto-scan the source code, build a model, and generate diagrams

This means `diagram-docs generate` works with zero setup — no config file, no prior scan needed.

Renders SVG/PNG via the D2 CLI if available. Validates generated D2 before rendering. Checks user-facing D2 files for stale references and prints drift warnings.

## Configuration

A `diagram-docs.yaml` config file is optional. Without one, defaults are derived from the project directory name.

```yaml
system:
  name: "My System"
  description: ""

scan:
  include: ["**"]
  exclude:
    - "**/test/**"
    - "**/tests/**"
    - "**/node_modules/**"
    - "**/build/**"
    - "**/dist/**"
    - "**/target/**"

levels:
  context: true       # L1 — system + actors + external systems
  container: true      # L2 — containers within the system
  component: true      # L3 — components within each container

abstraction:
  granularity: balanced   # detailed | balanced | overview
  excludePatterns:        # cross-cutting concerns to omit
    - logging
    - metrics
    - middleware
    - config
    - utils

externalSystems:              # declare known external systems
  - name: PostgreSQL
    technology: SQL
    usedBy: [user-api]        # container IDs that use this system
  - name: Redis
    technology: Cache

output:
  dir: docs/architecture
  format: svg          # svg | png
  theme: 0             # D2 theme ID
  layout: elk          # D2 layout engine

submodules:
  enabled: true            # generate per-app docs
  docsDir: docs            # docs folder within each app
  overrides:               # per-app overrides
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

The `externalSystems` config lets you declare infrastructure dependencies that should appear on the context diagram. Each entry specifies a `name`, optional `technology`, and optional `usedBy` list of container IDs to create relationships automatically.

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

Diagram filenames are prefixed with their C4 level (`c1-`, `c2-`, `c3-`) for easy identification.

Generated files are deterministic and sorted by ID. User-facing files are scaffolded once and never overwritten — customize them freely. D2 `@import` merges your changes with generated content. Container diagrams include drill-down links to component diagrams when L3 is enabled.

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

Submodule docs include relative links back to the root system diagrams.

## Architecture model

The bridge between scan output and diagrams. Can be written by the `model` command, by hand, or by an LLM agent reading `raw-structure.json`.

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
    applicationId: services-user-api    # links to ScannedApplication.id
    name: User API
    technology: Java / Spring Boot

components:
  - id: user-controller
    containerId: user-api
    name: User Controller
    technology: Spring MVC
    moduleIds:
      - services-user-api-com-example-user

relationships:
  - sourceId: user
    targetId: user-api
    label: "Manages users via"
    technology: HTTPS
```

JSON schemas for both `raw-structure.json` and `architecture-model.yaml` are in `src/schemas/`.

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
