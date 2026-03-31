---
phase: 01-signal-detection-engine
plan: "01"
subsystem: core/signal-detection
tags: [config-signals, pattern-matching, deterministic, tdd]
dependency_graph:
  requires: []
  provides: [detectConfigSignals, ConfigSignal, SignalType]
  affects: [src/analyzers/types.ts]
tech_stack:
  added: []
  patterns: [pattern-registry, noise-denylist, line-by-line-scan, deduplication, deterministic-sort]
key_files:
  created:
    - src/core/config-signals.ts
    - tests/core/config-signals.test.ts
  modified:
    - src/analyzers/types.ts
decisions:
  - Pattern registry approach mirrors existing patterns.ts architecture
  - No /g flag on any regex to prevent lastIndex state leakage
  - Noise denylist filters matched values, not full lines
  - Deduplication by filePath::type::value, keeping first occurrence
  - Deterministic sort by filePath, then line number, then signal type
metrics:
  duration: 5m34s
  completed: 2026-03-31T15:09:00Z
  tasks_completed: 2
  tasks_total: 2
  test_count: 40
  lines_created: 659
---

# Phase 01 Plan 01: Config Signal Detection Engine Summary

Signal detection engine with 19-pattern registry, noise denylist, and deterministic line-by-line scanning of config file content for architecture-relevant infrastructure signals (JDBC URLs, Kafka, Redis, S3, env vars, etc.)

## What Was Built

### `src/core/config-signals.ts` (265 lines)
- **SignalType** union type: 8 signal categories (database-url, message-broker, cache-endpoint, search-endpoint, object-storage, service-endpoint, server-config, env-infrastructure)
- **ConfigSignal** interface: readonly type, value, line, matchedPattern, filePath
- **SIGNAL_PATTERNS** registry: 19 regex-based pattern entries covering JDBC (PostgreSQL/MySQL/Oracle/SQLite/H2), MongoDB, Kafka bootstrap/topic, AMQP, Redis URL/host, Memcached, Elasticsearch, S3 endpoint/bucket, generic service URLs, server port config, and infrastructure env var references
- **NOISE_DENYLIST**: 18 regex patterns filtering XML namespaces, Maven repos, documentation links, Spring Actuator paths, localhost/127.0.0.1/0.0.0.0/[::1]
- **detectConfigSignals()** function: line-by-line scanning, noise filtering, deduplication by filePath::type::value, deterministic sort by filePath→line→type

### `tests/core/config-signals.test.ts` (394 lines)
- 40 test cases across 12 describe blocks
- Coverage: all 19 pattern types, 7 noise filtering cases, 4 multi-format tests (YAML/properties/XML/JSON), 3 determinism tests, 1 deduplication test, 1 metadata completeness test

### `src/analyzers/types.ts` (modified)
- Added `import type { ConfigSignal }` from core module
- Added `signals?: ConfigSignal[]` optional field to `ScannedApplication` interface

## Task Execution

| Task | Name | Type | Commit | Duration |
|------|------|------|--------|----------|
| 1 | Define types + failing test suite (RED) | TDD-RED | 05f5265 | ~2m |
| 2 | Implement detection engine (GREEN) | TDD-GREEN | 22f64a4 | ~3m |

## Verification Results

- ✅ All 40 config-signals tests pass
- ✅ Full test suite (474 tests, 32 files) passes with zero regressions
- ✅ TypeScript compiles cleanly (`tsc --noEmit --skipLibCheck`)
- ✅ ESLint passes
- ✅ SIG-01 satisfied: detects all infrastructure signal types
- ✅ SIG-03 satisfied: deterministic pure function with sorted output

## Deviations from Plan

None — plan executed exactly as written.

## Key Technical Decisions

1. **No `/g` flag on regexes** — prevents `lastIndex` state leakage between calls
2. **Value-based noise filtering** — `isNoise()` checks the matched value substring, not the full line
3. **Deduplication key**: `${filePath}::${type}::${value}` — keeps first occurrence only
4. **Comment skipping**: lines matching `^\s*[#!]` or `^\s*<!--` are skipped entirely
5. **Pattern ordering**: specific protocol patterns (jdbc:, amqp:, redis:, mongodb:) before generic service-url to ensure correct primary match
