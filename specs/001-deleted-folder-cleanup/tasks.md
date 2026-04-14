# Tasks: Deleted Folder Cleanup

**Input**: Design documents from `specs/001-deleted-folder-cleanup/`
**Branch**: `001-deleted-folder-cleanup`
**Tech stack**: TypeScript / Node 22, vitest, ES modules (`.js` imports)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other `[P]` tasks (different files, no shared state)
- **[Story]**: Which user story this task serves (US1, US2, US3)
- Exact file paths are required in every task description

---

## Phase 1: Setup

**Purpose**: Verify baseline before any changes are made.

- [x] T001 Run `npm test` and confirm all existing tests pass; record output as baseline

---

## Phase 2: Foundational — `cleanup.ts` skeleton

**Purpose**: Create the new module with its exported API surface. All user story phases depend on this file existing with the right signature.

**⚠️ CRITICAL**: Complete T002 before starting any user story phase.

- [x] T002 Create `src/generator/d2/cleanup.ts` with: file-level JSDoc, the `CUSTOMIZATION_MARKER` constant (`"# Add your customizations below this line"`), the unexported `isUserModified(filePath: string): boolean` stub (throws `"not implemented"`), and the exported `removeStaleContainerDirs(outputDir: string, model: ArchitectureModel): void` stub (throws `"not implemented"`). Import `fs`, `path`, and `ArchitectureModel` type.

**Checkpoint**: `src/generator/d2/cleanup.ts` compiles cleanly (`npm run typecheck`). User story phases can now begin.

---

## Phase 3: User Story 1 — Deleted Container Not Recreated in Diagrams (Priority: P1) 🎯 MVP

**Goal**: When a container's source folder is deleted, re-running `diagram-docs generate` neither generates new D2 content for it nor leaves a scaffold directory behind (unless the user added customizations).

**Independent Test**: Set up a two-container fixture, run generate, delete one container's source dir from the fixture, run generate again, assert (a) the deleted container is absent from all generated D2 files and (b) `containers/<deleted-id>/` is gone.

### Implementation for User Story 1

- [x] T003 [P] [US1] Write unit tests for `isUserModified` in `tests/generator/cleanup.test.ts`: test cases for (a) file does not exist → false, (b) file with no content after marker → false, (c) file with content after marker → true, (d) file with marker absent → true
- [x] T004 [P] [US1] Write unit tests for `removeStaleContainerDirs` in `tests/generator/cleanup.test.ts`: test cases for (a) `containers/` dir absent → no-op, (b) all containers active → no-op, (c) orphaned dir with unmodified scaffold → dir removed + message logged, (d) orphaned dir with modified scaffold → dir kept + warning logged, (e) orphaned dir with no scaffold file → `_generated/` and parent removed silently
- [x] T005 [US1] Implement `isUserModified` in `src/generator/d2/cleanup.ts`: read file, find `CUSTOMIZATION_MARKER`, return `true` if content after marker (trimmed) is non-empty or marker is absent
- [x] T006 [US1] Implement `removeStaleContainerDirs` in `src/generator/d2/cleanup.ts` — scaffold cleanup portion: (1) resolve `containersDir`, return if absent; (2) build `activeIds` set from `model.containers`; (3) for each orphaned subdir: call `isUserModified` on `c3-component.d2`; if unmodified → remove scaffold file and dir if empty, log `Removed: containers/<id>/`; if modified → `console.error` warning per contract in `contracts/generate-command.md`
- [x] T007 [US1] Add deletion detection to `resolveModel` in `src/cli/commands/generate.ts`: before the `(all containers cached)` early-return block, load the existing model, compute `discoveredIds = new Set(containers.map(c => slugify(c.path)))`, filter model containers where `c.path != null && !discoveredIds.has(slugify(c.path))`, if any found log the removal message and fall through to rebuild (skip the `return existingModel` line)
- [x] T008 [US1] Wire `removeStaleContainerDirs` into `src/cli/commands/generate.ts`: add import at top of file, call `removeStaleContainerDirs(outputDir, model)` immediately after `const model = await resolveModel(...)` and before the `generatedDir` mkdir block
- [x] T009 [US1] Run `npm test` — T003 and T004 test cases must pass; fix any type or logic errors

**Checkpoint**: User Story 1 fully functional — deleting a container folder and re-running generate leaves no trace of the deleted container.

---

## Phase 4: User Story 2 — Architecture Model Stays in Sync (Priority: P2)

**Goal**: The `architecture-model.yaml` on disk reflects only currently existing containers after generate runs.

