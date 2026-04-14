# Per-Submodule `diagram-docs.yaml` Stub

**Date:** 2026-04-14
**Status:** Design approved, ready for implementation planning

## Problem

Today, `diagram-docs.yaml` is written only at the repo root (via `init`, or implicitly by `loadConfig` when nothing is found). The cascading-config system (`src/core/cascading-config.ts`) already resolves nested `diagram-docs.yaml` files closest-parent-wins, and the existing monorepo fixture has a hand-placed override at `services/api-gateway/diagram-docs.yaml`. But there is no mechanism that surfaces this capability to users: they have to know the cascading system exists, find the right location, and write a YAML file from scratch.

We want per-application overrides to be discoverable and one step away from use. When `generate` runs, it should scaffold a stub `diagram-docs.yaml` at each submodule root that receives generated diagrams. The stub is fully commented out, so it has no effect on config resolution until the user edits it.

## Goal

For every submodule that is currently receiving generated diagrams, scaffold a `diagram-docs.yaml` stub at `{repoRoot}/{appPath}/diagram-docs.yaml`. The stub contains a header explaining its role plus the full default config entirely commented out, so users can uncomment the lines they want to override.

Users may opt not to commit these files — they are inert by default.

## Non-Goals

- Not writing stubs at the root `output.dir`, `containers/{id}/`, or inside the architecture subfolder.
- Not touching `init`, `loadConfig`, the cascading resolver, or the config schema.
- Not changing the root `diagram-docs.yaml` behavior.

## Placement

The stub lives at `{repoRoot}/{appPath}/diagram-docs.yaml` — the submodule's code root. This matches the existing cascading-config boundary: `resolveConfig` walks up from any directory inside the app and picks the stub up naturally. It also matches the shape of the existing fixture at `tests/fixtures/monorepo/services/api-gateway/diagram-docs.yaml`.

## When the Stub is Written

The stub is written inside the existing per-container loop in `generateSubmoduleDocs` (`src/generator/d2/submodule-scaffold.ts`), using the same gating already present there, plus a create-once guard:

1. Skip if `override?.exclude` is set for the container (existing skip).
2. Skip if `config.levels.component === false` (the submodule currently produces no diagrams, so no stub is warranted either).
3. Skip if a file already exists at the target path (create-once semantics — users may have populated it).
4. Otherwise, write the stub.

Newly created stubs participate in the existing `changedCount` tracking so the `"Generated: <path>/"` log line naturally covers them.

## Stub Contents

Header comment + the full default config, entirely commented out. The header tells the user what the file is and how to use it. The humanized submodule name is interpolated into the header.

Example (for a submodule at `services/api-gateway`):

```yaml
# diagram-docs.yaml for Api Gateway
#
# Per-application config. Values here override the repo-root config
# (cascading, closest parent wins). Uncomment any line below to override
# the inherited default.

# system:
#   name: Api Gateway
#   description: ""
#
# scan:
#   include:
#     - "**"
#
# levels:
#   context: true
#   container: true
#   component: true
#
# abstraction:
#   granularity: balanced
#   excludePatterns:
#     - logging
#     - metrics
#     - middleware
#     - config
#     - utils
#
# output:
#   dir: docs/architecture
#   theme: 0
#   layout: elk
#
# llm:
#   concurrency: 10
```

### How the Body is Generated

The body is not a static template. It is built by calling the existing `buildDefaultConfig(path.join(repoRoot, appPath))` from `src/config/loader.ts`, which:

- Produces the same default-config dict that `init` would write.
- Derives `system.name` from the directory basename via `humanizeName()` — so each submodule gets its own name for free.

The returned `defaults` dict is then serialized with `yaml.stringify(..., { lineWidth: 120 })` and each line is prefixed with `# ` before being wrapped in the header block. This keeps the key set in lockstep with `init`: any default added to `buildDefaultConfig` in the future flows into new submodule stubs automatically.

## Code Changes

All changes are confined to `src/generator/d2/submodule-scaffold.ts`:

1. Add a new helper, e.g. `buildSubmoduleConfigStub(repoRoot: string, appPath: string): string`, that:
   - Calls `buildDefaultConfig(path.join(repoRoot, appPath))`.
   - Stringifies `defaults` to YAML.
   - Prefixes each line with `# `.
   - Prepends the header block (with the humanized app name).
2. Inside `generateSubmoduleDocs`, after computing `appPath` and checking `override?.exclude`, gate on `config.levels.component`; if true:
   - Compute `stubPath = path.join(repoRoot, appPath, "diagram-docs.yaml")`.
   - If `stubPath` does not exist, write the stub and increment the changed counter.
   - If it exists, leave it untouched.

No new files, no exported API surface beyond what's needed internally.

## Testing

New or extended tests for `generateSubmoduleDocs`:

- **Scaffolds per-submodule stubs.** Given a model with two containers at distinct `appPath`s and `config.levels.component = true`, both `{appPath}/diagram-docs.yaml` files are created with the expected humanized names in their headers.
- **Create-once.** When a stub already exists at `{appPath}/diagram-docs.yaml` with arbitrary user content, running `generateSubmoduleDocs` leaves that file byte-for-byte identical.
- **Respects `override.exclude`.** For a container whose override sets `exclude: true`, no stub is created.
- **Respects `levels.component`.** When `config.levels.component` is `false`, no submodule stubs are created anywhere.
- **Stub parses as empty config.** Parse the generated stub with `yaml.parse` and assert the result is `null` or `{}`, and confirm `configSchema.parse(parsed ?? {})` succeeds and equals the schema-default config — proving the stub is inert by construction.

## Risks and Trade-offs

- **New files appear in users' working trees.** On first `generate` after upgrade, every submodule gets a new untracked `diagram-docs.yaml`. Since the file is inert (fully commented) and users can delete or gitignore, the blast radius is small. The "Generated: ..." log lines make the new files discoverable, not silent.
- **Stub drifts from defaults over time.** The risk is mitigated by generating the body from `buildDefaultConfig` rather than a static template — the stub always reflects current defaults when it is first written. Already-written stubs are never rewritten, which is the correct behavior: the user's edits win.
- **Cascading merge semantics.** Because the stub contains no uncommented keys, `resolveConfig` sees an empty object and merges nothing — the root config is fully preserved. Verified by the "Stub parses as empty config" test.
