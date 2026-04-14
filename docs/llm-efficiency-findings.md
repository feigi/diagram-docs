# LLM Call Efficiency Findings

**Date:** 2026-03-31
**Analyzed:** 68 per-app LLM calls + 1 synthesis call from `/Users/q475567/los-next/.diagram-docs/debug/`
**Total elapsed:** 8,464s (141 min) across 68 calls

---

## 1. Config file contents sent verbatim — ~946 KB wasted tokens

**Impact: CRITICAL (largest single waste source)**

Full file contents of `logback-spring.xml`, `application.yml`, `application-local.yml`, JSON data files (country centroids, icon mappings, dashboard configs, Elasticsearch body templates, etc.) are embedded in `raw-structure.json`. For the largest apps, config files are **74–95% of the raw-structure.json**, which itself is **89–92% of the user message**.

| App                              | raw-structure | configFiles portion |
| -------------------------------- | ------------- | ------------------- |
| place-search (421s)              | 214 KB        | 160 KB (74%)        |
| kafka-chargingdb-sink-app (182s) | 113 KB        | 108 KB (95%)        |
| cha-app (339s)                   | 28 KB         | 9 KB (32%)          |

Top config file types by total bytes sent across all calls:

| Bytes  | File                           |
| ------ | ------------------------------ |
| 37,082 | application.yml                |
| 27,917 | task.json                      |
| 22,583 | chargingCapabilityConfigs.json |
| 19,260 | logback-spring.xml             |
| 16,648 | application-local.yml          |
| 16,103 | dcs_mapping.json               |
| 13,119 | HUBJECT_static_schema.json     |
| 11,694 | un-country-centroids.json      |
| 11,105 | dlo_country_language.json      |

The LLM only needs connection URLs, topic names, and service endpoints from these files — not full XML/JSON blobs. `summarizeForLLM()` in `llm-model-builder.ts` strips module metadata but passes `configFiles` through **unmodified**.

**Fix:** Summarize config files to extracted key-value pairs (hostnames, topic names, DB endpoints). Or exclude non-architecture files (logback, data fixtures, dashboards). Estimated savings: **~800 KB input, 50–70% latency reduction on large apps**.

---

## 2. Zero-module apps get full LLM calls — 1,742s (21% of total time)

**Impact: HIGH**

25 of 67 per-app calls have `modules: []`, `externalDependencies: []`. These are shell parents or empty wrappers. The deterministic anchor already IS the complete model — the LLM writes it out verbatim with no changes in 7/10 sampled cases. For the remaining 3, it only rewrites a container description.

Examples of wasteful calls:

| App                                 | Elapsed | Modules | LLM changed anything? |
| ----------------------------------- | ------- | ------- | --------------------- |
| los-cha                             | 20s     | 0       | No                    |
| los-tar                             | 23s     | 0       | No                    |
| cobra-agentic-coding                | 27s     | 0       | No                    |
| los-tariffdb                        | 78s     | 0       | No                    |
| owasp-dependency-check-cache-v10    | 82s     | 0       | No                    |
| los-kafka-tariffdb-sink             | 126s    | 0       | No                    |
| los-kafka-charging-eroute-data-sink | 124s    | 0       | No                    |

**Fix:** Skip LLM for apps with 0 modules. Use the deterministic anchor directly. **Saves 1,742s instantly.**

---

## 3. Paired wrapper + app calls (double LLM calls) — 1,047s (12% of total)

**Impact: HIGH**

14 apps have both a wrapper log (`app-los-cha.log`) and an app log (`app-los-cha-app.log`). The wrapper scans the parent directory (e.g., `los-cha/`) which has 0 modules. The app scans the subdirectory (e.g., `los-cha/app/`) which has the actual code. The wrapper call is **always useless** (0 modules, identical output to anchor).

