# Testing Patterns

**Analysis Date:** 2025-01-20

## Test Framework

**Runner:**

- Vitest 3.x
- Config: `vitest.config.ts`

**Assertion Library:**

- Vitest built-in `expect` (Chai-compatible API)

**Run Commands:**

```bash
npm test                   # Run all tests (vitest run)
npm run test:watch         # Watch mode (vitest)
npx vitest run tests/core/model-builder.test.ts  # Single test file
npm run test:quality       # Quality test suite only
npm run test:correctness   # Precision/recall against ground truth
npm run test:drift         # Output stability tests
npm run test:tokens        # Token efficiency measurements
npm run bench              # Performance benchmarks (vitest bench)
npm run typecheck          # Type checking (tsc --noEmit)
```

## Test File Organization

**Location:**

- Separate `tests/` directory at project root (not co-located with source)
- Test directory structure mirrors `src/` structure

**Naming:**

- Test files: `{module-name}.test.ts`
- Benchmark files: `{module-name}.bench.ts`
- Quality helper modules: `tests/quality/helpers/{name}.ts`

**Structure:**

```
tests/
├── analyzers/           # Language analyzer tests
│   ├── c.test.ts
│   ├── java.test.ts
│   ├── java/
│   │   └── gradle.test.ts
│   ├── python.test.ts
│   └── typescript.test.ts
├── bench/               # Performance benchmarks
│   ├── analyzers.bench.ts
│   └── pipeline.bench.ts
├── cli/                 # CLI utility tests
│   ├── interactive-setup.test.ts
│   ├── parallel-progress.test.ts
│   └── terminal-utils.test.ts
├── config/              # Configuration tests
│   └── effective-excludes.test.ts
├── core/                # Core logic tests
│   ├── agent-logger.test.ts
│   ├── cascading-config.test.ts
│   ├── classify.test.ts
│   ├── debug-logger.test.ts
│   ├── error-classification.test.ts
│   ├── humanize.test.ts
│   ├── llm-yaml-repair.test.ts
│   ├── model-builder.test.ts       # 1003 lines
│   ├── model-fragment.test.ts
│   ├── parallel-model-builder.test.ts  # 2173 lines (largest test file)
│   ├── patterns.test.ts
│   ├── per-project-cache.test.ts
│   ├── remove.test.ts
│   └── scan-rollup.test.ts
├── fixtures/            # Shared test fixtures
│   ├── monorepo/        # Multi-language monorepo fixture
│   ├── gradle-multimodule/
│   ├── classify/
│   └── model.yaml
├── generator/           # D2 generator tests
│   ├── d2.test.ts
│   ├── svg-post-process.test.ts
│   └── validate.test.ts
├── integration/         # End-to-end pipeline tests
│   ├── pipeline.test.ts
│   └── submodule.test.ts
└── quality/             # Quality measurement tests
    ├── correctness.test.ts
    ├── drift.test.ts
    ├── token-efficiency.test.ts
    ├── fixtures/        # Ground truth expected output
    │   ├── TEMPLATE.md
    │   ├── java-spring/expected.json
    │   ├── python-fastapi/expected.json
    │   ├── c-cmake/expected.json
    │   └── typescript-express/expected.json
    └── helpers/         # Quality metric utilities
        ├── types.ts
        ├── metrics.ts
        └── reporter.ts
```

**Total:** 31 test files + 2 benchmark files = 33 test/bench files (~8,060 lines of test code)

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect } from "vitest";
import { detectRole, detectExternalSystems } from "../../src/core/patterns.js";

describe("detectRole", () => {
  it("returns undefined for empty annotations", () => {
    expect(detectRole("")).toBeUndefined();
  });

  it("detects controller from RestController annotation (case-insensitive)", () => {
    expect(detectRole("restcontroller")).toBe("controller");
  });

  // False positive avoidance
  it("does not match ExceptionHandler as controller", () => {
    expect(detectRole("ExceptionHandler")).toBeUndefined();
  });
});
```

**Key Patterns:**

- Import `describe`, `it`, `expect` explicitly from `vitest` (globals enabled but explicit imports used consistently)
- One `describe` per function/class/concept
- Nested `describe` blocks for sub-categories (e.g., per-language in classify tests)
- Test names are descriptive sentences starting with a verb
- Include both positive and negative test cases (especially false-positive avoidance)

**Setup/Teardown:**

```typescript
describe("AgentLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes START marker with metadata", async () => {
    const logPath = path.join(tmpDir, "agent-test.log");
    // ...test code...
  });
});
```

- Temp directories created with `fs.mkdtempSync()` in `beforeEach`
- Cleaned up with `fs.rmSync()` in `afterEach`
- Test output directories cleaned in `afterAll` for integration tests

## Test Data Helpers

**Factory Functions:**

```typescript
function makeConfig(overrides = {}) {
  return configSchema.parse(overrides);
}

