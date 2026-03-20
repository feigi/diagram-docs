# diagram-docs

C4 architecture diagram generator that combines static code analysis with agent-driven semantic reasoning to produce [D2](https://d2lang.com) diagrams.

The tool is deterministic — it scans code and generates D2. The LLM intelligence comes from the calling agent (Claude Code, GitHub Copilot), which orchestrates the tool and provides semantic abstraction.

## How It Works

```
Source Code
    │
    ▼
diagram-docs scan          →  raw-structure.json     (code facts)
    │
    │  Agent reads raw-structure, reasons about it,
    │  produces architecture-model.yaml
    ▼
diagram-docs generate      →  *.d2 files             (C4 diagrams)
```

Three CLI commands. The agent orchestrates them:

1. **`scan`** — Static analysis of source code → structured JSON
2. **`generate`** — Architecture model → D2 diagram files
3. **`init`** — Scaffold a config file

## Quick Start

```bash
npm install
npm run build

# 1. Create config
diagram-docs init

# 2. Scan your codebase
diagram-docs scan -o raw-structure.json

# 3. Create architecture-model.yaml (manually or via LLM agent)

# 4. Generate D2 diagrams
diagram-docs generate --model architecture-model.yaml
```

## Supported Languages

| Language | Build Files Detected | What's Extracted |
|----------|---------------------|------------------|
| Java     | `pom.xml`, `build.gradle`, `build.gradle.kts` | Packages, imports, Spring annotations (`@Controller`, `@Service`, `@Repository`), Maven dependencies |
| Python   | `pyproject.toml`, `setup.py`, `requirements.txt` | Modules, imports, framework detection (FastAPI, Flask, Django), pip/pyproject dependencies |
| C        | `CMakeLists.txt`, `Makefile` | Header/source structure, `#include` directives (system vs local) |

## Configuration

`diagram-docs.yaml` at repo root:

```yaml
system:
  name: "My System"                    # Name shown on context diagram
  description: ""                      # Description for context diagram

scan:
  include:                             # Glob patterns for app discovery
    - "**"                             # Default: scan everything
  exclude:                             # Paths to skip
    - "**/test/**"
    - "**/tests/**"
    - "**/node_modules/**"
    - "**/build/**"
    - "**/dist/**"
    - "**/target/**"

levels:
  context: true                        # L1 — system + actors + external systems
  container: true                      # L2 — containers within the system
  component: false                     # L3 — components within each container

abstraction:
  granularity: balanced                # detailed | balanced | overview
  excludePatterns:                     # Cross-cutting concerns to omit
    - logging
    - metrics
    - middleware
    - config
    - utils

output:
  dir: docs/architecture               # Where D2 files are written
  theme: 0                             # D2 theme ID
  layout: elk                          # D2 layout engine
```

## CLI Reference

### `diagram-docs init`

Scaffold a `diagram-docs.yaml` config file in the current directory.

```
Options:
  -f, --force    Overwrite existing config file
```

### `diagram-docs scan`

Scan source code and produce `raw-structure.json`.

```
Options:
  -c, --config <path>    Path to diagram-docs.yaml
  -o, --output <path>    Output file path (default: stdout)
  --force                Skip cache and re-scan everything
```

Discovers applications by matching build files against `scan.include` patterns, then runs the appropriate language analyzer for each. Results are cached in `.diagram-docs/manifest.yaml` — unchanged source files skip re-analysis.

### `diagram-docs generate`

Generate D2 diagrams from an architecture model.

```
Options:
  -m, --model <path>     Path to architecture-model.yaml (required)
  -c, --config <path>    Path to diagram-docs.yaml
```

## Output Structure

```
docs/architecture/
  _generated/                          # Overwritten each run
    context.d2                         # L1: system + actors + external systems
    container.d2                       # L2: containers within the system
    components/
      <container-id>.d2               # L3: components per container
  context.d2                           # User-facing: imports _generated/context.d2
  container.d2                         # User-facing: imports _generated/container.d2
  components/
    <container-id>.d2                 # User-facing per container
  styles.d2                            # C4 styles and theme config
```

**Stability guarantees:**
- `_generated/` files are overwritten every run — deterministic output, sorted alphabetically by ID
- User-facing files are created once (scaffolded), never overwritten
- Users customize the non-generated files; D2 `@import` merges them with generated content
- All D2 shape IDs are derived deterministically from model element IDs

## Architecture Model

The model is the bridge between scan output and diagram generation. It's typically produced by an LLM agent reading `raw-structure.json`, but can also be written by hand.

```yaml
version: 1
system:
  name: "My System"
  description: "What this system does"

actors:
  - id: user
    name: User
    description: "End user of the system"

externalSystems:
  - id: email-provider
    name: Email Provider
    description: "Sends transactional emails"
    technology: SMTP                   # optional

containers:
  - id: user-api
    applicationId: services-user-api   # Links to ScannedApplication.id
    name: User API
    description: "Handles user management"
    technology: Java / Spring Boot

components:                            # Only needed if levels.component: true
  - id: user-controller
    containerId: user-api
    name: User Controller
    description: "REST endpoint for users"
    technology: Spring MVC
    moduleIds:                         # Links to ScannedModule.id
      - services-user-api-com-example-user

relationships:
  - sourceId: user
    targetId: user-api
    label: "Manages users via"
    technology: HTTPS                  # optional
```

JSON schemas for both `raw-structure.json` and `architecture-model.yaml` are in `src/schemas/`.

## Agent Workflow

The intended workflow when used with an LLM agent:

```bash
# Agent runs scan
diagram-docs scan -o raw-structure.json

# Agent reads raw-structure.json, reasons about it:
# - Groups modules into meaningful components
# - Names containers and components
# - Infers relationships and labels
# - Identifies actors and external systems
# Agent writes architecture-model.yaml

# Agent runs generate
diagram-docs generate --model architecture-model.yaml
```

The agent never runs inside the tool. The tool provides code facts; the agent provides semantic understanding.

## Quality Metrics

The project includes a quality measurement framework for iterative improvement. Each run outputs scored metrics with actionable suggestions.

### Running Quality Checks

```bash
npm run test:quality        # All quality checks
npm run test:correctness    # Analyzer accuracy (P/R/F1)
npm run test:drift          # Output stability across mutations
npm run test:tokens         # Token efficiency analysis
npm run bench               # Execution speed benchmarks
```

### Correctness

Measures precision, recall, and F1 per category against hand-verified ground truth fixtures.

**Categories scored independently:**
- Module discovery
- Export detection
- Import resolution (including `isExternal` flag)
- External dependency extraction
- Metadata extraction (Spring annotations, framework detection)

### Drift

Measures output stability across model mutations. Quantifies how much output changes when input changes.

**Scenarios tested:**
- Determinism — same model produces identical output
- Additive changes — adding containers, components, relationships
- Renames — ID changes cascade through D2 output
- Removals — impact on remaining output

**Metrics:** stability score (0–1), line churn, ID rename count, user file breakage detection.

### Token Efficiency

Measures token cost of `raw-structure.json` for LLM consumption.

**Metrics:** total tokens, tokens per entity, compact vs pretty savings, per-app breakdown.

### Execution Speed

Vitest benchmarks for individual analyzers, D2 generators, and full pipeline.

### Adding Test Fixtures

See `tests/quality/fixtures/TEMPLATE.md` for an LLM-guided workflow:

1. Create source code in `tests/fixtures/`
2. Generate `expected.json` using the provided LLM prompt template
3. Add one entry to the `FIXTURES` array in `correctness.test.ts`

## Development

```bash
npm run dev -- scan --help   # Run CLI without building
npm run build                # Compile TypeScript
npm test                     # Run all tests (68 tests)
npm run test:watch           # Watch mode
npm run bench                # Performance benchmarks
npm run typecheck            # Type checking only
```

## Adding a Language Analyzer

1. Create `src/analyzers/<language>/index.ts` implementing `LanguageAnalyzer`:

```typescript
interface LanguageAnalyzer {
  id: string;
  name: string;
  buildFilePatterns: string[];
  analyze(appPath: string, config: ScanConfig): Promise<ScannedApplication>;
}
```

2. Register in `src/analyzers/registry.ts`
3. Add a ground truth fixture in `tests/quality/fixtures/`
