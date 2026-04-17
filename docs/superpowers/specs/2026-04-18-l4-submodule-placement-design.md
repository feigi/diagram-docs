# L4 Code-Level Diagrams in Submodule Mode

**Date:** 2026-04-18
**Status:** Design approved, ready for implementation planning
**Target branch:** `feature/c4-code-level` (PR #5, open)

## Problem

When `submodules.enabled: true` (the default on `main`), each discovered application gets its own `{appPath}/{docsDir}/architecture/` tree containing a C3 component diagram next to that app's source. The L4 (code-level) generator introduced in PR #5, however, always writes to the root output tree:

```
{outputDir}/containers/<cid>/components/<compId>/c4-code.d2
```

In a submodule repo, this means L4 diagrams live far from the app whose code they describe, defeating the purpose of submodule mode. A second, related gap: `generateSubmoduleDocs` regenerates the per-submodule C3 via `generateComponentDiagram(model, container.id)` with **no** `codeLinks` option — so the per-submodule C3 cannot link to L4 even when L4 exists at root.

## Goal

In submodule mode, L4 diagrams live inside each submodule's `architecture/` tree as a sibling to its C3 diagram. The per-submodule C3 emits drill-down links to L4. Non-submodule mode is unchanged.

## Non-Goals

- No change to non-submodule (root-only) L4 placement.
- No change to the L4 content itself (generator, profiles, scaffold contents).
- No change to `init`, scan, model-builder, cascading-config, or schema.
- No automatic migration for users who ran pre-fix builds at root under submodule mode. Old orphaned `containers/<cid>/components/` dirs at root sit under still-active containers, so `removeStaleContainerDirs` (which only cleans containers absent from the model) will not touch them. Users must delete manually. Documented as a known limitation; affects only unreleased `feature/c4-code-level` builds.
- Not addressing the broader pre-existing gap where a submodule whose source directory is deleted keeps its stale `{appPath}/{docsDir}/architecture/` tree across `generate` runs. That affects C3 too, and belongs in a separate PR. `remove` already handles whole-app deletion.
- No performance benchmark for L4 — placement change has no meaningful perf impact.

## Placement

**Submodule mode, `levels.code: true`:**

```
{repoRoot}/{container.path ?? slash-expanded applicationId}/{override?.docsDir ?? submodules.docsDir}/architecture/
  c3-component.d2                         # existing, now emits L4 drill-down links
  _generated/c3-component.d2
  styles.d2
  architecture-model.yaml                 # fragment, existing
  components/<compId>/
    c4-code.d2                            # scaffolded once, never overwritten
    _generated/c4-code.d2                 # overwritten each run
```

The `containers/<cid>/` prefix is omitted because each submodule is scoped to one container — there is nothing for it to disambiguate. This matches the existing shape of the submodule `c3-component.d2` (also sits directly under `architecture/` without a `containers/` prefix).

**Non-submodule mode:** unchanged. L4 stays at `{outputDir}/containers/<cid>/components/<compId>/c4-code.d2`.

**Double-write avoidance.** When submodules are enabled, the root `containers/<cid>/components/` tree is not created — L4 runs through the submodule path builder only. This keeps root and submodule outputs disjoint and prevents orphaned trees on subsequent runs.

## Routing in `generate`

Inside the main action handler in `src/cli/commands/generate.ts`:

```
if config.levels.code:
  if submodules enabled:
    # handled inside generateSubmoduleDocs — skip root L4 pass
  else:
    generateCodeLevelDiagrams(model, config, outputDir, rawStructure)   # unchanged
```

`generateSubmoduleDocs` receives a new `codeLinks?: Set<string>` arg (computed once by the caller via existing `codeLinkableComponentIds(model, config.code.minElements)`) and, when `config.levels.code` is true, runs an L4 pass per container, alongside its existing C3 pass.

Paths pushed into `d2Files` for `validateD2Files` + SVG rendering reflect the chosen mode — root L4 paths in root mode, submodule L4 paths in submodule mode.

## Modules Changed

### `src/cli/commands/generate.ts`

- Compute `codeLinkableComponentIds` once; pass to both the existing root L3 loop and the new `generateSubmoduleDocs` call.
- Skip the root L4 block when submodules are enabled.
- Aggregate submodule L4 paths into `d2Files` via `SubmoduleOutputInfo.d2Files` (already the conduit; extend its population in `submodule-scaffold.ts`).
- Thread `repoRoot` + `config` into `checkDrift` so it can scan submodule L4 paths.

### `src/generator/d2/submodule-scaffold.ts`

- Extend `generateSubmoduleDocs` signature: add `codeLinks?: Set<string>`, pass through to `generateComponentDiagram`.
- New inline L4 pass per container (guarded by `config.levels.code`):
  - For each component in the container whose code-element count ≥ `config.code.minElements`, write `{outputDir}/components/<compId>/_generated/c4-code.d2` and call `scaffoldCodeFile` for the user-facing `components/<compId>/c4-code.d2`. Reuse `generateCodeDiagram`, `scaffoldCodeFile`, `getProfileForLanguage`, and the existing `dominantLanguageForComponent` helper unchanged.
  - Push both generated and scaffold paths into `d2Files`.
- Extract a small helper `resolveSubmodulePaths(container, config) → { appPath, docsDir, architectureDir }` shared with any other callsite that needs the same trio (drift, stale-cleanup).

### `src/generator/d2/drift.ts`

- After the existing root L4 scan block, if `config.submodules.enabled`, iterate `model.containers` and scan `{appPath}/{docsDir}/architecture/components/*/c4-code.d2` with the same `codeIds` set and `codeOpts`. Reuse the helper above.
- `checkDrift` signature extended to accept `{ repoRoot, config }` (or equivalent) so it can derive submodule paths.

### `src/generator/d2/cleanup.ts`

- New `removeStaleSubmoduleComponentDirs(repoRoot, config, model)`. Per container:
  - Enumerate `{appPath}/{docsDir}/architecture/components/*` entries on disk.
  - For each, if `compId` is not a component of that container in `model`:
    - Remove `_generated/`.
    - If scaffold `c4-code.d2` has no user content below the `# Add your customizations below this line` marker (reuse `isUserModified`), remove it and the now-empty dir.
    - Otherwise, warn: `Warning: <relPath>/c4-code.d2 has user customizations — remove manually if no longer needed.`
- Called from `generate.ts` before L4 writes when `submodules.enabled`.

### No change

- `src/core/remove.ts` — already wipes the entire submodule `architecture/` dir via `discoverSubmoduleDirs`. Inherits L4 cleanup for free.
- `src/generator/d2/component.ts` — link shape `./components/<compId>/c4-code.{ext}` already matches submodule layout.
- `src/generator/d2/code-scaffold.ts` — unchanged; `relStyles` computation still correct because `outputDir` arg still points at `architecture/`.

## Data Flow (one `generate` run, submodule mode on, `levels.code: true`)

1. `resolveModel` → `ArchitectureModel` (with `codeElements` attached via existing `attachCodeModel`).
2. `removeStaleContainerDirs(outputDir, model)` (root, unchanged).
   `removeStaleSubmoduleComponentDirs(repoRoot, config, model)` (new, submodule L4).
3. L1 context → root `_generated/c1-context.d2`.
4. L2 container → root `_generated/c2-container.d2`.
5. Compute `codeLinks = codeLinkableComponentIds(model, config.code.minElements)` once.
6. L3 component loop → root `containers/<cid>/_generated/c3-component.d2` with `codeLinks` as today.
7. L4 loop: skipped (handled in step 9).
8. `scaffoldUserFiles(outputDir, model, config)` (root user files, unchanged).
9. `generateSubmoduleDocs(configDir, outputDir, model, config, { codeLinks })`:
   - Per container: styles, model fragment, `_generated/c3-component.d2` (with `codeLinks` — emits drill-down links), user `c3-component.d2` scaffold.
   - For each qualifying component: `components/<cmp>/_generated/c4-code.d2`, user `components/<cmp>/c4-code.d2` scaffold.
10. `checkDrift(outputDir, model, { repoRoot, config })` — scans root files and (when submodules on) submodule L4 files with the same `codeIds` set.
11. `d2Files` aggregated → `validateD2Files` → SVG rendering.

## Invariants

- `codeLinkableComponentIds` is the single source of truth for which components receive both C3 drill-down links and L4 generation.
- In submodule mode, root `containers/<cid>/components/` is never written — no disjoint-mode orphan needs cleanup on mode switch.
- `scaffoldCodeFile`'s `outputDir` points at the `architecture/` dir in both modes so the relative `styles.d2` import is identical.
- Drift scans the same `codeIds` set across both placements — stale-ref semantics identical.

## Error Handling

- **Missing `container.path`.** Fall back to `container.applicationId.replace(/-/g, "/")` — same as existing `generateSubmoduleDocs` and `remove.ts`. Centralized in `resolveSubmodulePaths`.
- **`override.exclude: true` on a container.** Skip entire container in submodule L4 pass (matches C3 behaviour).
- **Per-component L4 failure.** Wrap per-component `{generate + scaffold}` in try/catch — log `Warning: failed to generate L4 for <compId> in <cid>: <msg>`, continue. Matches existing C3 scaffold error handling.
- **User-modified stale L4.** See cleanup spec above — preserved with warning, never removed.
- **Submodule mode flipped off after an L4-in-submodule build.** Orphaned submodule `components/` dirs left behind. Known limitation; `remove` handles it. Documented here rather than auto-cleaned.
- **`validateD2Files` errors.** Surfaced with the correct file path (root or submodule) because the right paths are pushed into `d2Files` per mode.

## Testing

**Unit — `tests/generator/d2/submodule-scaffold.test.ts` (extend or replace):**

- Writes L4 `_generated/c4-code.d2` + user scaffold under `{appPath}/{docsDir}/architecture/components/<compId>/`.
- Respects `code.minElements` — skips components below threshold.
- Respects `override.exclude` — no L4 written for excluded containers.
- Honours `override.docsDir` — L4 lands in overridden dir.
- Uses `container.path` when set; falls back to slash-expanded `applicationId` when unset.
- C3 here emits drill-down links when `codeLinks` is passed.
- Scaffold create-once: re-running preserves user content below the marker.

**Unit — `tests/cli/generate.test.ts` (extend):**

- Submodule mode + `levels.code: true`: root `containers/<cid>/components/` is not created; submodule path is.
- Non-submodule mode: root L4 tree still produced (regression guard).

**Unit — `tests/generator/d2/drift.test.ts` (extend):**

- Stale code-element id in a submodule `components/<compId>/c4-code.d2` produces a drift warning with the correct submodule path.

**Unit — `tests/generator/d2/cleanup.test.ts` (new or extend):**

- `removeStaleSubmoduleComponentDirs`: removed-component dir wiped when scaffold has no user edits.
- User-modified submodule L4 file → warning, dir preserved.
- Active components untouched.

**Integration — `tests/integration/submodule.test.ts` (extend):**

- `generate` on a fixture in submodule mode with L4-qualifying components; assert file tree; re-run and assert idempotence; mutate a user L4 scaffold; re-run and assert user content preserved.

**Fixture.** Confirm at least one app in `tests/fixtures/monorepo` has ≥ `code.minElements` code elements to trigger L4; if not, adjust per-test config.

**Quality gates.** Existing `test:correctness`, `test:drift`, `test:tokens` suites unaffected — L4 content unchanged, only placement.
