# Implementation Plan: Deleted Folder Cleanup

**Branch**: `001-deleted-folder-cleanup` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/001-deleted-folder-cleanup/spec.md`

## Summary

When a source code folder is deleted from the codebase, `diagram-docs generate` currently reuses the stale `architecture-model.yaml` (which still contains the deleted container) and re-creates scaffold and generated files for it. The fix has two parts: (1) detect deleted containers before reusing the cached model and force a rebuild, and (2) clean up orphaned scaffold and `_generated/` directories after the fresh model is resolved.

## Technical Context

**Language/Version**: TypeScript / Node 22 (ES2022 target, `"module": "Node16"`)  
**Primary Dependencies**: `commander`, `yaml`, `zod`, `glob`, `vitest`  
**Storage**: File system — `architecture-model.yaml`, `_generated/`, `containers/<id>/`  
**Testing**: vitest (unit + integration), `npm test`  
**Target Platform**: Node.js CLI (cross-platform)  
**Project Type**: CLI tool  
**Performance Goals**: Negligible — `readdir` + string comparisons on small directory trees  
**Constraints**: Must not delete user-customised scaffold files  
**Scale/Scope**: Per-repository, typically < 50 containers

## Constitution Check

The constitution file is a blank template with no filled-in principles. No gates apply.

## Project Structure

### Documentation (this feature)

```text
specs/001-deleted-folder-cleanup/
├── plan.md              ← this file
├── research.md          ← Phase 0: decisions and rationale
├── data-model.md        ← Phase 1: entities, state transitions, affected files
├── contracts/
│   └── generate-command.md   ← Phase 1: CLI behavioural contract
└── tasks.md             ← Phase 2 output (speckit.tasks — not yet created)
```

### Source Code (repository root)

```text
src/
├── cli/commands/
│   └── generate.ts          ← MODIFY: deletion detection + cleanup call
└── generator/d2/
    ├── cleanup.ts            ← NEW: removeStaleContainerDirs()
    ├── scaffold.ts           ← unchanged
    └── submodule-scaffold.ts ← unchanged

tests/
├── generator/
│   └── cleanup.test.ts       ← NEW: unit tests for cleanup logic
└── cli/
    └── generate-deletion.test.ts  ← NEW: integration tests
```

**Structure Decision**: Single-project CLI tool. New logic is confined to one new file (`cleanup.ts`) and one targeted modification to `generate.ts`.

## Implementation Approach

### Change 1 — Deletion detection in `resolveModel` (`generate.ts`)

**Where**: `resolveModel` function, just before the `(all containers cached)` early-return.

**What**: Load the existing model, extract container paths that are set, diff against `discovered` app IDs. If any are missing from discovered → skip early-return, rebuild model. Log the deleted paths.

```typescript
// Before the existing early-return:
if (staleContainers.length === 0 && fs.existsSync(autoModelPath)) {
  const existingModel = loadModel(autoModelPath);
  const discoveredIds = new Set(containers.map((c) => slugify(c.path)));
  const deleted = existingModel.containers.filter(
    (c) => c.path != null && !discoveredIds.has(slugify(c.path)),
  );
  if (deleted.length === 0) {
    console.error(`Using model: ... (all containers cached)`);
    return existingModel;
  }
  console.error(
    `${deleted.length} container(s) removed since last scan: ${deleted.map((c) => c.path).join(", ")}`,
  );
  // fall through to rebuild
}
```

### Change 2 — New `src/generator/d2/cleanup.ts`

**Exports**: `removeStaleContainerDirs(outputDir, model)`

**Logic**:

1. Resolve `containersDir = path.join(outputDir, "containers")`; return early if absent.
2. Read all subdirectory names from `containersDir`.
3. Build `activeIds = new Set(model.containers.map(c => c.id))`.
4. For each orphaned dir (not in `activeIds`):
   - Remove `<dir>/_generated/` recursively — always safe.
   - Check `<dir>/c3-component.d2` for user customizations via marker heuristic.
   - Unmodified → remove scaffold file, remove `<dir>` if empty, log removal.
   - Modified → emit warning, leave dir intact.

**Customization detection** (marker = `"# Add your customizations below this line"`):

```typescript
function isUserModified(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  const idx = content.indexOf(MARKER);
  if (idx === -1) return true; // structure changed
  return content.slice(idx + MARKER.length).trim().length > 0;
}
```

### Change 3 — Wire cleanup into `generate.ts`

After `resolveModel` returns, before generating new content:

```typescript
const model = await resolveModel(...);
removeStaleContainerDirs(outputDir, model);
// existing generation continues unchanged
```

## Complexity Tracking

No constitution violations. No new abstractions beyond the existing patterns in `drift.ts` and `scaffold.ts`.
