# C4 Code-Level (L4) Diagrams Design

## Goal

Add a fourth C4 level — the **code** level, per the C4 spec's terminology — to diagram-docs. Each component gets its own D2 diagram showing the code-level building blocks inside it: classes/interfaces/enums for Java, classes and module-level functions for Python, structs/typedefs/functions for C. The diagram renders types, their relationships (inheritance, containment, usage), and public members.

This is a structural view, not a behavioral one — method-call graphs are explicitly out of scope for v1.

## Scope

### In scope (v1)

- Per-component L4 diagrams for Java, Python, and C.
- Tree-sitter-based extraction for all three languages.
- Public-only elements and members by default, with config to include private.
- Fields and methods shown with type signatures inside `shape: class` boxes.
- Cross-component references rendered as external nodes in the source's diagram.
- Same scaffold pattern as C3: a user-editable `c4-code.d2` plus a `_generated/c4-code.d2` that it imports.
- Deterministic model-building — no LLM.
- Components with fewer than `minElements` elements are skipped.

### Out of scope (v1)

- Method-call graphs and any behavioral/dynamic analysis.
- LLM enrichment of class/function descriptions.
- TypeScript and other languages (the existing Java/Python/C analyzer set).
- Fully-resolved fully-qualified type names for stdlib or third-party references — these are dropped silently.
- Per-component manual configuration (e.g., "always include private for this component") — the settings in `diagram-docs.yaml` apply globally in v1.

## Config Surface

Add to `src/config/schema.ts`:

```yaml
levels:
  context: true
  container: true
  component: true
  code: false # new; defaults off

code:
  includePrivate: false # include file-private / _-prefixed / non-public members and elements
  includeMembers: true # render fields and methods inside class boxes
  minElements: 2 # skip components with fewer than N code elements
```

All new fields are optional with the defaults above. Existing configs remain valid.

## Terminology

C4 officially calls the fourth level **"Code"** (not "Class"), keeping it language-agnostic. We use `code` throughout:

- File: `c4-code.d2`
- Config: `levels.code`
- Generator: `src/generator/d2/code.ts`

## Data Model

Two optional additions, populated only when `levels.code: true`.

### Raw scan output

Added to `ScannedModule` in `src/analyzers/types.ts`:

```ts
interface ScannedModule {
  // existing fields unchanged
  codeElements?: RawCodeElement[];
}

interface RawCodeElement {
  id: string; // module-scoped, e.g. "com.example.UserService"
  kind: string; // language-specific: "class" | "interface" | "enum" |
  //   "function" | "struct" | "typedef"
  name: string; // display name
  visibility?: "public" | "internal" | "private";
  parentId?: string; // nested classes, methods on classes
  members?: CodeMember[]; // fields + methods shown inside shape:class
  tags?: string[]; // annotations, decorators, "static", "abstract"
  references?: RawCodeReference[]; // unresolved name refs
  location: { file: string; line: number }; // for drift + traceability
}

interface CodeMember {
  name: string;
  kind: "field" | "method";
  signature?: string; // pre-rendered, e.g. "insert(key: String, value: Object): void"
  visibility?: "public" | "internal" | "private";
}

interface RawCodeReference {
  targetName: string; // unresolved short name as it appears in source
  kind: "extends" | "implements" | "uses" | "contains";
}
```

### Architecture model

Added to `ArchitectureModel` in `src/analyzers/types.ts`:

```ts
interface ArchitectureModel {
  // existing fields unchanged
  codeElements?: CodeElement[];
  codeRelationships?: CodeRelationship[];
}

interface CodeElement {
  id: string; // "{containerId}.{componentId}.{localId}"
  componentId: string;
  kind: string;
  name: string;
  visibility?: "public" | "internal" | "private";
  parentElementId?: string;
  members?: CodeMember[];
  tags?: string[];
}

interface CodeRelationship {
  sourceId: string;
  targetId: string; // may be "external:..." for stdlib / cross-container refs
  kind: "inherits" | "implements" | "uses" | "contains";
  label?: string;
}
```

### Name resolution

The model-builder resolves each `RawCodeReference.targetName` to a full ID:

1. **Same-component match** → internal edge targeting the resolved element.
2. **Same-container, different-component match** → cross-component edge; the target is added as an external reference in the source's rendered diagram.
3. **Unresolvable** (stdlib, third-party, unknown) → dropped silently in v1.

Resolution uses the existing `ScannedModule.imports` table together with the global element registry built from all `codeElements` across the model.

### Reference kind mapping

`RawCodeReference.kind` uses the vocabulary found in source syntax; `CodeRelationship.kind` uses the abstract semantic vocabulary. The model-builder applies this fixed mapping:

| Raw kind     | Model kind   | Notes                                                   |
| ------------ | ------------ | ------------------------------------------------------- |
| `extends`    | `inherits`   | Java `extends`, Python base class in class declaration. |
| `implements` | `implements` | Java `implements`. No Python equivalent in v1.          |
| `uses`       | `uses`       | Field, parameter, or return type references.            |
| `contains`   | `contains`   | Struct field references another struct (C).             |

