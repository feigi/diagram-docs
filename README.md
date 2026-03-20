# diagram-docs

Generate [C4 architecture diagrams](https://c4model.com) in [D2](https://d2lang.com) from source code. Static analysis extracts code facts; an LLM agent provides the semantic reasoning.

## How it works

```
Source code  ──▶  diagram-docs scan     ──▶  raw-structure.json
                                                    │
                                              Agent reasons about
                                              structure, writes model
                                                    │
Model YAML   ──▶  diagram-docs generate ──▶  D2 diagrams + SVG/PNG
```

`scan` reads code. `generate` writes diagrams. The agent sits in between — it reads the scan output, decides how to group modules into components, names things, identifies actors and external systems, and writes `architecture-model.yaml`. The tool never calls an LLM itself.

## Quick start

```bash
npm install && npm run build

# Scaffold config
diagram-docs init

# Scan your codebase
diagram-docs scan -o raw-structure.json

# Write architecture-model.yaml (by hand or via LLM agent)

# Generate diagrams
diagram-docs generate --model architecture-model.yaml
```

If the [D2 CLI](https://d2lang.com/releases/install) is installed, `generate` also renders SVG or PNG files automatically.

## Supported languages

| Language | Build files | What's extracted |
|----------|------------|------------------|
| Java | `pom.xml`, `build.gradle`, `build.gradle.kts` | Packages, imports, Spring annotations, Maven dependencies |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt` | Modules, imports, framework detection (FastAPI, Flask, Django), dependencies |
| C | `CMakeLists.txt`, `Makefile` | Header/source structure, `#include` directives |

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

Results are cached in `.diagram-docs/manifest.yaml` — unchanged files skip re-analysis.

### `diagram-docs generate`

Generate D2 diagrams from an architecture model.

| Flag | Description |
|------|-------------|
| `-m, --model <path>` | Path to `architecture-model.yaml` (required) |
| `-c, --config <path>` | Path to `diagram-docs.yaml` |

Renders SVG/PNG via the D2 CLI if available. Checks user-facing D2 files for stale references and prints drift warnings.

## Configuration

`diagram-docs.yaml`:

```yaml
system:
  name: "My System"
  description: ""

scan:
  include: ["**"]
  exclude:
    - "**/test/**"
    - "**/node_modules/**"
    - "**/build/**"
    - "**/dist/**"
    - "**/target/**"

levels:
  context: true       # L1 — system + actors + external systems
  container: true      # L2 — containers within the system
  component: false     # L3 — components within each container

abstraction:
  granularity: balanced   # detailed | balanced | overview
  excludePatterns:        # cross-cutting concerns to omit
    - logging
    - metrics
    - middleware

output:
  dir: docs/architecture
  format: svg          # svg | png
  theme: 0             # D2 theme ID
  layout: elk          # D2 layout engine
```

## Output structure

```
docs/architecture/
  _generated/                    # Overwritten each run
    context.d2
    container.d2
  containers/
    <id>/_generated/
      component.d2
  context.d2                     # User-facing — imports _generated, never overwritten
  container.d2
  containers/<id>/component.d2
  styles.d2
```

Generated files are deterministic and sorted by ID. User-facing files are scaffolded once and never overwritten — customize them freely. D2 `@import` merges your changes with generated content. Container diagrams include drill-down links to component diagrams when L3 is enabled.

## Architecture model

The bridge between scan output and diagrams. Typically written by an LLM agent reading `raw-structure.json`.

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
```

### Adding a language analyzer

1. Create `src/analyzers/<language>/index.ts` implementing `LanguageAnalyzer`
2. Register in `src/analyzers/registry.ts`
3. Add a ground truth fixture in `tests/quality/fixtures/`

See `tests/quality/fixtures/TEMPLATE.md` for a guided workflow.
