---
phase: 02-content-based-file-filtering
verified: 2026-03-31T18:51:00Z
status: passed
score: 11/11 must-haves verified
gaps: []
  # Previously: verbose not threaded to runProjectScan in runScanAll — fixed in 9c501e8
    artifacts:
      - path: "src/core/scan.ts"
        issue: "runScanAll destructures verbose but doesn't pass it to runProjectScan on line 513-518"
    missing:
      - "Add verbose: verbose to runProjectScan call inside runScanAll (line 513-518)"
---

# Phase 2: Content-Based File Filtering Verification Report

**Phase Goal:** Config files without architecture signals are excluded from scan output

**Verified:** 2026-03-31T18:51:00Z

**Status:** gaps_found

**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                         | Status      | Evidence                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | filterConfigFiles() drops files with zero architecture signals                                                | ✓ VERIFIED  | Tests pass: zero-signal files (logback, geo-data) dropped correctly                                                   |
| 2   | filterConfigFiles() keeps files with at least one signal (hard or soft)                                       | ✓ VERIFIED  | Tests pass: application.yml with jdbc + kafka kept with signals detected                                              |
| 3   | filterConfigFiles() returns all detected signals for kept files                                               | ✓ VERIFIED  | Tests verify database-url and message-broker signals returned                                                         |
| 4   | applyConfigFiltering() sets configFiles to undefined when all files dropped                                   | ✓ VERIFIED  | Test "all-dropped" case confirms configFiles=undefined, signals=undefined                                             |
| 5   | applyConfigFiltering() populates signals field on ScannedApplication                                          | ✓ VERIFIED  | Test confirms app.signals populated with detected ConfigSignal array                                                  |
| 6   | raw-structure.schema.json includes optional signals property                                                  | ✓ VERIFIED  | Schema contains signals array with all 8 SignalType enums, NOT in required array                                      |
| 7   | runScan() calls applyConfigFiltering after rollUpShellParents, before writing output                          | ✓ VERIFIED  | Line 348: applyConfigFiltering(rolledUpApplications) after rollUpShellParents (line 345)                              |
| 8   | runProjectScan() calls applyConfigFiltering on the single scanned application                                 | ✓ VERIFIED  | Line 464: applyConfigFiltering([result]) before building RawStructure                                                 |
| 9   | runScanAll() calls applyConfigFiltering on combined applications after matchCrossAppCoordinates               | ⚠️ PARTIAL  | Line 537: applyConfigFiltering(allApplications) present BUT verbose not threaded to internal runProjectScan calls     |
| 10  | scan --verbose shows 'Kept: {path} ({N} signals)' and 'Filtered: {path} (0 signals)' on stderr               | ✓ VERIFIED  | Lines 349-361, 465-477, 538-550: all three scan functions have verbose logging to stderr                              |
| 11  | scan without --verbose produces no filtering output                                                           | ✓ VERIFIED  | Verbose logging guarded by `if (verbose)` check in all three scan functions                                           |

**Score:** 10/11 truths verified (1 partial)

### Required Artifacts

| Artifact                              | Expected                                                 | Status     | Details                                                                           |
| ------------------------------------- | -------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `src/core/config-filter.ts`           | filterConfigFiles and applyConfigFiltering functions     | ✓ VERIFIED | 76 lines, exports all 3: filterConfigFiles, applyConfigFiltering, FilterResult   |
| `tests/core/config-filter.test.ts`    | Unit tests for filter module                             | ✓ VERIFIED | 178 lines (exceeds min_lines: 100), 12 test cases, all passing                   |
| `src/schemas/raw-structure.schema.json` | JSON schema with signals property                        | ✓ VERIFIED | Signals property exists, 8 SignalType enums, NOT required, typescript in language |
| `src/core/scan.ts`                    | Config filtering integrated into all scan paths          | ⚠️ PARTIAL | applyConfigFiltering imported and called in all 3 functions, verbose threading incomplete |
| `src/cli/commands/scan.ts`            | CLI --verbose flag                                       | ✓ VERIFIED | Line 43: -v, --verbose option defined, threaded to all scan calls                 |

### Key Link Verification

