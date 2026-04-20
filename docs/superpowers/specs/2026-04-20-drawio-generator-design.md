# Drawio generator with regen-preserving merge

**Status:** design approved, not yet implemented
**Branch:** `feature/drawio-generator` (off `main`)
**Date:** 2026-04-20

## Motivation

Today the tool emits D2 source, which the D2 binary renders to SVG/PNG. Users
cannot meaningfully edit generated diagrams to match an intended look — the D2
file is overwritten each run, and any hand-tweaked SVG is thrown away on the
next regeneration.

Drawio (`.drawio` XML, the native mxGraph format) is:

- editable in `drawio.com`, the desktop app, and VS Code
- renderable natively by Confluence's drawio macro
- a stable, text-diffable XML format with stable cell ids

This proposal adds a drawio generator as a first-class output and makes it the
default. D2 is retained as opt-in. The tool's job is diagram _generation_ only;
publishing to Confluence or any other destination is explicitly out of scope.

## Goals

- Generate `.drawio` files for C4 levels 1–4 from `ArchitectureModel`.
- On regeneration, **preserve user edits to geometry and style** (node
  position, size, colour, shape) while keeping the graph structure (nodes,
  edges, labels) in sync with the code.
- Keep output deterministic and diff-friendly: stable cell ordering, pinned
  layout seed, byte-identical output when model and user edits are unchanged.
- Retain D2 as an opt-in alternative output so existing consumers are not
  broken.

## Non-goals (v1)

- Headless `.drawio → svg/png` rendering. The tool writes XML only; users
  open it in drawio to view. (Drawio-desktop CLI integration can land later.)
- Any Confluence / publishing integration. Drawio was chosen because
  Confluence _can_ render it natively, not because the tool will push.
- A styles overlay file equivalent to `styles.d2`. Styles are applied per-cell
  on creation; subsequent user edits override per the merge policy.
- Bi-directional or pull-back sync with any external system.
- A GUI-level undo / history model for regenerations beyond what git provides.

## User-facing behaviour

### Config

Extend `src/config/schema.ts`:

```ts
output: z.object({
  // existing keys...
  generators: z.array(z.enum(["d2", "drawio"])).default(["drawio"]),
  format: z.enum(["svg", "png"]).default("svg"), // unchanged; applies to D2 path only in v1
  // ...
});
```

- Default: `generators: ["drawio"]`.
- To keep existing D2-only behaviour: `generators: ["d2"]`.
- Both: `generators: ["d2", "drawio"]`. Both generators run; no interaction
  between their output files.

### File layout

Single drawio file per diagram. No `_generated/` split — drawio has no
`@import` equivalent, so the user-owned file and generator-owned file are the
same file, reconciled via the merge algorithm.

```
docs/architecture/
  c1-context.drawio
  c2-container.drawio
  components/<container>.drawio                                     # L3
  containers/<container>/components/<component>/c4-code.drawio      # L4
```

Paths mirror the existing D2 convention at the same levels. Submodule mode
roots the same tree under each submodule's `docs/architecture/`; the
aggregator-skip convention continues to apply.

### First run and missing files

On a fresh run (or after a user deletes a drawio file), the generator emits a
complete, freshly laid-out diagram. There is no separate scaffold step — the
fresh output _is_ the starting point, and it becomes user-editable immediately.

### Regeneration / merge policy

For each diagram, on every run:

- **Matched cells** (id present in both the existing file and the fresh model):
  preserve `<mxGeometry>` and `<mxCell style>` exactly. Overwrite label
  (`value` attribute) and refresh edge endpoints if they changed.
- **New cells** (model only, no prior match): placed by the layout engine
  using its default seed. No attempt to avoid overlapping user-placed cells.
- **Stale cells** (existing file only, no longer in model): deleted. Edges
  that touch a deleted vertex — or whose own id no longer corresponds to a
  model edge — are also deleted.
- **User freehand cells** (in file, unmanaged, no model match): preserved
  verbatim. Managed cells are tagged with a `data-ddocs-managed="1"` entry in
  their style string so the merge can distinguish them from user-added art.

Corrupt / unparseable XML aborts the merge with an error and leaves the file
untouched. The user resolves the corruption by hand.

## Architecture

### Module layout

