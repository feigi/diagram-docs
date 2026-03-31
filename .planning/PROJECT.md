# diagram-docs

## What This Is

A TypeScript CLI that generates C4 architecture diagrams in D2 format from source code. It implements a three-phase pipeline: scan (static analysis → `raw-structure.json`), model (deterministic or LLM-agent-driven conversion → `architecture-model.yaml`), and generate (D2 diagrams at context/container/component levels → `docs/architecture/`).

## Core Value

Accurately extract architecture-relevant structure from source code with minimal token waste, so the LLM agent can produce high-quality architecture models without burning time and money on irrelevant content.

## Requirements

### Validated

- ✓ Multi-language static analysis (Java, Python, C, TypeScript) — existing
- ✓ Plugin-based analyzer architecture with `LanguageAnalyzer` interface — existing
- ✓ Config file collection from resource directories — existing
- ✓ Deterministic model building from raw structure — existing
- ✓ D2 diagram generation at three C4 levels — existing
- ✓ LLM-based model building with `summarizeForLLM()` — existing
- ✓ Manifest caching with checksums for skip-unchanged — existing
- ✓ Zod-validated config from `diagram-docs.yaml` — existing
- ✓ Deterministic output ordering via `stability.ts` — existing
- ✓ Quality tests measuring precision/recall against ground truth — existing

### Active

- [ ] Content-based config file filtering at scan time — exclude files without architecture signals
- [ ] Architecture-relevant line extraction — include only signal-bearing lines, not full file contents
- [ ] Config summarization in `summarizeForLLM()` — condense remaining config to extracted key-value pairs
- [ ] Token savings quantification — before/after measurement proving the reduction

### Out of Scope

- LLM prompt optimization beyond config files — separate effort
- Module metadata reduction in `summarizeForLLM()` — already stripped, not this milestone
- Adding new language analyzers — unrelated
- Changes to D2 generation pipeline — downstream of this work
- User-configurable signal patterns — keep it simple for v1, hardcode sensible defaults

## Context

Config files are the largest single source of token waste in the LLM pipeline. For the largest apps, config files are 74–95% of `raw-structure.json`, which is 89–92% of the user message sent to the LLM.

The current pipeline in `src/analyzers/config-files.ts` uses a broad glob (`**/*.{yml,yaml,properties,xml,json,...}`) with only a 10KB size cap and extension filter. Files like `logback-spring.xml`, `un-country-centroids.json`, `dcs_mapping.json`, and dashboard configs contain zero architecture-relevant information but consume ~800KB of input tokens across typical runs.

The LLM only needs: connection URLs, topic names, service endpoints, database URLs, and similar integration-relevant configuration. Full XML logging configs and JSON data fixtures provide no value.

### Measured impact (from real-world runs)

| App                       | raw-structure | configFiles portion |
| ------------------------- | ------------- | ------------------- |
| place-search              | 214 KB        | 160 KB (74%)        |
| kafka-chargingdb-sink-app | 113 KB        | 108 KB (95%)        |
| cha-app                   | 28 KB         | 9 KB (32%)          |

Top offenders by bytes: `application.yml` (37KB), `task.json` (28KB), `chargingCapabilityConfigs.json` (23KB), `logback-spring.xml` (19KB), `application-local.yml` (17KB).

### Key files

- `src/analyzers/config-files.ts` — `collectConfigFiles()` discovery and filtering
- `src/core/llm-model-builder.ts` — `summarizeForLLM()` passes configFiles unmodified
- `src/analyzers/types.ts` — `configFiles?: Array<{ path: string; content: string }>` type definition
- `src/analyzers/java/index.ts` — Java analyzer scans `src/main/resources/` and `src/main/webapp/WEB-INF/`

## Constraints

- **Backward compatibility**: `raw-structure.json` schema must remain valid — `configFiles` is already optional, so fewer/smaller entries is fine
- **No false negatives on critical signals**: URL patterns, Kafka topics, DB connection strings must never be dropped
- **Deterministic**: filtering must produce identical output for identical input (no randomness, no LLM in the loop)
- **Performance**: signal detection must be fast — regex/pattern matching, not heavy parsing
- **Test coverage**: existing quality tests must continue passing

## Key Decisions

| Decision                                                  | Rationale                                                                                | Outcome   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| Content-based filtering over filename allowlist/denylist  | More robust across projects — doesn't depend on naming conventions                       | — Pending |
| Filter at scan time, not just summarization               | raw-structure.json should only contain useful data; no one needs a full config inventory | — Pending |
| Extract only architecture-relevant lines, not full files  | Even a 9KB application.yml may have only 200 bytes of URLs — send only what matters      | — Pending |
| No special treatment for any filename                     | Purely content-based — application.yml gets the same signal check as any other file      | — Pending |
| Two-layer approach (scan filter + summarization condense) | Defense in depth — scan excludes junk files, summarization condenses remaining ones      | — Pending |

---

_Last updated: 2026-03-31 after initialization_
