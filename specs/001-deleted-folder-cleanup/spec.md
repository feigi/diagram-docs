# Feature Specification: Deleted Folder Cleanup

**Feature Branch**: `001-deleted-folder-cleanup`
**Created**: 2026-04-14
**Status**: Draft
**Input**: User description: "When a folder was deleted since the last scan, diagram-docs should clean up the architecture and should not recreate the folder for config and docs"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Deleted Container Removed from Diagrams (Priority: P1)

A developer removes a service or application directory from the codebase. When they re-run `diagram-docs generate`, the deleted service no longer appears in any architecture diagram and its documentation directory is not recreated.

**Why this priority**: Core failure mode — if diagram-docs recreates scaffold and generated files for deleted services, the architecture docs become inaccurate and misleading.

**Independent Test**: Create a project with two containers A and B, generate docs, delete B's source folder, re-run generate, verify B is absent from all outputs and `containers/B/` is gone.

**Acceptance Scenarios**:

1. **Given** a project with containers A and B that has been scanned and had docs generated, **When** container B's source folder is deleted and `diagram-docs generate` is re-run, **Then** container B no longer appears in any generated D2 diagram.
2. **Given** container B's source folder was deleted and generate re-run, **When** the developer inspects the docs output directory, **Then** `containers/B/` scaffold directory does not exist (or is removed if it previously existed).
3. **Given** container B's source folder was deleted, **When** `diagram-docs generate` runs, **Then** no `_generated/` or scaffold files are written for container B.

---

### User Story 2 - Architecture Model Stays in Sync with Disk (Priority: P2)

After deleting a source folder, the architecture model (`architecture-model.yaml`) no longer contains the stale container — the model accurately reflects the current codebase rather than a cached stale state.

**Why this priority**: The architecture model is the authoritative source for diagram generation. Stale entries cause the problem to recur on every run until manually corrected.

**Independent Test**: Run generate after a deletion and verify the architecture model no longer contains the deleted container's entry.

**Acceptance Scenarios**:

1. **Given** an architecture model that includes container B, **When** container B's source folder is deleted and `diagram-docs generate` is run, **Then** the model is rebuilt without container B's entry.
2. **Given** no other containers changed, **When** a deletion is detected, **Then** generate does not use the cached model but rebuilds from the fresh scan, and logs which container was removed.
3. **Given** a manually authored container with no `path` field in the model, **When** source folders change, **Then** the manually authored container is preserved in the rebuilt model.

---

### User Story 3 - Stale Generated Files Removed (Priority: P3)

When a container is removed from the codebase, any previously generated files under `_generated/` for that container are cleaned up, leaving no orphaned artifacts in the docs directory.

**Why this priority**: Orphaned generated files are less visible than stale scaffold files (they live in `_generated/`), but still create confusion and stale diffs.

**Independent Test**: After deletion and re-generation, verify no files remain under `docs/architecture/containers/<deleted-id>/_generated/`.

**Acceptance Scenarios**:

1. **Given** a previously generated `_generated/c3-component.d2` for container B, **When** container B's source folder is deleted and `diagram-docs generate` is re-run, **Then** the `_generated/` directory for container B is removed.
2. **Given** container B's scaffold directory had no user customizations, **When** generate is re-run after deletion, **Then** the entire `containers/B/` directory is removed and a removal message is logged to stderr.
3. **Given** container B's scaffold file has user-added content below `# Add your customizations below this line`, **When** generate is re-run after deletion, **Then** the directory is preserved and a warning is emitted to stderr.

---

### Edge Cases

- What if the container model entry has no `path` field (manually authored)? No-op — only containers with a `path` that resolves to a missing folder are cleaned up.
- What if only submodules within a container folder are deleted, but the container folder itself still exists? The container remains; detection only applies to the container's root `path`.
- Submodule mode: docs live inside the app folder and are naturally deleted with it. No additional cleanup needed.
- What if `containers/` directory doesn't exist? Cleanup exits silently — nothing to clean.
- What if the scaffold file is absent but `_generated/` exists? Remove `_generated/` and the parent dir if empty.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST detect when a container in the existing architecture model has a `path` that is no longer present among currently discovered applications.
- **FR-002**: When deleted containers are detected, the system MUST rebuild the architecture model from the current scan rather than reuse the cached model.
- **FR-003**: The system MUST log a message to stderr naming the deleted containers when a deletion is detected.
- **FR-004**: The generate phase MUST NOT create or recreate `_generated/` files or scaffold dirs for containers absent from the current model.
- **FR-005**: The generate phase MUST remove any previously generated `_generated/` directory for containers absent from the current model.
- **FR-006**: The generate phase MUST remove the scaffold directory for an absent container if its scaffold file contains no user customizations.
- **FR-007**: If the scaffold file contains user customizations, the system MUST warn the user rather than silently delete the directory.
- **FR-008**: Containers with no `path` field (manually authored) MUST never be removed by the cleanup process.

### Key Entities

- **Container**: A deployable unit in the architecture model, optionally linked to a `path` on disk (e.g. `services/payment`).
- **Scaffold Directory**: `<output.dir>/containers/<id>/` — contains user-facing D2 files, created once, never overwritten.
- **Generated Files**: Files under `_generated/` subdirectories — overwritten on every generate run, never user-edited.
- **Architecture Model**: `architecture-model.yaml` — the source of truth for diagram generation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After deleting a source folder and re-running generate, zero references to the deleted container appear in any generated D2 file.
- **SC-002**: After deleting a source folder and re-running generate, no scaffold directory exists for the deleted container under `docs/architecture/containers/`.
- **SC-003**: After deleting a source folder and re-running generate, the architecture model contains no entry for the deleted container.
- **SC-004**: Manually authored containers (those without a `path` field) are never removed by the cleanup process.
- **SC-005**: The full generate pipeline completes without error after a folder deletion.

## Assumptions

- A container is considered "deleted" when its `path` is no longer found among the applications discovered on the current run.
- Containers without a `path` field are manually authored and are never candidates for automatic removal.
- The scaffold file marker `# Add your customizations below this line` reliably identifies user-added content.
- Submodule mode docs live inside application folders and are naturally removed when the app folder is deleted — no additional cleanup needed.
- A single-run absence is sufficient to trigger cleanup; the current scan result is authoritative.
