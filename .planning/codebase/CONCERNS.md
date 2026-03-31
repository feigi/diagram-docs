# Codebase Concerns

**Analysis Date:** 2025-03-31

## Tech Debt

**Duplicated LLM output cleanup logic:**

- Issue: The YAML cleanup pipeline (strip markdown fences, find YAML start, repair, validate) is duplicated nearly verbatim between `buildModelWithLLM()` and `buildOneApp()` in the parallel builder.
- Files: `src/core/llm-model-builder.ts` (lines 1465–1500), `src/core/parallel-model-builder.ts` (lines 449–480)
- Impact: Bug fixes or improvements to YAML cleanup must be applied in two places. Divergence has already occurred — the single-app path reports `removedLines` content while the parallel path does not.
- Fix approach: Extract a shared `cleanupLLMOutput(rawOutput, warn)` function into `llm-model-builder.ts` that handles fence stripping, preamble detection, YAML repair, and empty-output errors. Call it from both paths.

**Duplicated `deduplicateImports()` function:**

- Issue: An identical `deduplicateImports()` function is copy-pasted into each language analyzer.
- Files: `src/analyzers/java/index.ts` (line 213), `src/analyzers/python/index.ts` (line 154), `src/analyzers/c/index.ts` (line 101), `src/analyzers/typescript/index.ts` (line 197)
- Impact: Four copies of the same function. Any enhancement (e.g., deduplicating by resolved path) must be applied four times.
- Fix approach: Move to a shared utility, e.g., `src/analyzers/utils.ts`, and import from each analyzer.

**Duplicated streaming JSON spawn helpers:**

- Issue: `spawnStreamJson()` (Claude Code CLI) and `spawnCopilotJsonl()` (Copilot CLI) share ~80% identical boilerplate: timeout handling, syntax error counting, settled-state management, EPIPE handling. Only the event parsing differs.
- Files: `src/core/llm-model-builder.ts` (lines 130–402 for Claude, lines 533–779 for Copilot)
- Impact: The file is 1538 lines (the largest in the codebase), largely due to this duplication. Maintenance burden is high.
- Fix approach: Extract a generic `spawnWithJsonParsing()` that accepts a per-line event parser callback. Each provider implements only the event-shape parsing.

**Dead code after early return in `buildModelWithLLM()`:**

- Issue: Lines 1326–1341 (anchor generation in the update path) are unreachable because the `isAnchorMode` branch at line 1282 returns early via the parallel builder. The second `if (isAnchorMode)` block at line 1326 can never execute.
- Files: `src/core/llm-model-builder.ts` (lines 1326–1341)
- Impact: Dead code creates confusion about the actual control flow for new contributors.
- Fix approach: Remove the dead block. The parallel builder already handles anchor generation internally.

**`diagram-docs-0.1.0.tgz` in working tree:**

- Issue: A 414KB npm package tarball exists in the repo root. While `.gitignore` has `*.tgz`, the file was present at commit time (possibly added before the gitignore rule). `git ls-files` shows it is not tracked.
- Files: `diagram-docs-0.1.0.tgz`
- Impact: Adds clutter to the working directory. If accidentally committed, it bloats the repo.
- Fix approach: Delete the file. Rely on `npm pack` to regenerate when needed.

**Manifest V1 / V2 dual format:**

- Issue: The manifest system supports both V1 (`Manifest`) and V2 (`ManifestV2`) formats in the same file. Both `readManifest` and `readManifestV2` are called in `generate.ts`, writing both formats to the same path. The V1 format lacks the `projects` field that V2 provides.
- Files: `src/core/manifest.ts`, `src/cli/commands/generate.ts` (lines 351–372)
- Impact: Confusing API — callers must know which version to read. Race conditions possible if both formats are written by different code paths. V1 may silently overwrite V2 data.
- Fix approach: Migrate fully to V2. Add a migration path that reads V1 and upgrades to V2 on write. Remove V1 types and functions.

## Known Bugs

**No known bugs detected in code review.**

The codebase shows careful error handling, particularly in the LLM integration paths, with proper fallback to deterministic mode on failure.