**Independent Test**: After deletion and generate, parse `architecture-model.yaml` and assert the deleted container ID is absent. Also assert that manually authored containers (no `path`) remain present.

**Note**: The core mechanism (forced model rebuild) was implemented in T007. This phase adds integration-level verification and the edge case for manually authored containers.

### Implementation for User Story 2

- [x] T010 [P] [US2] Write integration test in `tests/cli/generate-deletion.test.ts`: (a) scaffold a minimal two-container fixture on a temp dir, (b) run `runScan` + `buildModel` to produce initial model, (c) delete one container's source dir, (d) call `resolveModel`-equivalent logic, (e) assert rebuilt model does not contain deleted container, (f) assert a manually authored container entry (no `path`) is preserved
- [x] T011 [US2] Verify the `slugify(c.path)` comparison in T007's deletion detection handles edge cases: path with trailing slash, path that is `.`, and a container with `path: undefined` (must not be flagged). Add defensive guard if needed in `src/cli/commands/generate.ts`

**Checkpoint**: Architecture model is provably correct after deletion — verified by integration test.

---

## Phase 5: User Story 3 — Stale Generated Files Removed (Priority: P3)

**Goal**: The `_generated/` subdirectory for a deleted container is removed on the next generate run, leaving no orphaned auto-generated content.

**Independent Test**: After deletion and generate, assert `containers/<deleted-id>/_generated/` does not exist.

### Implementation for User Story 3

- [x] T012 [P] [US3] Add unit test cases to `tests/generator/cleanup.test.ts` for `_generated/` removal: (a) orphaned dir with only `_generated/` content and no scaffold file → `_generated/` removed and parent dir removed; (b) orphaned dir with `_generated/` and unmodified scaffold → both removed; (c) orphaned dir with `_generated/` and modified scaffold → `_generated/` removed but parent dir kept
- [x] T013 [US3] Extend `removeStaleContainerDirs` in `src/generator/d2/cleanup.ts` to always remove `<orphanedDir>/_generated/` recursively before checking the scaffold file. Use `fs.rmSync(generatedDir, { recursive: true, force: true })` to handle absent dirs gracefully.
- [x] T014 [US3] Run `npm test` — T012 test cases must pass; confirm no regressions in T003/T004

**Checkpoint**: No orphaned `_generated/` content remains after a container is deleted.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final quality pass — full test run, edge case hardening, stderr output review.

- [x] T015 [P] Add test case to `tests/generator/cleanup.test.ts` for the case where `containers/` directory does not exist at all → `removeStaleContainerDirs` returns without error
- [x] T016 [P] Add test case to `tests/generator/cleanup.test.ts` for orphaned dir that contains only `_generated/` (no scaffold file) → `_generated/` removed, parent dir removed if now empty
- [x] T017 Review stderr messages emitted by deletion detection (T007) and cleanup (T006/T013) against the contract in `specs/001-deleted-folder-cleanup/contracts/generate-command.md` and align wording if needed in `src/cli/commands/generate.ts` and `src/generator/d2/cleanup.ts`
- [x] T018 Run full test suite `npm test` and fix any regressions; run `npm run typecheck` and `npm run lint` and resolve all errors

---

## Dependencies

```
T001
  └─► T002
        ├─► T003 (parallel with T004)
        ├─► T004 (parallel with T003)
        ├─► T005
        │     └─► T006
        │           └─► T007
        │                 └─► T008
        │                       └─► T009
        │                             ├─► T010 (parallel with T011)
        │                             ├─► T011 (parallel with T010)
        │                             ├─► T012
        │                             │     └─► T013
        │                             │           └─► T014
        │                             └─► T015..T018 (polish, parallel)
```

## Parallel Execution Examples

### After T002 completes, these can run simultaneously

- T003 (unit tests for `isUserModified`)
- T004 (unit tests for `removeStaleContainerDirs`)

### After T009 completes (US1 done), these can run simultaneously

- T010 (integration test for model sync)
- T011 (edge case guard for `slugify` comparison)
- T012 (unit tests for `_generated/` removal)

### After T014 completes (all stories done), these can run simultaneously

- T015, T016, T017 (polish tasks — different files/concerns)

## Implementation Strategy

**MVP = Phase 3 (US1)** — Delivers the most visible fix: deleted containers no longer appear in diagrams or docs. Phases 4 and 5 layer on model correctness and generated-file cleanup.

**Recommended order**: T001 → T002 → T003+T004 (parallel) → T005 → T006 → T007 → T008 → T009 → T010+T011+T012 (parallel) → T013 → T014 → T015+T016+T017 (parallel) → T018