```
src/generator/drawio/
  index.ts            # entry: generateDrawioDocs(model, config, outputDir)
  writer.ts           # mxGraph XML builder (mxCell, mxGeometry, mxEdge)
  merge.ts            # parse existing .drawio, id-match, preserve geometry+style
  layout.ts           # layout algorithms (hierarchical / tree / organic / circle)
  styles.ts           # default mxCell styles per C4 kind
  context.ts          # L1 emitter
  container.ts        # L2 emitter
  component.ts        # L3 emitter
  code.ts             # L4 emitter
  stability.ts        # deterministic cell ordering
  drift.ts            # stale-reference detection (drawio variant)
  cleanup.ts          # orphan .drawio cleanup
```

Mirrors `src/generator/d2/`. `ArchitectureModel` is shared unchanged; both
generators consume it without format-specific coupling.

### Dispatcher

`src/cli/commands/generate.ts` iterates `config.output.generators` and invokes
each registered generator. Adding drawio does not change the D2 code path. The
two generators produce files at non-overlapping paths (`*.d2` vs `*.drawio`)
and can coexist.

### New dependencies

- `fast-xml-parser` — round-trip XML parsing for the merge step. Small, no
  transitive deps.
- Layout library: prefer `@maxgraph/core` (modern mxGraph fork) for node
  placement. If its headless (no-DOM) mode proves fragile, fall back to
  `elkjs` (already headless-safe; used by the D2 path). Choose during
  implementation.

### mxGraph emission

Drawio file structure (simplified):

