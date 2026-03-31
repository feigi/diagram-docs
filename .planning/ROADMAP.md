# Roadmap: Config File Token Optimization

## Overview

Reduce token waste from config files in the LLM pipeline through a three-layer approach: detect architecture signals in config content, filter out files with no signals, extract only signal-bearing lines from remaining files, and condense the result in `summarizeForLLM()`. The milestone concludes with measured proof of reduction and zero information loss.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Signal Detection Engine** - Build deterministic signal detection for architecture-relevant patterns in config file content
- [ ] **Phase 2: Content-Based File Filtering** - Exclude zero-signal config files from raw-structure.json at scan time
- [ ] **Phase 3: Architecture-Relevant Line Extraction** - Extract only signal-bearing lines from config files instead of full contents
- [ ] **Phase 4: LLM Summarization Condensation** - Condense config data to key-value pairs in summarizeForLLM()
- [ ] **Phase 5: Validation & Token Measurement** - Prove reduction with before/after measurements and zero false negatives

## Phase Details

### Phase 1: Signal Detection Engine
**Goal**: A deterministic function exists that identifies architecture signals in config file content
**Depends on**: Nothing (first phase)
**Requirements**: SIG-01, SIG-03
**Success Criteria** (what must be TRUE):
  1. Signal detector correctly identifies URLs, Kafka topics, DB connection strings, and service endpoints in config content
  2. Identical config file content always produces identical signal detection results (no randomness, no external state)
  3. Signal detection works across all collected config formats (YAML, XML, properties, JSON)
**Plans**: 1 plan

Plans:
- [ ] 01-01-PLAN.md — Signal detection engine (TDD: types, tests, pattern registry, noise denylist, detectConfigSignals)

### Phase 2: Content-Based File Filtering
**Goal**: Config files without architecture signals are excluded from scan output
**Depends on**: Phase 1
**Requirements**: SIG-02
**Success Criteria** (what must be TRUE):
  1. Running `diagram-docs scan` produces a `raw-structure.json` with no zero-signal config files (e.g., logback-spring.xml, data fixture JSONs are gone)
  2. Config files containing architecture signals (connection URLs, topic names, endpoints) are still present in output
  3. The configFiles array in raw-structure.json is noticeably smaller for projects with many non-signal files
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — Config filter module with TDD (filterConfigFiles, applyConfigFiltering, tests, JSON schema update)
- [ ] 02-02-PLAN.md — Pipeline integration + CLI verbose flag (wire filtering into runScan/runProjectScan/runScanAll, --verbose)

### Phase 3: Architecture-Relevant Line Extraction
**Goal**: Signal-bearing config files include only their architecture-relevant lines, not full file contents
**Depends on**: Phase 2
**Requirements**: EXT-01, EXT-02
**Success Criteria** (what must be TRUE):
  1. Config file entries in raw-structure.json contain only lines with architecture signals, not the entire file content
  2. Each extracted line includes enough surrounding context (key path, parent element, or neighboring lines) to identify what the value configures
  3. A large file like a 37KB application.yml is reduced to just its connection URLs, topic names, and endpoint declarations
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: LLM Summarization Condensation
**Goal**: `summarizeForLLM()` presents config data as condensed key-value pairs for the LLM
**Depends on**: Phase 3
**Requirements**: SUM-01, SUM-02
**Success Criteria** (what must be TRUE):
  1. The LLM prompt's config section contains structured key-value pairs (e.g., `db.url: jdbc:postgresql://...`) instead of raw YAML/XML/properties content
  2. All connection URLs, Kafka topic names, and service endpoints from the original config files appear in the condensed output — nothing architecture-relevant is dropped
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: Validation & Token Measurement
**Goal**: Proven reduction in token usage with zero loss of architecture-relevant information
**Depends on**: Phase 4
**Requirements**: VAL-01, VAL-02, VAL-03
**Success Criteria** (what must be TRUE):
  1. All existing tests pass without modification (no regressions from filtering/extraction/condensation changes)
  2. Before/after token counts are measured for real-world projects and show significant reduction (targeting the 74-95% config file waste identified in PROJECT.md)
  3. A comparison of pre- and post-optimization LLM input demonstrates that all architecture-relevant signals (URLs, topics, endpoints, DB strings) are preserved
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Signal Detection Engine | 0/1 | Not started | - |
| 2. Content-Based File Filtering | 0/0 | Not started | - |
| 3. Architecture-Relevant Line Extraction | 0/0 | Not started | - |
| 4. LLM Summarization Condensation | 0/0 | Not started | - |
| 5. Validation & Token Measurement | 0/0 | Not started | - |
