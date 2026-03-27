# Gradle Multi-Module Support

## Problem

The Java analyzer treats every `build.gradle` as an independent application. In Gradle multi-module projects this causes three issues:

1. **Duplicate scanning** — Root projects without `src/main/java` fall back to scanning the entire directory tree, picking up files that belong to subprojects. Example: `los-cha` scans 92 modules while `los-cha/app` scans 89 of the same modules.

2. **Flat container layout** — Subprojects appear as siblings of their root in the container diagram instead of being nested or grouped. Shell root projects (just `base` plugin + `subprojects {}`) become empty containers.

3. **Missing cross-project relationships** — Neither `project(':...')` Gradle dependencies nor Maven coordinate references to other scanned apps produce relationships.

## Design

### Type Change

Add an optional `publishedAs` field to `ScannedApplication` in `src/analyzers/types.ts`:

```ts
export interface ScannedApplication {
  // ... existing fields ...
  publishedAs?: string; // "group:artifactName", e.g. "com.bmw.losnext:los-chargingdb-model"
}
```

This enables post-scan cross-app matching without changing the `LanguageAnalyzer` interface. Discovery stays language-agnostic — all Gradle knowledge lives in the Java analyzer.

### New Module: `src/analyzers/java/gradle.ts`

Two parsing functions:

**`parseSettingsGradle(appPath: string)`**

Reads `settings.gradle` or `settings.gradle.kts` and extracts:

- `rootProjectName: string | null` — from `rootProject.name = '...'`
- `subprojects: Array<{ name: string; dir: string }>` — from `include('...')` / `include '...'` lines, with optional `projectDir` overrides (e.g., `project(':los-chargingdb-model').projectDir = file('model')`)

Returns `null` if no settings file exists.

**`parseGradleDependencies(buildFilePath: string)`**

Reads `build.gradle` or `build.gradle.kts` and extracts:

- `group: string | null` — from `group = '...'` or `group '...'`
- `projectDeps: string[]` — from `implementation project(':...')` → the project name
- `mavenDeps: Array<{ group: string; artifact: string; version?: string }>` — from `implementation 'group:artifact:version'` lines in the `dependencies` block

Parsing approach: line-by-line regex. Does not need a full Groovy/Kotlin parser — these patterns are stable Gradle conventions. Handles both single-quote and double-quote strings.

### Java Analyzer Changes (`src/analyzers/java/index.ts`)

In `javaAnalyzer.analyze()`:

1. **Read settings.gradle** — call `parseSettingsGradle(appPath)`
2. **Exclude subproject directories** — if subprojects are found, convert their directories to glob patterns (e.g., `"app/**"`, `"model/**"`) and add them to the exclude list passed to `extractPackages()`. This prevents the root from scanning subproject files.
3. **Parse build.gradle deps** — call `parseGradleDependencies()` to get both project deps and Maven deps.
4. **Populate `externalDependencies`** — from parsed Maven deps (currently only pom.xml is parsed; this adds Gradle support).
5. **Populate `internalImports`** — from `project(':...')` deps, resolving the project name to a relative path using settings.gradle subproject info. Since Gradle project deps are declared at the project level (not module level), use the app's own ID as `sourceModuleId`. The model-builder only uses `targetApplicationId` for container-level relationship creation, so `sourceModuleId` is effectively a placeholder here.
6. **Set `publishedAs`** — computed from `group` (from build.gradle, or inherited from parent) and artifact name (from settings.gradle `rootProject.name` or subproject name).

### Post-Scan Cross-App Matching (`src/cli/commands/scan.ts`)

After all apps are analyzed, before writing the raw structure:

1. Build a lookup map: `publishedAs` string → app ID (for all apps that have `publishedAs` set)
2. For each app, scan its `externalDependencies` for matches against the lookup
3. Matches are removed from `externalDependencies` and added to `internalImports`

This handles cross-repo Maven coordinate references like `los-cha/app` depending on `com.bmw.losnext:los-chargingdb-model` which is published by `los-chargingdb/model`.

### No Model-Builder Changes Needed

The model-builder already:

- Creates containers 1:1 from apps (root shells with 0 modules become empty containers — acceptable, users can remove them from the model)
- Converts `internalImports` to container-level relationships (model-builder.ts:295)
- Promotes cross-container component relationships (model-builder.ts:344)

The existing plumbing handles everything once the scan data is correct.

### Schema Change

Update `src/schemas/raw-structure.schema.json` to include the optional `publishedAs` field on the application object.

## Testing

### Unit Tests: `tests/analyzers/java/gradle.test.ts`

- `parseSettingsGradle`: basic includes, projectDir overrides, kts syntax, missing file returns null
- `parseGradleDependencies`: project deps, Maven deps, group extraction, mixed quotes, kts syntax

### Unit Tests: `tests/analyzers/java.test.ts`

- Add a multi-module Gradle fixture with settings.gradle
- Verify root project excludes subproject directories
- Verify `internalImports` populated for `project(':...')` deps
- Verify `externalDependencies` populated from build.gradle
- Verify `publishedAs` is set correctly

### Integration Test: Post-scan cross-app matching

- Two apps where one references the other by Maven coordinates
- Verify the external dep is promoted to `internalImport`
- Verify the generated model has the container-level relationship

## Files Changed

| File                                    | Change                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| `src/analyzers/types.ts`                | Add optional `publishedAs` to `ScannedApplication`                    |
| `src/schemas/raw-structure.schema.json` | Add `publishedAs` field                                               |
| `src/analyzers/java/gradle.ts`          | New — `parseSettingsGradle`, `parseGradleDependencies`                |
| `src/analyzers/java/index.ts`           | Use gradle.ts to exclude subproject dirs, parse deps, set publishedAs |
| `src/cli/commands/scan.ts`              | Post-scan cross-app coordinate matching                               |
| `tests/analyzers/java/gradle.test.ts`   | New — gradle parsing tests                                            |
| `tests/analyzers/java.test.ts`          | Multi-module fixture tests                                            |