### Schemas

- `src/schemas/raw-structure.schema.json` — add `codeElements` under each `ScannedModule`.
- `src/schemas/architecture-model.schema.json` — add `codeElements` and `codeRelationships` at the top level.
- Zod schemas in `src/config/schema.ts` for the new `code` config section.

## Pipeline Flow

### Scan phase

`src/core/scan.ts` is unchanged. The language analyzers gate new behavior on `config.levels.code`:

1. When enabled, each analyzer runs tree-sitter over every source file in each module.
2. Per-language tree-sitter queries, stored as `.scm` files under `src/analyzers/<lang>/queries/`, match classes, structs, functions, etc., emitting `RawCodeElement[]`.
3. `raw-structure.json` grows `codeElements` arrays per module. When disabled, output is unchanged.

### Model phase

`src/core/model-builder.ts` gets a new pass after component building:

1. `buildCodeModel(rawStructure, components, config)` walks every `ScannedModule` that belongs to a component.
2. For each `RawCodeElement`, it assigns a qualified ID (`{containerId}.{componentId}.{localId}`) and collects into `ArchitectureModel.codeElements`.
3. Resolves each `RawCodeReference` (see Name Resolution above) → `codeRelationships`.
4. Applies the visibility filter — default drops anything not `public`.
5. Applies the `minElements` threshold per component.

### Generate phase

`src/cli/commands/generate.ts` gets a new branch when `levels.code: true`:

1. A new generator, `src/generator/d2/code.ts`, runs per component.
2. For each component with at least `minElements` elements after filtering:
   - Writes the scaffold at `docs/architecture/containers/{containerId}/components/{componentId}/c4-code.d2` (created once, preserved on subsequent runs).
   - Writes `docs/architecture/containers/{containerId}/components/{componentId}/_generated/c4-code.d2` (always regenerated).
3. Uses the existing `D2Writer`, `stability.ts`, and `drift.ts` infrastructure.

### Caching and drift

Existing manifest checksum mechanism works at module granularity. Any change in a module's files invalidates that module's `codeElements`, which cascades to every derived `CodeElement` and every `CodeRelationship` touching those elements, which invalidates the owning component's L4 diagram. No finer granularity is added.

Drift detection (existing `drift.ts`) handles user-authored scaffold files that reference elements which no longer exist after regeneration, same as C3.

## Generator and Per-Language Rendering

### Shared skeleton

`src/generator/d2/code.ts`:

```ts
export function generateCodeDiagram(
  model: ArchitectureModel,
  component: Component,
  profile: LanguageRenderingProfile,
): string {
  const writer = new D2Writer();
  const elements = model.codeElements.filter(
    (e) => e.componentId === component.id,
  );
  const internalRels = model.codeRelationships.filter((r) =>
    bothEndsInComponent(r, component, elements),
  );
  const externalRels = model.codeRelationships.filter((r) =>
    crossesComponent(r, component, elements),
  );

  writer.comment(generationHeader(component));
  profile.renderHeader(writer, component);
  profile.renderElements(writer, elements);
  profile.renderExternalRefs(writer, externalRels);
  profile.renderRelationships(writer, [...internalRels, ...externalRels]);
  return writer.toString();
}
```

### `LanguageRenderingProfile`

One profile per supported language, selecting per-language layout, node shapes, and edge treatment:

```ts
interface LanguageRenderingProfile {
  renderHeader(writer: D2Writer, component: Component): void;
  renderElements(writer: D2Writer, elements: CodeElement[]): void;
  renderExternalRefs(writer: D2Writer, externalRels: CodeRelationship[]): void;
  renderRelationships(
    writer: D2Writer,
    relationships: CodeRelationship[],
  ): void;
}
```

### Profile selection

A component's profile is chosen by the dominant language among its modules — the language owning the most files in the component. Ties break in a deterministic, documented order: Java > Python > C. Mixed-language components default to the dominant language's profile. This rule is documented in the spec and covered by a test.

### Profiles

**Java / Python profile:**

- Each class, interface, or enum → `shape: class` node with fields and methods listed inside.
- No grouping sub-scopes by default.
- `inherits` and `implements` edges rendered with labels.
- `uses` edges rendered without labels (to avoid visual noise).
- Nested classes render as child scopes of their parent.

**Python-specific nuances:**

- Module-level functions render as plain boxes outside any class scope.
- When type hints are absent from a signature, the signature field is omitted rather than shown with synthetic `any` placeholders.

**C profile:**

- Three sub-scopes per component:
  - `types` — structs and typedefs as `shape: class` nodes with fields inside.
  - `public` — header-declared functions as plain boxes.
  - `internal` — static (file-private) functions, only present when `includePrivate: true`.
- Edge kinds used: `uses` (function signature references a struct) and `contains` (struct field references another struct).
- `inherits` / `implements` edges are filtered out by the profile.

### Stability and drift

Reuses `stability.ts` for deterministic ordering (sort by ID) and `drift.ts` for detecting stale references in user-authored scaffold files.