```xml
<mxfile>
  <diagram name="L2 - containers">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="auth-service" parent="1" vertex="1" value="Auth Service"
                style="rounded=1;...;data-ddocs-managed=1">
          <mxGeometry x="100" y="80" width="160" height="60"/>
        </mxCell>
        <mxCell id="auth-service->user-db-uses" parent="1" edge="1"
                source="auth-service" target="user-db" value="uses"
                style="...;data-ddocs-managed=1"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

Mapping rules:

- Container, component, code element → `<mxCell vertex="1">`.
  `id` = model's existing kebab-case id (from `slugify()`).
- Relationship → `<mxCell edge="1">` with
  `id = <source>-><target>-<relationship-slug>`.
- Nested containers (L3 components inside an L2 container, L4 elements inside
  an L3 component) → `parent` attribute points to the outer cell id; drawio
  groups natively.
- External systems / people → vertex with a distinct style key (dashed,
  muted).
- One `<diagram>` per file. L1 / L2 / L3 each own a single file; L4 is one
  file per component.

### Styles

Defined in `styles.ts` as mxStyle strings, keyed by C4 kind:
`system`, `container`, `component`, `external-system`, `person`, `code-class`,
`code-fn`, `relationship`. Example:

```
rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;data-ddocs-managed=1
```

Applied on creation. User edits to the `style` attribute of a managed cell are
preserved verbatim — the merge never touches style on a matched cell.

### Merge algorithm

Implemented in `merge.ts`. Runs per-diagram.

1. **Parse existing file.** If missing, treat as empty; emit fresh diagram
   with full layout.
2. **Build maps:**
   - `existingCells: Map<id, {geometry, style, parent, value, managed}>`
   - `modelNodes: Map<id, ModelNode>`
   - `modelEdges: Map<edgeId, ModelEdge>`
3. **Classify per id:**
   - Matched (id in both) — reuse geometry, style, parent. Overwrite `value`
     and edge endpoints.
   - New (model only) — stage for layout.
   - Stale managed (existing only, vertex, managed) — delete.
   - Stale edges — delete if endpoint is gone or edge id no longer in model.
   - User freehand (existing only, unmanaged) — preserve verbatim.
4. **Nested parent integrity.** If a matched cell's `parent` refers to a
   now-stale id, reparent to layer `1` and re-layout as if new. Log a warning.
5. **Emit preserved cells** with saved geometry/style but refreshed labels and
   endpoints.
6. **Layout new cells.** Run the full-graph layout, then **snap matched cells
   back** to their saved `(x, y, width, height)`. Only new cells keep the
   layout's coords. Overlaps between new and saved cells are accepted; the
   user resolves visually.
7. **Edge routing.** Preserve waypoints for edges whose endpoints are both
   preserved. Drop waypoints for edges that touch a moved / new vertex so
   drawio auto-routes on open.
8. **Serialise + write.** Cells emitted in `stability.ts` order (sorted by id)
   for diff stability.

Idempotence: running the generator twice on unchanged code and an untouched
drawio file produces byte-identical output.

Edge cases (explicit):

- **User renames a managed cell id by hand:** treated as unmanaged
  freehand (no match) while the original id is treated as stale and
  deleted. Warn in the log: "unmatched managed cell `foo-bar` removed; user
  may have renamed". The user can restore geometry manually.
- **Corrupt / unparseable XML:** abort, do not overwrite, surface the error.

### Layout strategy

Per C4 level:

- **L1 context:** circular or force layout (few nodes).
- **L2 container:** hierarchical top-to-bottom; containers grouped under the
  system boundary cell.
- **L3 component:** hierarchical inside the container boundary cell (uses
  drawio native grouping).
- **L4 code:** tree layout rooted at the component; code elements cluster by
  kind.

Spacing constants (`NODE_SPACING_X = 200`, `NODE_SPACING_Y = 120`) are shared
across levels so snap-back math is consistent.

Layout seed pinned (`layout.randomSeed = 0x1337`) so repeated runs produce
identical coords for identical inputs.

### File cleanup and drift

- `cleanup.ts` drawio variant removes `.drawio` files for containers /
  components no longer in the model. Same shape as the D2 cleanup.
- `drift.ts` drawio variant parses existing `.drawio` files, extracts managed
  cell ids, and reports stale references (e.g. a user-authored edge that
  points at an id no longer in the model). Used in CI.

### Submodule mode

Unchanged in shape. Each submodule's `docs/architecture/` gets its own drawio
file tree. The aggregator-skip convention (documented in the 2026-04-20
submodule plan) applies identically — aggregators are skipped before any
generator runs.

## Testing

### Unit tests (`tests/generator/drawio/`)

- `writer.test.ts` — mxCell emission per C4 kind, edge construction, nested
  parent mapping.
- `merge.test.ts` — geometry + style preservation across label / edge
  changes; new-cell insertion; stale-cell deletion; corrupt-XML abort;
  user-added freehand cell preserved; id-collision warning on rename.
- `layout.test.ts` — determinism (pinned seed → identical coords), correct
  algorithm selection per level.
- `stability.test.ts` — byte-identical output across runs with unchanged
  inputs.

### Integration tests (`tests/generator/drawio/integration/`)

- Fixture monorepo → generate → parse output → assert cell counts and ids.
- Regenerate twice → byte-identical output.
- Hand-edit geometry in a fixture `.drawio` → regenerate → assert saved
  geometry preserved.
- Add a fake node in the model → regenerate → assert new cell exists with
  layout-assigned coords; saved cells unchanged.
- Remove a model node → regenerate → assert the managed cell and all orphan
  edges are deleted.

### Quality suites

- Drift and token suites extended where applicable.
- Correctness suite unaffected — it operates on the model, before rendering.

### Fixtures

Minimal hand-crafted `.drawio` files in `tests/fixtures/drawio/` covering:
empty, populated, user-extended, corrupted.

## Rollout

This is a **breaking change** for existing projects: the default output
switches from D2 to drawio. An existing `diagram-docs.yaml` with no
`generators` key will start producing `.drawio` files instead of `.d2` files
after upgrading.

1. Ship drawio generator with `output.generators: ["drawio"]` default.
2. `init` command scaffolds new projects with `generators: ["drawio"]`
   explicitly written, so fresh configs are self-documenting.
3. Upgrade path for existing users who want to stay on D2: add
   `output.generators: ["d2"]` to `diagram-docs.yaml`. Document this in a
   release note.
4. Users wanting both during migration: `output.generators: ["d2", "drawio"]`.
5. Document the merge guarantees and edge cases in `README.md`.

## Open questions

- **Managed-tag durability across drawio round-trip.** The plan tags managed
  cells by embedding `data-ddocs-managed=1` in the mxStyle string. Drawio is
  expected to preserve unknown style keys on save, but this must be verified
  against the current desktop / web builds before committing to this
  approach. Fallback: store the managed id set in a side-car `.drawio-meta`
  JSON file keyed by diagram path, parsed alongside the XML.
- **Layout library choice.** `@maxgraph/core` vs `elkjs` decided during
  implementation based on headless-mode reliability.
