# Recursive Diagram Generation

## Summary

Redesign diagram-docs from a flat, single-system pipeline into a recursive descent engine that works for any code repository. The tool walks the folder hierarchy, classifies each folder's C4 role (System, Container, Component, Code), generates appropriate diagrams at each level, and links them together. An LLM agent assists with classification and naming by default.

## Problem

The current tool operates on a flat set of discovered applications within a single root. It generates one system's worth of diagrams (one L1 Context, one L2 Container, and per-container L3 Component diagrams). This doesn't scale to:

- Monorepos with deeply nested structure
- Repositories where different subtrees need different C4 levels
- Small libraries that only need Code-level diagrams
- Organizations where folder depth implies system boundaries

## Design

### Folder Classification — The `inferRole` Engine

The core intelligence is deciding what C4 role each folder plays. This uses a scoring system based on structural signals, refined by an LLM agent.

#### Structural signals collected per folder

| Signal | How detected | What it suggests |
|--------|-------------|-----------------|
| Build file present | Glob for pom.xml, package.json, pyproject.toml, etc. | Deployable unit or library (Container) |
| Multiple children with build files | Count children with their own build files | Aggregator level (System) |
| Infrastructure files | Dockerfile, docker-compose.yml, k8s/, terraform/ | Deployment boundary (System or Container) |
| Source files present | *.java, *.py, *.c, *.ts | Has code (Component or Code) |
| Package/module structure | Subdirs with `__init__.py`, Java package dirs, header dirs | Component with internal structure |
| File count / code volume | Count source files recursively | Distinguishes trivial from meaningful |
| Depth relative to root | How deep in the tree | Tiebreaker — deeper = less likely to be System |

#### Heuristic classification (fallback when agent is disabled)

```
function inferRole(folder, signals):
  if signals.childrenWithBuildFiles >= 2:
    return "system"

  if signals.hasBuildFile && signals.hasSourceFiles:
    if signals.hasPackageStructure:
      return "container"
    else:
      return "code-only"

  if signals.isPackageDir && signals.hasSourceFiles:
    return "component"

  return "skip"
```

#### What each role generates

| Role | Diagrams produced | Links to |
|------|------------------|----------|
| `system` | Context + Container | Children classified as `container` or `code-only` |
| `container` | Component | Children classified as `component` |
| `component` | Code (class/function diagram) | Nothing (leaf) |
| `code-only` | Code only | Nothing (leaf) |

### Recursive Descent — `processFolder`

The core loop. One function that starts at root and recurses, generating diagrams at each meaningful level.

```
function processFolder(folderPath, parentContext?):
  // 1. Collect signals
  signals = collectSignals(folderPath)

  // 2. Classify
  if agentEnabled:
    role, name, description = agentClassify(folderPath, signals)
  else:
    role = inferRole(folderPath, signals)
    name = humanize(folderPath)
    description = null

  if role == "skip": return

  // 3. Light pre-scan of immediate children to know what links to emit
  childPreviews = []
  for child in relevantSubdirs(folderPath):
    childSignals = collectSignals(child)
    childRole = quickClassify(childSignals)  // heuristic only, fast
    if childRole != "skip":
      childPreviews.push({ path: child, role: childRole })

  // 4. Scan + Model + Generate for THIS folder
  rawStructure = scan(folderPath, role)
  model = buildModel(rawStructure, role, name, description)
  generate(model, role, childPreviews, parentContext)
  //   childPreviews used to emit drill-down links
  //   parentContext used to emit breadcrumb back to parent

  // 5. Recurse into children
  for child in childPreviews:
    processFolder(child.path, {
      parentPath: folderPath,
      parentRole: role,
      parentName: name
    })
```

#### Key design decisions

**Pre-scan for links**: Before generating the current level's diagrams, a quick heuristic-only classification of immediate children runs. This determines what drill-down links to emit without requiring a full tree walk. The full agent classification happens when recursion reaches each child.

**parentContext**: Passed down so each level generates a breadcrumb link back to its parent's diagram.

**relevantSubdirs**: Filters out noise (node_modules, build output, .git, etc.) using existing `scan.exclude` patterns.

**Scoping scan per role**:
- `system`: Don't analyze source code — just identify children as containers
- `container`: Analyze source code to extract modules/packages (existing behavior)
- `component`: Analyze source code within this module to extract classes/functions
- `code-only`: Same as component but no parent container context

**Output per folder**: Each classified folder gets `<folder>/<docsDir>/architecture/` with role-appropriate diagrams:

```
repo/
  docs/architecture/
    context.d2              <- system-level
    container.d2            <- shows services as boxes
  services/order-service/
    docs/architecture/
      component.d2          <- packages within order-service
    src/com/example/orders/api/
      docs/architecture/
        code.d2             <- classes within the api package
```

### Code-Level Diagrams — The New Fourth Level

New functionality. Existing analyzers extract modules and imports but don't look inside modules.

#### What Code diagrams show per language

