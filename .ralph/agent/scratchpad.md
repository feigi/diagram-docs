# PR Review: feat/llm-performance

## Iteration 1 — 2026-03-22

### Objective
PR review of feat/llm-performance, fix all issues.

### Review Summary
Ran 3 parallel review agents (code-reviewer, silent-failure-hunter, type-design-analyzer) on the 9 changed files. Found issues in these categories:

### Issues Found & Fixed

1. **CRITICAL: Broad catch silently swallows all errors in buildOneApp** — Now differentiates LLMCallError/LLMOutputError/YAMLParseError (recoverable → fallback) from TypeError/ReferenceError (programming bugs → propagate). When ALL apps fail, throws instead of returning a purely deterministic model.

2. **HIGH: Synthesis output used `as` type assertion** — Replaced with Zod schema validation. Mutations now applied atomically (validate all fields first, then apply).

3. **HIGH: File read errors silently swallowed in buildOneApp** — Ported careful error handling from the single-app path: only ENOENT falls back to text, other FS errors propagate, warnings emitted for empty files.

4. **HIGH: onStatus was sole error channel and it's optional** — Added `warn()` helper that falls back to `process.stderr.write` when no callback provided.

5. **HIGH: Synthesis catch also too broad** — Now only catches LLM/output/YAML/Zod errors; programming errors propagate.

6. **MEDIUM: Cross-app rel filter included external system rels** — Added null check: both endpoints must resolve to a container.

7. **MEDIUM: Provider errors not wrapped** — Provider.generate() errors now wrapped as LLMCallError at the boundary, keeping outer catch logic clean.

8. **MEDIUM: Dynamic import unhandled** — Wrapped in try-catch with descriptive LLMCallError.

9. **MEDIUM: Bare "h2" keyword false positives** — Removed. Only "h2database" remains.

10. **MEDIUM: DetectedExternalSystem.type was bare string** — Introduced `SystemType` literal union, used in `inferExternalRelationshipLabel` with `Record<SystemType, string>` lookup.

11. **LOW: Precondition guard** — `buildModelParallel` now throws if < 2 apps.

12. **LOW: Comment correction** — Fixed reversed substring relationship in ROLE_PATTERNS comment.

### Tests
- Updated parallel-model-builder tests to use 2+ apps (precondition guard)
- Added "throws when ALL per-app calls fail" test
- Updated patterns tests for removed h2 keyword and typed SystemType
- All 234 tests pass, typecheck clean