## Analyzer Changes

### Tree-sitter infrastructure

A new shared module `src/analyzers/tree-sitter.ts`:

- Loads WASM grammars once per language via `web-tree-sitter`.
- Exposes `runQuery(language, source, queryPath) → QueryMatch[]`.
- WASM grammars for Java, Python, and C are bundled under `assets/tree-sitter/`.

### Per-language additions

Each analyzer gets a new `code.ts` file that runs tree-sitter queries and builds `RawCodeElement[]`:

- `src/analyzers/java/code.ts` + `src/analyzers/java/queries/code.scm`
- `src/analyzers/python/code.ts` + `src/analyzers/python/queries/code.scm`
- `src/analyzers/c/code.ts` + `src/analyzers/c/queries/code.scm`

Each analyzer's `index.ts` calls its `extractCode()` only when `config.levels.code: true` and merges the result into each `ScannedModule.codeElements`.

### C preprocessor handling

Tree-sitter's C grammar parses preprocessor directives as distinct nodes and does not expand macros. For v1, the C analyzer extracts only what is directly visible in the source:

- Conditional compilation (`#if`, `#ifdef`) is ignored — tree-sitter returns both branches, and the analyzer extracts elements from both.
- Macro-defined types and functions are not extracted. A function defined via a macro expansion (e.g., `DECLARE_HANDLE(Foo)`) will not appear in the L4 diagram.
- Included headers are not followed; each translation unit is extracted independently. Duplicate declarations across `.h`/`.c` pairs are deduplicated by `(file, line, name)` tuple within the module.

These limitations are documented in the user-facing docs. Projects relying heavily on macro-generated APIs get degraded L4 output, not incorrect output.

### LLM model-builder interaction

When `llm-model-builder.ts` is the active model-building path (for description enrichment at the container/component level), L4 extraction and relationship building remain deterministic. The LLM path does not touch `codeElements` or `codeRelationships` in v1 — an agent pass that enriches code-level descriptions may land later, but that is explicitly out of scope here.

## Testing

### Unit tests

- `tests/analyzers/java-code.test.ts`, `tests/analyzers/python-code.test.ts`, `tests/analyzers/c-code.test.ts` — feed small source-file fixtures into each analyzer and assert `RawCodeElement[]` matches expected shape (ids, kinds, members, references).
- Edge cases per language:
  - **Java**: inner classes, generics, annotations.
  - **Python**: decorated classes, type-hint-less functions, multiple inheritance.
  - **C**: typedef aliasing, static vs. extern visibility, forward declarations.

### Model-builder tests

`tests/core/model-builder-code.test.ts`:

- Given synthetic `RawStructure`, assert `CodeElement[]` and `CodeRelationship[]` are produced with correct qualified IDs.
- Name resolution cases: same-component, cross-component, external/unresolvable.
- Filter cases: visibility filter, `minElements` threshold, `includePrivate` config.

### Generator tests

`tests/generator/d2/code.test.ts`:

- Snapshot tests per language profile against hand-crafted models.
- Stability test: generating the same model twice yields byte-identical output.
- Scaffold test: scaffold file is created on first run, preserved on second run.
- Profile selection test: mixed-language component picks the expected profile under the documented tiebreak rule.

### Integration tests

`tests/integration/code-level.test.ts`:

- Run the full pipeline on `tests/fixtures/monorepo/` with `levels.code: true`.
- Assert expected `_generated/c4-code.d2` files exist per component and parse as valid D2 (via the `d2` CLI if available on the test host, else string-level checks).

### Quality tests

Under `tests/quality/`:

- Add code-level ground-truth files alongside the existing component-level fixtures.
- Precision/recall against element extraction — did we find the classes that should exist, without false positives?
- Drift test: mutate a class name in the fixture, assert L4 regenerates with the new name and drift is detected in the scaffold if the old name was referenced.

### Benchmarks

- Add `bench/code-extraction.bench.ts` to measure tree-sitter extraction cost vs. the existing scan cost on the monorepo fixture.
- Baseline target: enabling L4 adds no more than **2×** the scan time measured with L4 off.

## Output File Layout

```
docs/architecture/
├── c1-context.d2
├── _generated/c1-context.d2
├── c2-container.d2
├── _generated/c2-container.d2
└── containers/
    └── {containerId}/
        ├── c3-component.d2
        ├── _generated/c3-component.d2
        └── components/
            └── {componentId}/
                ├── c4-code.d2                  # new; scaffold, user-editable
                └── _generated/c4-code.d2       # new; regenerated each run
```

## Non-Goals and Future Work

Explicitly deferred:

- **Call-graph extraction.** A behavioral view may land as a separate `levels.code.callGraph: true` option in a follow-up PR.
- **LLM description enrichment.** Can be added as a parallel pass to the existing `llm-model-builder.ts` without schema changes (descriptions are optional fields).
- **TypeScript / other languages.** Pattern is established; any new language implements a `code.ts` + queries file + profile.
- **Per-component config overrides.** Global flags suffice for v1.