| Wrapper call                                      | Elapsed |
| ------------------------------------------------- | ------- |
| app-los-caps.log                                  | 44s     |
| app-los-cha-ghe.log                               | 22s     |
| app-los-cha.log                                   | 20s     |
| app-los-charging-tariffs-business-logic.log       | 41s     |
| app-los-dynamic-data-aggregator-service.log       | 56s     |
| app-los-kafka-charging-dynamic-data-sink.log      | 105s    |
| app-los-kafka-charging-eroute-data-sink.log       | 124s    |
| app-los-kafka-charging-static-data-redis-sink.log | 106s    |
| app-los-kafka-chargingdb-sink.log                 | 76s     |
| app-los-kafka-tariffdb-sink.log                   | 126s    |
| app-los-product-portal-backend.log                | 100s    |
| app-los-sqs-charging-lcs-sink.log                 | 113s    |
| app-los-streams-charging-dynamic-data-service.log | 91s     |
| app-los-tar.log                                   | 23s     |

Note: These 14 wrapper calls are a subset of the 25 zero-module calls in finding #2. Fixing #2 automatically fixes this.

**Fix:** Filter out apps whose path is a prefix of another app's path before dispatching LLM calls. The prompt already says "Skip shell parent apps" but the code still calls the LLM for them.

---

## 4. LLM performs mechanical validation via tool use — 3–25 extra turns per call

**Impact: HIGH**

The system prompt instructs: _"Write the YAML to [temp file]. After writing, read the file back and verify the YAML parses correctly and conforms to the schema. Fix any issues."_ This causes 3–25 tool-use rounds per call where the LLM:

1. Writes YAML to disk
2. Reads it back
3. Checks IDs/references
4. Fixes issues and repeats

The thinking logs show outputs like _"All 16 modules verified ✓"_, _"All IDs valid"_, _"No generic 'Uses' labels"_ — pure deterministic graph validation the code could do after receiving the YAML.

| App                       | Thinking turns | Evidence                                |
| ------------------------- | -------------- | --------------------------------------- |
| place-search              | 25             | Excessive re-reading of 60K-token input |
| places-localsearch-war    | 4              | Standard but unnecessary validation     |
| kafka-chargingdb-sink-app | 3              | Best ratio, still 2 validation turns    |
| caps-app                  | 4              | "All 16 modules verified ✓"             |
| sqs-lcs-sink-app          | 3              | "All 13 modules assigned ✓"             |

**Fix:** Ask for direct YAML output instead of file write/read cycles. Validate and repair programmatically after the LLM returns (the codebase already has `repairLLMYaml()` in `llm-model-builder.ts`). This would cut most calls from 5+ turns to 1–2 turns. **Estimated 30–50% latency reduction per call.**

---

## 5. System prompt not cached — ~380 KB repeated across 67 calls

**Impact: MEDIUM**

The system prompt (5,682 bytes, ~1,300 tokens) is identical across all 67 per-app calls. With prompt caching (supported by Claude and most providers), this would be cached after the first call and served from cache for the remaining 66.

Additionally, the prompt includes instructions for 3 modes (Anchor, Update, Single-App) but per-app calls only use Anchor + Single-App. ~30% of the prompt is irrelevant instructions.

**Fix:** Enable prompt caching. Strip unused mode instructions for per-app calls. **Saves ~85K tokens total.**

---

## 6. Synthesis call is oversized and does mechanical work — 417s

**Impact: MEDIUM**

The synthesis call receives 67 containers, 32 actors, 86 external systems, and 72 relationships (63 KB user message). It contains:

- **5 duplicate external system pairs** that could be deterministically merged:
  - `apache-kafka` + `apache-kafka-msk`
  - `confluent-schema-registry` + `schema-registry`
  - `redis` + `redis-dynamic-data-store`
  - `aws-cloudwatch` + `cloudwatch`
  - `external-poi-providers` + `external-data-providers`
- **17 generic "Uses" relationship labels** — could use heuristic refinement
- **32 actors with overlapping descriptions** — could pre-consolidate

The synthesis output appears incomplete (only backtick fences, no YAML), suggesting it may have timed out or failed after 417s.

**Fix:** Pre-deduplicate entities before sending to LLM. Pre-refine "Uses" labels using app-name heuristics. Reduce the creative task to just: system description + final label polish. **Estimated 40–60% reduction.**