function makeRawStructure(
  apps: RawStructure["applications"] = [],
): RawStructure {
  return {
    version: 1,
    scannedAt: "2026-01-01T00:00:00Z",
    checksum: "test",
    applications: apps,
  };
}

function makeApp(
  id: string,
  overrides?: Partial<RawStructure["applications"][0]>,
): RawStructure["applications"][0] {
  return {
    id,
    path: `apps/${id}`,
    name: id,
    language: "java",
    buildFile: `apps/${id}/build.gradle`,
    modules: [],
    externalDependencies: [],
    internalImports: [],
    ...overrides,
  };
}
```

- Use `make` prefix for factory functions
- Accept `overrides` via spread operator for flexible test data
- Provide sensible defaults for all required fields
- Defined at top of test file, before `describe` blocks

**Shared Constants:**

```typescript
const FIXTURES = path.resolve(
  __dirname,
  "../fixtures/monorepo/services/user-api",
);
const defaultConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: { granularity: "balanced" as const, excludePatterns: [] },
};
```

## Mocking

**Framework:** Vitest built-in (`vi`)

**Patterns:**

- Mocking is used sparingly — most tests use real implementations
- `vi.stubGlobal()` for process/global mocking:
  ```typescript
  beforeEach(() => {
    vi.stubGlobal("process", {
      ...process,
      stderr: { ...process.stderr, isTTY: false },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  ```
- Dynamic imports after mocking to ensure stubs take effect:
  ```typescript
  it("prints app state transitions", async () => {
    const { createParallelProgress } =
      await import("../../src/cli/parallel-progress.js");
    // ... test with mocked environment
  });
  ```
- stderr capture pattern for CLI output testing:
  ```typescript
  function captureStderr() {
    stderrOutput = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput +=
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
  }
  ```

**What to Mock:**

- Process/environment globals (TTY mode, PATH)
- stderr output capture for CLI tests
- LLM providers use mock provider objects implementing `LLMProvider` interface (not vi.mock)

**What NOT to Mock:**

- File system operations — tests use real temp directories and fixture files
- Analyzers — tests run against real fixture codebases
- Configuration parsing — tests use real Zod schema validation
- Node built-in modules (explicit note in `tests/analyzers/typescript.test.ts`: "vi.spyOn cannot intercept native ESM module exports")

## Fixtures and Factories

**Test Data:**

- Monorepo fixture at `tests/fixtures/monorepo/` — multi-language project (Java, Python, C, TypeScript)
- Gradle multi-module fixture at `tests/fixtures/gradle-multimodule/`
- Classification fixtures at `tests/fixtures/classify/` (per-language, per-type)
- Model fixture at `tests/fixtures/model.yaml` for generator tests
- Quality ground truth at `tests/quality/fixtures/{language}/expected.json`

**Ground Truth Schema:**

```typescript
export interface ExpectedApplication {
  language: "java" | "python" | "c";
  modules: Array<{
    name: string;
    exports: string[];
  }>;
  imports: Array<{
    source: string;
    inModule: string;
    isExternal: boolean;
  }>;
  externalDependencies: Array<{ name: string }>;
  metadata: Record<string, Record<string, string>>;
}
```

**Adding New Fixtures:**

- See `tests/quality/fixtures/TEMPLATE.md` for ground truth format
- Register in the `FIXTURES` array in `tests/quality/correctness.test.ts`

## Coverage

**Requirements:** None enforced — no coverage thresholds configured

**View Coverage:**

```bash
npx vitest run --coverage  # Not configured by default; vitest supports it via plugin
```

## Test Types

**Unit Tests:**

- Most tests (~25 files) are unit tests
- Located in `tests/core/`, `tests/analyzers/`, `tests/generator/`, `tests/cli/`, `tests/config/`
- Test individual functions with controlled inputs
- Pure function tests pass data in, assert output
- File-system-dependent tests use temp directories

**Integration Tests:**

- Located in `tests/integration/`
- `pipeline.test.ts`: Full scan → generate pipeline against monorepo fixture
- `submodule.test.ts`: Git submodule detection and documentation scaffolding
- Test real file system operations and multi-step workflows
- Use `afterAll` for cleanup

**Quality Tests (Unique to this project):**

- Located in `tests/quality/`
- **Correctness** (`correctness.test.ts`): Measures precision, recall, F1 against ground truth fixtures. Registers reports in `afterAll` for summary output.
- **Drift** (`drift.test.ts`): Measures output stability when model is mutated. Tests determinism, additive changes, renames, and removals.
- **Token Efficiency** (`token-efficiency.test.ts`): Measures token counts of scan output using `gpt-tokenizer`. Reports per-section breakdown.
- Quality tests use custom helper modules in `tests/quality/helpers/`:
  - `metrics.ts`: `computeSetMetrics()`, `macroF1()`, `extractD2ShapeIds()`, `computeLineChurn()`
  - `reporter.ts`: `formatCorrectnessReport()`, `generateCorrectnessSuggestions()`
  - `types.ts`: `SetMetrics`, `CorrectnessReport`, `DriftReport`, `TokenReport`

**Benchmarks:**

- Located in `tests/bench/`
- Use vitest bench API: `bench("name", async () => { ... })`
- `pipeline.bench.ts`: Discovery, full scan, and generation benchmarks
- `analyzers.bench.ts`: Per-analyzer benchmarks
- Run with `npm run bench`
- Results output to `bench-results.json`

**E2E Tests:**

- No browser or CLI E2E tests (the tool is a CLI — integration tests serve this role)

## Common Patterns

**Async Testing:**

```typescript
it("analyzes a Java application", async () => {
  const result = await javaAnalyzer.analyze(FIXTURES, defaultConfig);
  expect(result.language).toBe("java");
  expect(result.modules.length).toBeGreaterThan(0);
});
```

**Error Testing:**

```typescript
it("rethrows programming errors", () => {
  expect(() => rethrowIfFatal(new TypeError("x"))).toThrow(TypeError);
});

it("does not throw for generic Error", () => {
  expect(() => rethrowIfFatal(new Error("x"))).not.toThrow();
});
```

**File System Testing (with temp dir):**

```typescript
it("writes header with metadata", () => {
  const writer = new DebugLogWriter({
    dir: tmpDir,
    label: "test-app",
    metadata: { provider: "claude-code", model: "sonnet" },
  });
  writer.logPrompt("sys", "usr");
  writer.finish(5000);

  const content = fs.readFileSync(path.join(tmpDir, "test-app.log"), "utf-8");
  expect(content).toContain("=== LLM CALL DEBUG LOG ===");
  expect(content).toContain("Provider: claude-code");
});
```

**Model Mutation for Drift Testing:**

```typescript
function cloneModel(model: ArchitectureModel): ArchitectureModel {
  return JSON.parse(JSON.stringify(model));
}

it("adding a container only adds lines", () => {
  const after = cloneModel(model);
  after.containers.push({ id: "new-svc" /* ... */ });
  const report = measureDrift("Add container", model, after, [
    "context",
    "container",
  ]);
  expect(report.stabilityScore).toBeGreaterThanOrEqual(0.8);
});
```

**Quality Metrics Pattern:**

```typescript
it("module discovery", () => {
  const foundModules = actual.modules.map((m) => m.name);
  const expectedModules = expected.modules.map((m) => m.name);
  const metrics = computeSetMetrics(foundModules, expectedModules);
  expect(metrics.recall).toBeGreaterThanOrEqual(0.5);
});
```

**Conditional Skip for External Tools:**

```typescript
it("returns valid count for valid D2 files", () => {
  const result = validateD2Files([validFile]);
  if (result === null) return; // d2 CLI not installed, skip
  expect(result.valid).toBe(1);
});
```

## Report Pattern

Quality tests use `afterAll` to aggregate and print reports:

```typescript
const reports: CorrectnessReport[] = [];

afterAll(() => {
  console.log("\n" + "=".repeat(70));
  console.log("CORRECTNESS SUMMARY");
  console.log("=".repeat(70));
  for (const report of reports) {
    console.log(formatCorrectnessReport(report));
  }
});
```

Reports are accumulated during test execution and printed once at the end. This pattern appears in correctness, drift, and token efficiency tests.

---

_Testing analysis: 2025-01-20_
