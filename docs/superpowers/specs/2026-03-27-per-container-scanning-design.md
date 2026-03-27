# Per-Container Scanning & Caching

## Problem

Today, diagram-docs computes a single checksum across all discovered applications. Changing one file in one container invalidates the entire cache, triggering LLM calls for every container — even those that haven't changed. This wastes time and tokens in monorepos.

Additionally, there is no distinction between deployable containers and shared libraries. Libraries appear as containers in the C2 diagram, which is incorrect per the C4 model.

## Goals

1. **Per-container scan results and checksums** — only re-scan and re-model changed containers.
2. **No LLM call for unchanged containers** — cached per-container model fragments are reused.
3. **Root = container execution** — running `diagram-docs` at the repo root behaves the same as running it within a container directory (scoped to that container).
4. **Cascading config** — optional `diagram-docs.yaml` in container directories overrides the root config.
5. **Library vs. container classification** — build file inference + config override distinguishes deployable containers from shared libraries.

## Design

### Discovery & Classification

Discovery runs as today — `discoverApplications()` finds all build files. A new classification step determines the project type:

**Build file inference (default):**

| Language   | Library signal                                                                       | Container signal                     |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| Java       | `pom.xml` with `<packaging>jar</packaging>` + no main class                          | WAR packaging, Spring Boot plugin    |
| Python     | No entrypoint (`__main__.py`, `app.py`, CLI scripts in `setup.cfg`/`pyproject.toml`) | Has entrypoint                       |
| C          | `CMakeLists.txt` producing `STATIC_LIBRARY` or `SHARED_LIBRARY`                      | `add_executable`                     |
| TypeScript | `package.json` without `bin`/`main`/server scripts                                   | Has `bin`, `main`, or server scripts |

**Config override takes precedence:** `type: library` or `type: container` in local `diagram-docs.yaml` or root overrides.

The return type changes from `DiscoveredApp[]` to `DiscoveredProject[]` with a `type: "container" | "library"` field.

### Per-Container File Structure

Each container and library gets its own `.diagram-docs/` directory. The root also has one for inventory and synthesis state.

```
# Root level
.diagram-docs/
  manifest.yaml           # Inventory of all projects, synthesis state
diagram-docs.yaml          # Root config

# Per container
services/api-gateway/
  .diagram-docs/
    scan.json
    model.yaml
    checksum
  diagram-docs.yaml        # Optional, overrides root

services/user-service/
  .diagram-docs/
    scan.json
    model.yaml
    checksum

libs/mathlib/
  .diagram-docs/
    scan.json
    checksum               # No model.yaml — libraries skip LLM
```

**Root manifest (`manifest.yaml`):**

```yaml
version: 2
projects:
  api-gateway:
    type: container
    path: services/api-gateway
    language: typescript
  user-service:
    type: container
    path: services/user-service
    language: java
  mathlib:
    type: library
    path: libs/mathlib
    language: c
synthesis:
  timestamp: "2026-03-27T..."
```

**Running from root:** discovers all projects, iterates their `.diagram-docs/` directories for cache checks, assembles combined model, runs synthesis, generates all diagrams.

**Running from container:** finds local `.diagram-docs/`, does cache check, produces scan + model for just that container. No synthesis pass.

### Caching

Each project's checksum is computed from its own source files + its resolved config fingerprint. No cross-container invalidation is needed — each container's scan output is fully determined by its own source files (the tool tracks module-level imports, not method-level API signatures).

**Cache decision per project:**

1. Compute checksum from the project's source files + resolved config fingerprint.
2. Compare against `.diagram-docs/checksum` in the project's directory.
3. Match: load cached `scan.json` (and `model.yaml` for containers). Skip analyzer + LLM.
4. Mismatch: re-scan, write `scan.json` + `checksum`. For containers, re-run LLM, write `model.yaml`.

### Cascading Config

Config resolution walks up the directory tree, merging closest-parent-wins (like `.eslintrc`).

**Resolution order (highest priority first):**