| From                        | To                           | Via                            | Status     | Details                                                                               |
| --------------------------- | ---------------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| `src/core/config-filter.ts` | `src/core/config-signals.ts` | import detectConfigSignals     | ✓ WIRED    | Line 7: `import { detectConfigSignals, type ConfigSignal } from "./config-signals.js"` |
| `src/core/config-filter.ts` | `src/analyzers/types.ts`     | import ScannedApplication type | ✓ WIRED    | Line 8: `import type { ScannedApplication } from "../analyzers/types.js"`            |
| `src/core/scan.ts`          | `src/core/config-filter.ts`  | import applyConfigFiltering    | ✓ WIRED    | Line 26: `import { applyConfigFiltering } from "./config-filter.js"`                 |
| `src/cli/commands/scan.ts`  | `src/core/scan.ts`           | passes verbose option          | ⚠️ PARTIAL | Verbose passed to runScan (line 72), runProjectScan (line 113), runScanAll (line 129) BUT runScanAll doesn't pass it to its internal runProjectScan call |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                      | Status      | Evidence                                                                                    |
| ----------- | ----------- | -------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| SIG-02      | 02-01, 02-02 | Files without any architecture signals are excluded from `raw-structure.json`   | ✓ SATISFIED | filterConfigFiles drops zero-signal files, applyConfigFiltering sets configFiles=undefined when all dropped, wired into all 3 scan paths |

**Orphaned requirements:** None (only SIG-02 maps to Phase 2)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| None | -    | -       | -        | -      |

No TODO/FIXME/PLACEHOLDER comments, no empty implementations, no console.log-only stubs detected in modified files.

### Human Verification Required

#### 1. End-to-End Scan with Mixed Config Files

**Test:** Create a test project with both signal-bearing (e.g., application.yml with jdbc:postgresql://...) and zero-signal config files (e.g., logback-spring.xml). Run `diagram-docs scan` and inspect `raw-structure.json`.

**Expected:**
- Zero-signal files (logback-spring.xml) should NOT appear in configFiles array
- Signal-bearing files (application.yml) SHOULD appear with full content
- `signals` array should be populated with detected ConfigSignal objects containing type, value, line, matchedPattern, filePath
- configFiles array noticeably smaller than before Phase 2

**Why human:** Requires real project setup and output inspection — grep can't verify the complete end-to-end behavior with actual file I/O

#### 2. Verbose Output Correctness

**Test:** Run `diagram-docs scan --verbose` on a project with config files. Observe stderr output.

**Expected:**
- Should see `Kept: {path} ({N} signals)` lines for signal-bearing files with correct signal count
- Should see `Filtered: {path} (0 signals)` lines for zero-signal files
- Output should be on stderr (not stdout, so JSON piping still works)
- Without --verbose flag, no filtering output should appear

**Why human:** Terminal output format verification requires visual inspection

#### 3. Success Criteria from ROADMAP

**Test:** For each success criterion:
1. Run `diagram-docs scan` and verify raw-structure.json has no logback-spring.xml or data fixture JSONs
2. Verify connection URLs, topic names, endpoints still present
3. Compare configFiles array size before/after on a real multi-config project

**Expected:**
- All three success criteria observable in real-world usage
- Token count reduction measurable (deferred to Phase 5 VAL-02)

**Why human:** Success criteria are behavioral/observable outcomes requiring real projects

### Gaps Summary

**One partial wiring issue found:**

The `runScanAll` function (line 507) destructures `verbose` from options, and it correctly passes `verbose` to `applyConfigFiltering` (line 538). However, the internal loop that calls `runProjectScan` for each project (lines 513-518) does NOT include `verbose` in the options object.

**Impact:** When running `diagram-docs scan --all` (multi-project scan), the individual project scans won't show verbose filtering output even if --verbose is specified. Only the final combined filtering output will be verbose. The filtering still works correctly — this only affects logging visibility.

**Fix:** Add `verbose` to the runProjectScan call inside runScanAll:

```typescript
// Line 513-518 in src/core/scan.ts
const result = await runProjectScan({
  rootDir,
  project,
  config,
  force,
  verbose,  // <-- ADD THIS LINE
});
```

This is a **low-severity gap** — it doesn't block the goal (filtering works correctly), but it creates inconsistent verbose behavior between scan modes.

---

_Verified: 2026-03-31T18:51:00Z_
_Verifier: Claude (gsd-verifier)_