| Language | Extracted elements | Relationships |
|----------|-------------------|---------------|
| Java | Classes, interfaces, enums, records | Inheritance, implementation, field types, method params |
| Python | Classes, top-level functions, module-level constants | Inheritance, imports between symbols, decorators |
| C | Structs, typedefs, function declarations, function definitions | Struct field types, function param/return types, call graph (best-effort) |

#### Analyzer interface extension

Existing `LanguageAnalyzer.analyze()` is unchanged. A new method is added:

```ts
analyzeModule(modulePath, config) → { symbols: Symbol[], relationships: Relationship[] }
```

Where `Symbol` is:

```ts
{
  id: string,
  name: string,
  kind: "class" | "interface" | "function" | "struct" | "enum",
  visibility?: "public" | "private"
}
```

`analyzeModule` is only called when the recursive descent reaches a `component` or `code-only` role.

#### Scope control

Not every module warrants a Code diagram:
- Skip if module has fewer than `codeLevel.minSymbols` symbols (default: 2)
- Skip if module matches `abstraction.excludePatterns`
- Agent assist can flag modules as too trivial to diagram

### Agent Assist Integration

On by default. Provides classification refinement and naming/descriptions.

#### Input (compact, no source code)

```ts
{
  folderPath: string,
  signals: {
    buildFiles: string[],
    childrenWithBuildFiles: number,
    infraFiles: string[],
    sourceFileCount: number,
    sourceLanguages: string[],
    hasPackageStructure: boolean,
    depth: number,
    childFolderNames: string[],
    readmeSnippet?: string           // first ~200 chars of README if present
  },
  heuristicRole: string,
  parentContext?: { name: string, role: string }
}
```

#### Output

```ts
{
  role: "system" | "container" | "component" | "code-only" | "skip",
  name: string,
  description: string,
  confidence: number                 // 0-1, for logging/debugging
}
```

#### Cost management

- Input is ~200-500 tokens per call (signals only, no source code)
- One call per non-skip folder
- Results cached in `.diagram-docs/agent-cache.yaml` keyed by folder path + signal hash
- Re-running on unchanged repo makes zero LLM calls
- `--no-agent` disables completely, falls back to heuristics

### Configuration & Overrides

One `diagram-docs.yaml` at repo root. Users correct classification after the first run.

```yaml
system:
  name: "My Platform"
  description: "E-commerce platform"

scan:
  include: ["**"]
  exclude: ["test/*", "node_modules/*", "build/*"]

agent:
  enabled: true
  provider: "anthropic"
  model: "claude-sonnet-4-20250514"

output:
  docsDir: "docs"
  theme: 0
  layout: "elk"
  format: "svg"

abstraction:
  granularity: "balanced"
  excludePatterns: ["logging", "metrics", "utils"]
  codeLevel:
    minSymbols: 2

overrides:
  "services/order-service":
    role: "container"
    name: "Order Service"
    description: "Handles order lifecycle"
  "libs/shared-utils":
    role: "skip"
  "services/legacy-gateway":
    role: "code-only"
```

**Override semantics**: Flat map keyed by folder path relative to repo root. Only specified fields are overridden — everything else uses heuristic/agent classification.

## Changes to Existing Code

### Kept as-is
- Language analyzers (`src/analyzers/`) — existing `analyze()` methods
- D2 writer (`src/generator/d2/writer.ts`)
- D2 styles (`src/generator/d2/styles.ts`) — add `code` class only
- Config loader (`src/config/loader.ts`) — extended, not rewritten
- Humanize, slugify, checksum utilities

### Modified
- **Config schema** (`src/config/schema.ts`): Add `agent`, `overrides`, `codeLevel` sections
- **CLI commands** (`src/cli/commands/`): Existing scan/model/generate still work individually; new `diagram-docs run` command orchestrates recursive descent
- **Discovery** (`src/core/discovery.ts`): Refactored into signal collection — same glob logic, returns signals instead of just app list
- **Model builder** (`src/core/model-builder.ts`): Handle role-scoped model building
- **Container/Component generators**: Add breadcrumb links to parent, drill-down links from `childPreviews`

### New code
- `src/core/classifier.ts` — signal collection + heuristic classification
- `src/core/recursive-runner.ts` — the `processFolder` recursive descent
- `src/core/agent-assist.ts` — LLM integration for classification + naming
- `src/analyzers/*/symbols.ts` — per-language `analyzeModule()` for Code-level extraction
- `src/generator/d2/code.ts` — Code-level D2 diagram generator
- Agent result cache management

### Removed
- `src/generator/d2/submodule-scaffold.ts` — subsumed by recursive descent; each folder's diagrams are generated naturally during recursion

## Testing Strategy

- **Unit tests**: Classifier heuristics with known folder structures, model builder per role, Code-level symbol extraction per language
- **Integration tests**: Full recursive descent on fixture repos (monorepo, single-app, small library)
- **Snapshot tests**: D2 output stability across runs
- **Agent mock tests**: Verify agent input/output contract, cache behavior, fallback to heuristics
