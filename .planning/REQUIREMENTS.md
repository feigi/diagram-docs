# Requirements — Config File Token Optimization

## v1 Requirements

### Config Signal Detection
- [x] **SIG-01**: Scanner detects architecture signals in config file contents (URLs, hostnames, Kafka topics, DB connection strings, service endpoints)
- [ ] **SIG-02**: Files without any architecture signals are excluded from `raw-structure.json`
- [x] **SIG-03**: Signal detection is deterministic — identical input always produces identical output

### Content Extraction
- [ ] **EXT-01**: Only architecture-relevant lines are extracted from signal-bearing files (not full contents)
- [ ] **EXT-02**: Extracted content preserves enough context to identify what each value configures (key path or surrounding context)

### LLM Summarization
- [ ] **SUM-01**: `summarizeForLLM()` condenses remaining config files to key-value pairs instead of passing raw content
- [ ] **SUM-02**: Condensed output contains all connection URLs, topic names, and service endpoints from the original

### Validation
- [ ] **VAL-01**: All existing tests continue to pass
- [ ] **VAL-02**: Before/after token counts are measured and reported, proving reduction
- [ ] **VAL-03**: No architecture-relevant information is lost (no false negatives on critical signals)

## v2 Requirements (Deferred)

- User-configurable signal patterns via `diagram-docs.yaml`
- Per-file relevance scoring (confidence levels)
- Structured YAML/properties parsing instead of regex-based extraction
- Config file summarization using LLM for ambiguous cases

## Out of Scope

- LLM prompt optimization beyond config files — separate effort
- Module metadata reduction — already handled
- New language analyzers — unrelated
- D2 generation changes — downstream
- Changes to the 10KB size limit — orthogonal concern

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SIG-01 | Phase 1: Signal Detection Engine | Complete |
| SIG-02 | Phase 2: Content-Based File Filtering | Pending |
| SIG-03 | Phase 1: Signal Detection Engine | Complete |
| EXT-01 | Phase 3: Architecture-Relevant Line Extraction | Pending |
| EXT-02 | Phase 3: Architecture-Relevant Line Extraction | Pending |
| SUM-01 | Phase 4: LLM Summarization Condensation | Pending |
| SUM-02 | Phase 4: LLM Summarization Condensation | Pending |
| VAL-01 | Phase 5: Validation & Token Measurement | Pending |
| VAL-02 | Phase 5: Validation & Token Measurement | Pending |
| VAL-03 | Phase 5: Validation & Token Measurement | Pending |

---
*Last updated: 2025-07-14 after roadmap creation*
