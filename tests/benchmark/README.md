# Benchmark: Hybrid Pipeline vs. Pure LLM Agent

This directory contains prompts for benchmarking the diagram-docs hybrid approach
(deterministic scan → LLM model → deterministic generator) against a pure LLM agent approach.

## Prompt Variants

| File                                                 | Description                                                                                            | Process guidance                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| [`prompt-prescriptive.md`](./prompt-prescriptive.md) | Full instructions — build file lookup, annotation heuristics, grouping rules, external system patterns | Detailed, step-by-step                |
| [`prompt-minimal.md`](./prompt-minimal.md)           | Outcome-only — LLM decides how to analyze the code                                                     | None; only output format is specified |

Both prompts produce identical output artifacts:

- `architecture-model.yaml`
- `docs/architecture/styles.d2`
- `docs/architecture/c1-context.d2`
- `docs/architecture/c2-container.d2`
- `docs/architecture/containers/<id>/c3-component.d2` (one per container)

## Running the Benchmark

Point the prompt at a repo with the `ROOT_DIR` variable. The monorepo fixture at
`tests/fixtures/monorepo/` is a good baseline — its expected output already exists there.

```
ROOT_DIR=tests/fixtures/monorepo
OUTPUT_DIR=tests/fixtures/monorepo/docs/architecture
```

Run each prompt variant N times (≥3) and collect:

### Metrics

| Metric            | How to measure                                                   |
| ----------------- | ---------------------------------------------------------------- |
| **Input tokens**  | Token count of prompt + all file reads                           |
| **Output tokens** | Token count of all written files                                 |
| **Latency**       | Wall-clock time from first tool call to last `write_file`        |
| **Stability**     | Diff of `architecture-model.yaml` and D2 files across N runs     |
| **Accuracy**      | Diff against ground-truth fixtures in `tests/fixtures/monorepo/` |

### Stability scoring

After N runs, for each output file compute:

- **Label drift** — count lines that differ across runs (excluding comments/timestamps)
- **Structural drift** — count added/removed nodes or edges across runs

Lower is better. The hybrid pipeline scores 0 on structural drift (deterministic scan + generator).

### Accuracy scoring

Use the fixtures as ground truth. For each diagram level, compute:

- **Nodes**: precision / recall / F1 against expected node set
- **Edges**: precision / recall / F1 against expected edge set

The quality test suite in `npm run test:correctness` uses the same approach for scan output.

## Hypothesis

| Dimension            | Hybrid                     | Prescriptive LLM   | Minimal LLM         |
| -------------------- | -------------------------- | ------------------ | ------------------- |
| Input tokens         | Low (compressed scan JSON) | High               | Medium              |
| Latency              | Fast                       | Slow               | Slower (more reads) |
| Structural stability | Deterministic              | High (constrained) | Lower               |
| Description quality  | Templated                  | Good               | Best                |
| Framework coverage   | Rule-based                 | Rule-based         | Broadest            |