## Security Considerations

**Command execution via `execFileSync` and `spawn`:**

- Risk: The tool spawns external processes (`claude`, `copilot`, `d2`, `which`). Command names are hardcoded strings, not user-controlled, which is safe. However, user-provided model names from config flow into command arguments.
- Files: `src/core/llm-model-builder.ts` (lines 424, 469, 571), `src/cli/commands/generate.ts` (line 506), `src/generator/d2/validate.ts` (line 25)
- Current mitigation: Uses `execFileSync`/`spawn` (not `exec`/`execSync`), which avoids shell injection. Arguments are passed as arrays, not interpolated strings. Path traversal in app IDs is sanitized (`safeAppId` in `parallel-model-builder.ts` line 321).
- Recommendations: The approach is sound. No changes needed.

**Temp files written to `os.tmpdir()`:**

- Risk: System prompt and LLM output files are written to `/tmp` with predictable names (`diagram-docs-sysprompt-{timestamp}.txt`). On shared systems, another user could pre-create symlinks (symlink attack).
- Files: `src/core/llm-model-builder.ts` (lines 455, 1344), `src/core/parallel-model-builder.ts` (line 363)
- Current mitigation: Files are cleaned up in `finally` blocks. Timestamps provide some uniqueness.
- Recommendations: Use `fs.mkdtempSync()` for a unique temporary directory per invocation, or use `crypto.randomUUID()` in filenames. Low priority — the tool targets developer workstations, not shared servers.

**Unsafe YAML parsing of cached data:**

- Risk: `readProjectCache()` uses `parseYaml()` and casts the result to `ArchitectureModel` without Zod validation. If cache files are tampered with, malformed data flows into the pipeline unchecked.
- Files: `src/core/per-project-cache.ts` (line 34), `src/core/manifest.ts` (lines 32, 73)
- Current mitigation: Cache files are in `.diagram-docs/` which is typically local.
- Recommendations: Add `architectureModelSchema.parse()` validation when reading cached models, matching the validation applied to LLM output.

## Performance Bottlenecks

**Synchronous file I/O throughout the codebase:**

- Problem: All file operations use synchronous APIs (`readFileSync`, `writeFileSync`, `existsSync`, `readdirSync`, etc.) — 163 instances across the source.
- Files: Nearly every file in `src/analyzers/`, `src/core/`, `src/generator/`, `src/config/`
- Cause: Simpler code flow, and for a CLI tool processing local files, the performance impact is minimal.
- Improvement path: This is acceptable for a CLI tool. Only convert to async if scan performance on large monorepos becomes an issue. The checksum computation (`src/core/checksum.ts`) is the one place where async I/O would help most — it already yields to the event loop every 50 files.

**Checksum computation misses TypeScript/TSX files:**

- Problem: `SOURCE_EXTENSIONS` in `checksum.ts` includes `java`, `py`, `c`, `h`, `xml`, `gradle`, `toml`, `cfg`, `txt`, `cmake` but NOT `ts`, `tsx`, `js`, `jsx`, `json`. TypeScript projects' checksums may not detect changes to source files.
- Files: `src/core/checksum.ts` (lines 6–17)
- Cause: TypeScript analyzer was added after the checksum module. The extensions list was not updated.
- Improvement path: Add `ts`, `tsx`, `js`, `jsx`, `json`, `kts` (Kotlin Gradle) to `SOURCE_EXTENSIONS`. This is a correctness issue that could cause stale cache hits.

**Regex-based parsing in analyzers:**

- Problem: All language analyzers use regex-based parsing for imports, annotations, and dependency extraction (39 regex patterns in `src/analyzers/`). This is fragile for edge cases like multi-line annotations, string literals containing code patterns, or comments.
- Files: `src/analyzers/java/packages.ts` (line 14), `src/analyzers/java/imports.ts`, `src/analyzers/python/imports.ts`, `src/analyzers/java/gradle.ts` (lines 31–60)
- Cause: Avoids dependency on language-specific AST parsers. Keeps the tool lightweight.
- Improvement path: Acceptable tradeoff for now. If precision issues arise (see quality tests in `tests/quality/correctness.test.ts`), consider tree-sitter bindings for languages with the most edge cases (Java annotations, Python imports).