---

## 7. Redundant content in every user message — ~31 KB total

**Impact: LOW**

`diagram-docs.yaml` config (385 bytes) is included identically in all 67 user messages. It contains settings (`concurrency: 10`, `provider: copilot`, `theme: 0`) that are irrelevant to architecture modeling.

**Fix:** Remove config from user messages or include only architecture-relevant settings (system name, exclude patterns).

---

## 8. Verbose module IDs waste tokens

**Impact: LOW**

Module IDs like `los-sqs-charging-lcs-sink-app-com-bmw-los-next-lcssink-infrastructure-sqs` are full Java package paths. With 10–50+ modules per app, this adds up.

**Fix:** The `summarizeForLLM()` function could strip the common package prefix. **Saves ~1–3 KB per app.**

---

## Summary Table

| #   | Finding                             | Time Impact    | Fix Complexity                             |
| --- | ----------------------------------- | -------------- | ------------------------------------------ |
| 1   | Config files sent verbatim          | ~3,000s (est.) | Medium — summarize in `summarizeForLLM()`  |
| 2   | Zero-module apps get LLM calls      | 1,742s         | Low — skip when `modules.length === 0`     |
| 3   | Paired wrapper calls (subset of #2) | 1,047s         | Low — filter shell parents before dispatch |
| 4   | Mechanical validation via tool use  | ~2,000s (est.) | Medium — switch to direct YAML output      |
| 5   | System prompt not cached            | ~200s (est.)   | Low — enable provider prompt caching       |
| 6   | Synthesis does mechanical dedup     | 417s           | Medium — pre-process before LLM call       |
| 7   | Config YAML in every message        | ~30s (est.)    | Low — remove from user message             |
| 8   | Verbose module IDs                  | ~100s (est.)   | Low — prefix-strip in `summarizeForLLM()`  |

**Top 3 wins by effort-to-impact ratio:** #2 (skip zero-module apps), #4 (drop file write/read cycles), #1 (summarize config files).

---

## All Calls Ranked by Elapsed Time

| Elapsed | Size   | File                                                                    |
| ------- | ------ | ----------------------------------------------------------------------- |
| 421s    | 248 KB | app-los-place-search.log                                                |
| 417s    | 65 KB  | synthesis.log                                                           |
| 391s    | 41 KB  | app-los-places.log                                                      |
| 375s    | 98 KB  | app-los-places-localsearch-war.log                                      |
| 339s    | 45 KB  | app-los-cha-app.log                                                     |
| 335s    | 47 KB  | app-los-cha-ghe-app.log                                                 |
| 223s    | 55 KB  | app-los-product-portal-backend-app.log                                  |
| 204s    | 39 KB  | app-los-tar-app.log                                                     |
| 190s    | 42 KB  | app-los-kafka-charging-eroute-data-sink-app.log                         |
| 189s    | 29 KB  | app-los-ahu.log                                                         |
| 182s    | 130 KB | app-los-kafka-chargingdb-sink-app.log                                   |
| 182s    | 8 KB   | app-los-tariffdb-migration.log                                          |
| 166s    | 257 KB | app-los-places-localsearch-fts-wiremock-war.log                         |
| 164s    | 9 KB   | app-los-airflow-tasks-ecs-tasks-hubs-emea-rest-areas.log                |
| 161s    | 20 KB  | app-los-sqs-charging-lcs-sink-app.log                                   |
| 155s    | 30 KB  | app-los-export.log                                                      |
| 152s    | 24 KB  | app-los-kafka-charging-static-data-redis-sink-app.log                   |
| 148s    | 29 KB  | app-los-kafka-tariffdb-sink-app.log                                     |
| 140s    | 23 KB  | app-los-caps-app.log                                                    |
| 134s    | 17 KB  | app-los-dynamic-data-aggregator-service-app.log                         |
| 126s    | 7 KB   | app-los-kafka-tariffdb-sink.log                                         |
| 125s    | 16 KB  | app-los-streams-charging-dynamic-data-service-app.log                   |
| 125s    | 13 KB  | app-pact-poc-provider.log                                               |
| 124s    | 8 KB   | app-los-kafka-charging-eroute-data-sink.log                             |
| 121s    | 58 KB  | app-los-places-assembly-fargate.log                                     |
| 115s    | 10 KB  | app-pact-poc-consumer.log                                               |
| 114s    | 85 KB  | app-los-airflow-tasks.log                                               |
| 113s    | 7 KB   | app-los-sqs-charging-lcs-sink.log                                       |
| 111s    | 9 KB   | app-charging-availability-push-push-availability-sns-receiver.log       |
| 106s    | 7 KB   | app-los-kafka-charging-static-data-redis-sink.log                       |
| 105s    | 42 KB  | app-los-airflow-tasks-dags.log                                          |
| 105s    | 7 KB   | app-los-kafka-charging-dynamic-data-sink.log                            |
| 102s    | 19 KB  | app-los-charging-tariffs-business-logic-app.log                         |
| 100s    | 7 KB   | app-los-product-portal-backend.log                                      |
| 98s     | 11 KB  | app-bastion-host-connection-tool.log                                    |
| 94s     | 10 KB  | app-ai-config-manager.log                                               |
| 93s     | 9 KB   | app-los-airflow-tasks-ecs-tasks-hubs-emea-parking.log                   |
| 92s     | 24 KB  | app-los-kafka-charging-dynamic-data-sink-app.log                        |
| 92s     | 9 KB   | app-los-tariffdb-model.log                                              |
| 91s     | 7 KB   | app-los-streams-charging-dynamic-data-service.log                       |
| 90s     | 9 KB   | app-los-airflow-tasks-ecs-tasks-hubs-emea-refueling.log                 |
| 85s     | 9 KB   | app-charging-dynamic-localenv-docker-eroute-push-receiver.log           |
| 83s     | 44 KB  | app-charging-dynamic-localenv.log                                       |
| 83s     | 8 KB   | app-los-airflow-tasks-infrastructure-modules-mwaa-resources-plugins.log |
| 83s     | 11 KB  | app-los-charging-data-analytics.log                                     |
| 82s     | 7 KB   | app-owasp-dependency-check-cache-v10.log                                |
| 78s     | 7 KB   | app-los-tariffdb.log                                                    |
| 76s     | 7 KB   | app-los-kafka-chargingdb-sink.log                                       |
| 73s     | 7 KB   | app-los-places-infrastructure.log                                       |
| 70s     | 8 KB   | app-los-avro-to-python.log                                              |
| 69s     | 7 KB   | app-cobra-terraform-modules.log                                         |
| 68s     | 7 KB   | app-deployment-overview.log                                             |
| 65s     | 8 KB   | app-los-next-iac-modules-opensearch-snapshot-src.log                    |
| 63s     | 9 KB   | app-los-avro-schemas-charging-python-packages.log                       |
| 63s     | 8 KB   | app-los-chargingdb-model.log                                            |
| 56s     | 7 KB   | app-charging-availability-push-authorizer.log                           |
| 56s     | 7 KB   | app-los-dynamic-data-aggregator-service.log                             |
| 54s     | 7 KB   | app-charging-availability-push-authorizer-lambda-src-main.log           |
| 51s     | 7 KB   | app-los-avro-schemas-charging.log                                       |
| 44s     | 7 KB   | app-los-caps.log                                                        |
| 44s     | 8 KB   | app-los-next-iac-modules-mwaa-resources-plugins.log                     |
| 41s     | 7 KB   | app-los-charging-tariffs-business-logic.log                             |
| 40s     | 7 KB   | app-los-chargingdb.log                                                  |
| 35s     | 7 KB   | app-los-airflow-tasks-ecs-tasks-common.log                              |
| 27s     | 7 KB   | app-cobra-agentic-coding.log                                            |
| 23s     | 7 KB   | app-los-tar.log                                                         |
| 22s     | 7 KB   | app-los-cha-ghe.log                                                     |
| 20s     | 7 KB   | app-los-cha.log                                                         |