1. Local `diagram-docs.yaml` (in the container/library dir)
2. Root `diagram-docs.yaml` (nearest ancestor `diagram-docs.yaml` above the container dir)
3. Built-in defaults

**Root detection:** When running from a container dir, the tool walks up the directory tree looking for `diagram-docs.yaml` files. The first one found above the current project directory is treated as the root config. This is bounded by the filesystem root or a `.git` directory (whichever comes first) to avoid walking indefinitely.

**Merge semantics:**

- **Scalars:** local wins (e.g., `abstraction.granularity: "overview"` overrides root's `"balanced"`)
- **Arrays:** local replaces (e.g., local `scan.exclude` replaces root's, not appends)
- **Objects:** deep merge (e.g., `levels.component: false` locally, inherits `levels.context: true` from root)

**Breaking change:** Current behavior appends `scan.exclude` to analyzer defaults. New behavior replaces the parent's array. Users who relied on appending must repeat parent entries in their local config.

**Container-level config options:**

- `type` — `library` or `container` (classification override)
- `levels` — turn off component diagram for a specific container
- `abstraction` — different granularity per container
- `scan.exclude` / `scan.include` — container-specific filtering

**Root-only config options:**

- `system` (name, description)
- `externalSystems`
- `output.dir`
- `llm`
- `submodules`

### Pipeline

```
discover + classify
    |
    +-- for each project (parallel where possible):
    |     |
    |     +-- compute per-project checksum
    |     +-- if unchanged: load cached scan.json (+ model.yaml for containers)
    |     +-- if changed: run analyzer -> write scan.json + checksum
    |     |     +-- if container: run LLM -> write model.yaml
    |     |     +-- if library: done (no LLM)
    |     +-- resolve config (cascading)
    |
    +-- merge per-container model.yaml fragments
    +-- inject cross-app relationships (deterministic, from scan data)
    +-- run synthesis (always, if any container was stale)
    +-- write combined architecture-model.yaml
    +-- generate diagrams (only regenerate stale containers' C3s)
```

**Module changes:**

- **`checksum.ts`** — new `computeContainerChecksum(projectDir, config)` that hashes a single project's files.
- **`scan.ts`** — `runScan()` becomes per-project. New `runScanAll()` orchestrates from root, calling `runScan()` per project with cache check.
- **`parallel-model-builder.ts`** — receives pre-split per-container scan results. Skips LLM for cached containers, only dispatches calls for stale ones.
- **`generate.ts`** — `resolveModel()` assembles from per-container fragments instead of one combined cache check. C3 generation skips unchanged containers.

**CLI behavior:**

- `diagram-docs scan` from root: scans all, outputs combined result to stdout (backwards compatible output format).
- `diagram-docs scan` from container: scans just that container, outputs its scan result.

### Library Handling in Diagrams

Libraries are modeled as **external systems** with a `library` tag. This avoids duplication when multiple containers consume the same library and keeps the model clean.

- **C1 Context:** Libraries don't appear (internal to the system).
- **C2 Container:** Libraries appear as external systems with distinct visual style (dashed border or different shape in D2).
- **C3 Component:** A container's component diagram shows its library dependency as an external system reference.

Libraries get no C3 diagram and no LLM call.

### Testing Strategy

**Coverage areas:**

- **Classification logic** — build file inference for each language. Config override precedence.
- **Per-container checksum** — changing one container's files doesn't affect another's. Config fingerprint included.
- **Cascading config** — scalar override, array replace, object deep merge. Directory tree resolution.
- **Cache hit/miss per container** — unchanged skips scan + LLM. Changed re-runs. Mixed scenario dispatches LLM only for stale containers.
- **Library handling** — scanned but no LLM, no C3, appears as external system.
- **Root vs. container execution** — same scan output from root or from within.
- **Existing quality/drift/token tests** — must still pass against new structure.

**Fixture updates:**

- Monorepo fixture (`tests/fixtures/monorepo/`) already has `libs/mathlib` and services. Add a local `diagram-docs.yaml` in one container to test cascading config.
- Update quality ground truth to reflect library classification (mathlib as external system, not container).