## Fragile Areas

**LLM output parsing pipeline:**

- Files: `src/core/llm-model-builder.ts` (lines 1465–1525), `src/core/parallel-model-builder.ts` (lines 449–507)
- Why fragile: The code must handle arbitrary text from LLMs — markdown-wrapped YAML, preamble text, truncated output, smashed list items. The repair logic (`repairLLMYaml`) handles known failure modes but new LLM models may produce novel malformations.
- Safe modification: Always add new repair patterns to `repairLLMYaml()` with corresponding tests in `tests/core/llm-yaml-repair.test.ts`. Test with real LLM output samples.
- Test coverage: Good — `tests/core/llm-yaml-repair.test.ts` (139 lines) covers smashed lines and truncation. `tests/core/parallel-model-builder.test.ts` (2173 lines) covers the full parallel pipeline.

**Gradle build file parsing:**

- Files: `src/analyzers/java/gradle.ts`
- Why fragile: Gradle build files use a Groovy/Kotlin DSL. Regex parsing catches common patterns (`include`, `implementation`, `project()`) but misses dynamic dependency declarations, build script plugins that generate dependencies, and Kotlin DSL syntax variations.
- Safe modification: Add test cases to `tests/analyzers/java/gradle.test.ts` before changing regex patterns. Ensure multi-arg `include()` calls are handled.
- Test coverage: Dedicated test file exists (`tests/analyzers/java/gradle.test.ts`), but parser is inherently limited by the regex approach.

**Terminal UI components:**

- Files: `src/cli/parallel-progress.ts` (452 lines), `src/cli/frame.ts` (442 lines)
- Why fragile: Heavy use of ANSI escape sequences, cursor manipulation, and mouse event capture. Terminal state (raw mode, cursor visibility, mouse capture) must be restored on exit, including signal handlers. The `emergencyRestore()` function handles SIGINT/SIGTERM cleanup.
- Safe modification: Always test with both TTY and non-TTY stderr. Check that Ctrl+C properly restores terminal state. The non-TTY fallback path (`printLine`) is simpler and should always remain functional.
- Test coverage: `tests/cli/parallel-progress.test.ts` tests the non-TTY path. TTY rendering is hard to test automatically.

**Scan ID normalization:**

- Files: `src/core/scan.ts` (lines 300–334)
- Why fragile: Module IDs are normalized from absolute-path-based to relative-path-based using string prefix replacement. If `slugify()` produces IDs that don't follow the expected prefix pattern, the normalization silently fails, leaving absolute paths in module IDs.
- Safe modification: Add assertion checks that normalized IDs don't contain the absolute prefix. Test with symlinked directories and unusual path characters.
- Test coverage: Covered indirectly via integration tests, but no direct unit test for the normalization logic.

## Scaling Limits

**LLM concurrency:**

- Current capacity: Config allows up to 16 concurrent LLM calls (`llm.concurrency` max: 16, default: 10).
- Limit: For monorepos with 50+ apps, even 16 concurrent LLM calls could take many minutes. Each call has a 15-minute timeout.
- Scaling path: The per-project caching system (`per-project-cache.ts`) mitigates this — only changed projects trigger LLM calls. For very large repos, consider batching multiple small apps into a single LLM call.

**Checksum computation for large repos:**

- Current capacity: Reads every source file to hash content.
- Limit: For repos with thousands of source files, the synchronous `readFileSync` in the loop blocks the event loop (mitigated by `setImmediate` yield every 50 files).
- Scaling path: Use `fs.createReadStream` + streaming hash, or switch to file modification timestamps as a cheaper staleness check.

## Dependencies at Risk

**No high-risk dependencies identified.**

All dependencies are well-maintained:

- `commander` (CLI framework) — stable, widely used
- `zod` (validation) — actively maintained
- `yaml` (YAML parsing) — mature
- `chalk` (terminal colors) — stable
- `glob` (file matching) — actively maintained

DevDependencies like `gpt-tokenizer` and `jsondiffpatch` are only used in quality tests and don't affect the runtime package.

## Missing Critical Features

**No error recovery on partial LLM failures in update mode:**

- Problem: The update-mode LLM path (non-anchor, with `existingModelYaml`) in `buildModelWithLLM()` has no fallback. If the LLM call fails, the error propagates to the CLI which calls `process.exit(1)`.
- Blocks: Users editing an existing model who encounter a transient LLM failure lose the ability to regenerate diagrams without manually choosing `--deterministic`.
- Files: `src/core/llm-model-builder.ts` (lines 1322–1525)

**C analyzer does not extract external dependencies:**

- Problem: The C analyzer returns an empty `externalDependencies` array. It doesn't parse CMakeLists.txt for `find_package()`, `target_link_libraries()`, or pkg-config dependencies.
- Blocks: C projects won't have auto-detected external systems in their architecture models.
- Files: `src/analyzers/c/index.ts` (line 95)

## Test Coverage Gaps

**`src/core/llm-model-builder.ts` — no direct test file:**

- What's not tested: The 1538-line LLM model builder has no dedicated test file. The `spawnStreamJson()` and `spawnCopilotJsonl()` functions are untested directly. Error handling for the streaming JSON parser, timeout logic, EPIPE handling, and temp file cleanup are not covered.
- Files: `src/core/llm-model-builder.ts`
- Risk: The streaming spawn helpers contain complex state machines (settled flag, syntax error counting, timer management). Bugs in edge cases (partial output + timeout, EPIPE + successful exit) would be hard to catch.
- Priority: High — this is the largest file and handles the most critical integration path.

**CLI commands have no tests:**

- What's not tested: `src/cli/commands/generate.ts` (603 lines), `src/cli/commands/scan.ts`, `src/cli/commands/model.ts`, `src/cli/commands/init.ts` — none have direct unit tests.
- Files: `src/cli/commands/*.ts`
- Risk: The generate command contains significant orchestration logic (model resolution, caching, rendering). Regressions in the flow between discovery → scan → model → generate → render would go undetected.
- Priority: Medium — integration tests (`tests/integration/pipeline.test.ts`) cover the happy path, but error paths and edge cases (no d2 installed, model staleness detection, submodule linking) are not tested.

**D2 generators have minimal tests:**

- What's not tested: `src/generator/d2/context.ts`, `src/generator/d2/container.ts`, `src/generator/d2/component.ts` generate D2 syntax but are only tested through `tests/generator/d2.test.ts` (178 lines). Edge cases like empty models, single-container systems, and deeply nested component hierarchies may not be covered.
- Files: `src/generator/d2/context.ts`, `src/generator/d2/container.ts`, `src/generator/d2/component.ts`
- Risk: D2 syntax errors in generated output would only be caught at render time (when `d2` CLI is available).
- Priority: Medium — the `validateD2Files()` function provides runtime validation, but generator logic could produce valid-but-incorrect diagrams.

**Analyzer sub-modules lack unit tests:**

- What's not tested: Individual parsing functions in `src/analyzers/java/imports.ts`, `src/analyzers/java/packages.ts`, `src/analyzers/python/imports.ts`, `src/analyzers/python/modules.ts`, `src/analyzers/typescript/imports.ts`, `src/analyzers/typescript/modules.ts`, `src/analyzers/c/includes.ts`, `src/analyzers/c/structure.ts` have no direct unit tests.
- Files: All files listed above
- Risk: The regex-based parsing in these files is exercised through integration-level analyzer tests (`tests/analyzers/java.test.ts`, etc.) using fixture files, but specific edge cases (e.g., multi-line Java imports, Python relative imports with dots, Gradle Kotlin DSL syntax) may not be covered.
- Priority: Low — the quality tests (`tests/quality/correctness.test.ts`) measure overall precision/recall and would catch significant regressions.

---

_Concerns audit: 2025-03-31_
