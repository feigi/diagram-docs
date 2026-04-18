# Split Scan vs Model Fingerprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toggling `levels.code` (or other L4-only config) must not force an LLM model rebuild when source and structural config are unchanged.

**Architecture:** Today a single per-project fingerprint mixes all scan-relevant config (source excludes, abstraction, L4 settings) into one checksum. Flipping `levels.code: true` invalidates the cache, `staleProjects` becomes non-empty, `resolveModel` skips the "reuse model" branch, and `buildModelFromScan` runs (defaults to LLM). We split the fingerprint in two: a **scan fingerprint** (unchanged, decides whether to re-scan) and a **model fingerprint** (decides whether the L1–L3 architecture model is stale). L4 fields live in the scan fingerprint only, so L4 toggles re-scan but reuse the cached model; `attachCodeModel` then materializes L4 from the fresh scan.

**Tech Stack:** TypeScript (ES2022, Node16), vitest, zod (config schema), node:crypto (sha256).

---

## File Structure

- **Modify `src/core/scan.ts`** — add `buildModelFingerprint`, `MODEL_SCHEMA_VERSION`; update `runProjectScan` and `runScanAll` to compute/propagate both checksums and a `modelStale` flag.
- **Modify `src/core/checksum.ts`** — add `computeProjectSourceHash` (no fingerprint) and `mixFingerprint(sourceHash, fingerprint)`; keep `computeProjectChecksum` as the public whole-repo primitive used by the `scan` CLI command.
- **Modify `src/core/per-project-cache.ts`** — replace the single `checksum` text file with `cache-meta.json` storing both `scanChecksum` and `modelChecksum`; expose `isScanStale` / `isModelStale`; extend `ProjectCache`.
- **Modify `src/cli/commands/generate.ts`** — `resolveModel` uses `modelStaleProjects` (not `staleProjects`) for the reuse-vs-rebuild decision, and the "N container(s) changed" log / manifestV2 synthesis timestamp follow the same signal.
- **Extend `tests/core/scan-fingerprint.test.ts`** — unit tests for `buildModelFingerprint`.
- **Extend `tests/core/per-project-cache.test.ts`** — cache format + staleness tests.
- **Add `tests/integration/levels-code-cache.test.ts`** — end-to-end: flipping `levels.code` re-scans but does not mark the model stale.
- **Add `tests/config/fingerprint-coverage.test.ts`** — tripwire: every top-level config key must be explicitly classified as scan-only, structural, or ignored.

---

## Task 1: Add `buildModelFingerprint` and `MODEL_SCHEMA_VERSION`

**Files:**

- Modify: `src/core/scan.ts` (add export near `buildScanFingerprint`, lines 67–85)
- Test: `tests/core/scan-fingerprint.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/scan-fingerprint.test.ts`:

```typescript
import {
  buildScanFingerprint,
  buildModelFingerprint,
} from "../../src/core/scan.js";

describe("buildModelFingerprint", () => {
  const baseConfig = configSchema.parse({});
  const excludes = ["**/build/**"];

  it("is deterministic for the same inputs", () => {
    const a = buildModelFingerprint(excludes, baseConfig);
    const b = buildModelFingerprint(excludes, baseConfig);
    expect(a).toBe(b);
  });

  it("changes when excludes change", () => {
    const a = buildModelFingerprint(excludes, baseConfig);
    const b = buildModelFingerprint([...excludes, "**/tmp/**"], baseConfig);
    expect(a).not.toBe(b);
  });

  it("changes when abstraction changes", () => {
    const a = buildModelFingerprint(
      excludes,
      configSchema.parse({ abstraction: { granularity: "balanced" } }),
    );
    const b = buildModelFingerprint(
      excludes,
      configSchema.parse({ abstraction: { granularity: "detailed" } }),
    );
    expect(a).not.toBe(b);
  });

  it("is stable when levels.code toggles (the whole point of splitting)", () => {
    const off = buildModelFingerprint(
      excludes,
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildModelFingerprint(
      excludes,
      configSchema.parse({ levels: { code: true } }),
    );
    expect(off).toBe(on);
  });

  it("is stable when code.* changes", () => {
    const a = buildModelFingerprint(
      excludes,
      configSchema.parse({ code: { minElements: 2 } }),
    );
    const b = buildModelFingerprint(
      excludes,
      configSchema.parse({ code: { minElements: 5 } }),
    );
    expect(a).toBe(b);
  });

  it("includes scan.include only when requested", () => {
    const without = buildModelFingerprint(excludes, baseConfig);
    const withInclude = buildModelFingerprint(excludes, baseConfig, {
      includeScanInclude: true,
    });
    expect(without).not.toBe(withInclude);
  });

  it("encodes a schemaVersion so model-logic changes invalidate caches", () => {
    const fp = buildModelFingerprint(excludes, baseConfig);
    expect(fp).toMatch(/"modelSchemaVersion":\d+/);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/core/scan-fingerprint.test.ts`
Expected: FAIL — `buildModelFingerprint is not a function`.

- [ ] **Step 3: Implement `buildModelFingerprint` and `MODEL_SCHEMA_VERSION`**

In `src/core/scan.ts`, after the `SCAN_SCHEMA_VERSION` block (line 67), add:

```typescript
/**
 * Bump when L1–L3 model-building logic changes in a way that would make
 * previously cached per-project `model.yaml` fragments inconsistent with
 * the current builder — e.g. a change in how components are grouped.
 *
 * Kept separate from SCAN_SCHEMA_VERSION so that scan-output-format bumps
 * don't needlessly invalidate model caches (and vice versa).
 */
export const MODEL_SCHEMA_VERSION = 1;

/**
 * Build the fingerprint used to decide whether the L1–L3 architecture model
 * is stale. Must contain every config key that affects `model-builder.ts`
 * output (containers, components, relationships). Must NOT contain L4-only
 * knobs (`levels.code`, `code.*`) — those re-invalidate the scan but the
 * cached model can be reused and L4 re-attached from the fresh scan.
 *
 * Contract: any new config key that influences L1–L3 must be added here AND
 * in `buildScanFingerprint`. The tripwire test in
 * `tests/config/fingerprint-coverage.test.ts` enforces explicit
 * classification of every top-level config key.
 */
export function buildModelFingerprint(
  effectiveExcludes: string[],
  config: Config,
  options?: { includeScanInclude?: boolean },
): string {
  const fingerprint: Record<string, unknown> = {
    modelSchemaVersion: MODEL_SCHEMA_VERSION,
    exclude: effectiveExcludes,
    abstraction: config.abstraction,
  };
  if (options?.includeScanInclude) {
    fingerprint.include = config.scan.include;
  }
  return JSON.stringify(fingerprint);
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/core/scan-fingerprint.test.ts`
Expected: PASS (all `buildScanFingerprint` + `buildModelFingerprint` tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/scan.ts tests/core/scan-fingerprint.test.ts
git commit -m "feat(scan): add buildModelFingerprint for L1-L3 staleness"
```

---

## Task 2: Add `computeProjectSourceHash` and `mixFingerprint`

**Files:**

- Modify: `src/core/checksum.ts`
- Test: `tests/core/per-project-cache.test.ts` (add a new `describe` block)

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/per-project-cache.test.ts` (after the existing `describe("computeProjectChecksum", ...)`):

```typescript
import {
  computeProjectChecksum,
  computeProjectSourceHash,
  mixFingerprint,
} from "../../src/core/checksum.js";

describe("computeProjectSourceHash", () => {
  it("hashes only source files (no fingerprint mixed in)", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const srcA = await computeProjectSourceHash(dir, []);
    const srcB = await computeProjectSourceHash(dir, []);
    expect(srcA).toBe(srcB);
    expect(srcA).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is independent of any fingerprint", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const src = await computeProjectSourceHash(dir, []);
    const ck = await computeProjectChecksum(dir, [], "fingerprint-a");
    expect(src).not.toBe(ck);
  });
});

describe("mixFingerprint", () => {
  it("is deterministic", () => {
    expect(mixFingerprint("sha256:abc", "fp")).toBe(
      mixFingerprint("sha256:abc", "fp"),
    );
  });

  it("produces different checksums for different fingerprints", () => {
    const a = mixFingerprint("sha256:abc", "fp-a");
    const b = mixFingerprint("sha256:abc", "fp-b");
    expect(a).not.toBe(b);
  });

  it("produces different checksums for different source hashes", () => {
    const a = mixFingerprint("sha256:aaa", "fp");
    const b = mixFingerprint("sha256:bbb", "fp");
    expect(a).not.toBe(b);
  });

  it("matches computeProjectChecksum when composed", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const src = await computeProjectSourceHash(dir, []);
    const combined = await computeProjectChecksum(dir, [], "fp-x");
    expect(mixFingerprint(src, "fp-x")).toBe(combined);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: FAIL — `computeProjectSourceHash is not a function`, `mixFingerprint is not a function`.

- [ ] **Step 3: Implement the new primitives**

Replace the body of `computeProjectChecksum` in `src/core/checksum.ts` and add the two new exports:

```typescript
export async function computeProjectSourceHash(
  projectDir: string,
  exclude: string[],
): Promise<string> {
  const hash = crypto.createHash("sha256");
  const extPattern = `**/*.{${SOURCE_EXTENSIONS.join(",")}}`;
  const files = await glob(extPattern, {
    cwd: projectDir,
    ignore: exclude,
    nodir: true,
  });
  const sortedFiles = files.sort();
  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const content = fs.readFileSync(path.join(projectDir, file), "utf-8");
    hash.update(`${file}\n`);
    hash.update(content);
    if (i % 50 === 49) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

export function mixFingerprint(
  sourceHash: string,
  fingerprint: string,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(fingerprint);
  hash.update("\n");
  hash.update(sourceHash);
  return `sha256:${hash.digest("hex")}`;
}

export async function computeProjectChecksum(
  projectDir: string,
  exclude: string[],
  configFingerprint?: string,
): Promise<string> {
  const source = await computeProjectSourceHash(projectDir, exclude);
  if (!configFingerprint) return source;
  return mixFingerprint(source, configFingerprint);
}
```

> Note: the test `"matches computeProjectChecksum when composed"` verifies that the new derivation is equivalent to the old single-pass one when the fingerprint is non-empty. This keeps existing callers of `computeProjectChecksum` (the whole-repo `runScan` path) behavior-identical.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: PASS (old `computeProjectChecksum` tests + new ones).

- [ ] **Step 5: Commit**

```bash
git add src/core/checksum.ts tests/core/per-project-cache.test.ts
git commit -m "feat(checksum): split source hash from fingerprint mix"
```

---

## Task 3: Per-project cache stores both checksums

**Files:**

- Modify: `src/core/per-project-cache.ts`
- Test: `tests/core/per-project-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the `describe("per-project cache", ...)` block in `tests/core/per-project-cache.test.ts` with:

```typescript
import {
  readProjectCache,
  writeProjectScan,
  writeProjectModel,
  isScanStale,
  isModelStale,
} from "../../src/core/per-project-cache.js";

describe("per-project cache", () => {
  const tmpDir = path.join(os.tmpdir(), `diagram-docs-test-${Date.now()}`);
  const projectDir = path.join(tmpDir, "my-service");

  beforeEach(() => {
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no cache exists", () => {
    expect(readProjectCache(projectDir)).toBeNull();
  });

  it("writes and reads both checksums", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:scan",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:scan", "sha256:model");

    const cache = readProjectCache(projectDir);
    expect(cache).not.toBeNull();
    expect(cache!.scanChecksum).toBe("sha256:scan");
    expect(cache!.modelChecksum).toBe("sha256:model");
    expect(cache!.scan).toEqual(scan);
    expect(cache!.model).toBeNull();
  });

  it("writes and reads model cache", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:scan",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:scan", "sha256:model");

    const model = {
      version: 1 as const,
      system: { name: "Test", description: "" },
      actors: [],
      externalSystems: [],
      containers: [],
      components: [],
      relationships: [],
    };
    writeProjectModel(projectDir, model);

    const cache = readProjectCache(projectDir);
    expect(cache!.model).toEqual(model);
  });

  it("detects scan-stale and model-stale independently", () => {
    writeProjectScan(
      projectDir,
      {
        version: 1 as const,
        scannedAt: "2026-01-01T00:00:00Z",
        checksum: "sha256:scan",
        applications: [],
      },
      "sha256:scan",
      "sha256:model",
    );

    expect(isScanStale(projectDir, "sha256:scan")).toBe(false);
    expect(isScanStale(projectDir, "sha256:other")).toBe(true);
    expect(isModelStale(projectDir, "sha256:model")).toBe(false);
    expect(isModelStale(projectDir, "sha256:other")).toBe(true);
  });

  it("reports stale when no cache exists", () => {
    expect(isScanStale(projectDir, "sha256:any")).toBe(true);
    expect(isModelStale(projectDir, "sha256:any")).toBe(true);
  });

  it("treats pre-migration caches (legacy single `checksum` file) as stale", () => {
    const cacheDir = path.join(projectDir, ".diagram-docs");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "checksum"), "sha256:legacy");
    fs.writeFileSync(
      path.join(cacheDir, "scan.json"),
      JSON.stringify({
        version: 1,
        scannedAt: "2026-01-01T00:00:00Z",
        checksum: "sha256:legacy",
        applications: [],
      }),
    );

    expect(readProjectCache(projectDir)).toBeNull();
    expect(isScanStale(projectDir, "sha256:legacy")).toBe(true);
    expect(isModelStale(projectDir, "sha256:legacy")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: FAIL — `isScanStale`/`isModelStale` don't exist; `writeProjectScan` has wrong arity.

- [ ] **Step 3: Update the cache module**

Replace the content of `src/core/per-project-cache.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";

const CACHE_DIR = ".diagram-docs";
const META_FILE = "cache-meta.json";

interface CacheMeta {
  version: 1;
  scanChecksum: string;
  modelChecksum: string;
}

export interface ProjectCache {
  scanChecksum: string;
  modelChecksum: string;
  scan: RawStructure;
  model: ArchitectureModel | null;
}

function readMeta(projectDir: string): CacheMeta | null {
  const metaPath = path.join(projectDir, CACHE_DIR, META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (parsed?.version !== 1) return null;
    if (
      typeof parsed.scanChecksum !== "string" ||
      typeof parsed.modelChecksum !== "string"
    ) {
      return null;
    }
    return parsed as CacheMeta;
  } catch {
    return null;
  }
}

/**
 * Read cached scan and model for a project. Returns null when no cache
 * exists or the cache predates the two-checksum migration — the caller
 * must then treat the project as stale.
 */
export function readProjectCache(projectDir: string): ProjectCache | null {
  const meta = readMeta(projectDir);
  if (!meta) return null;

  const cacheDir = path.join(projectDir, CACHE_DIR);
  const scanPath = path.join(cacheDir, "scan.json");
  if (!fs.existsSync(scanPath)) return null;
  const scan: RawStructure = JSON.parse(fs.readFileSync(scanPath, "utf-8"));

  const modelPath = path.join(cacheDir, "model.yaml");
  const model = fs.existsSync(modelPath)
    ? (parseYaml(fs.readFileSync(modelPath, "utf-8")) as ArchitectureModel)
    : null;

  return {
    scanChecksum: meta.scanChecksum,
    modelChecksum: meta.modelChecksum,
    scan,
    model,
  };
}

export function writeProjectScan(
  projectDir: string,
  scan: RawStructure,
  scanChecksum: string,
  modelChecksum: string,
): void {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(cacheDir, "scan.json"),
    JSON.stringify(scan, null, 2),
    "utf-8",
  );

  const meta: CacheMeta = { version: 1, scanChecksum, modelChecksum };
  fs.writeFileSync(
    path.join(cacheDir, META_FILE),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
}

export function writeProjectModel(
  projectDir: string,
  model: ArchitectureModel,
): void {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, "model.yaml"),
    stringifyYaml(model, { lineWidth: 120 }),
    "utf-8",
  );
}

export function isScanStale(
  projectDir: string,
  currentScanChecksum: string,
): boolean {
  const meta = readMeta(projectDir);
  if (!meta) return true;
  return meta.scanChecksum !== currentScanChecksum;
}

export function isModelStale(
  projectDir: string,
  currentModelChecksum: string,
): boolean {
  const meta = readMeta(projectDir);
  if (!meta) return true;
  return meta.modelChecksum !== currentModelChecksum;
}
```

> Removal note: `isProjectStale` is gone. All callers (`src/core/scan.ts`) move to the new split API in the next task. If you discover any other callers via `grep`, migrate them too — the old function should not remain.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: PASS (all new cache tests + the already-passing checksum tests from Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/core/per-project-cache.ts tests/core/per-project-cache.test.ts
git commit -m "feat(cache): store scan and model checksums separately"
```

---

## Task 4: `runProjectScan` computes both, returns `modelStale`

**Files:**

- Modify: `src/core/scan.ts` (`runProjectScan`, lines 457–562; `ProjectScanResult` interface at line 444)
- Test: add to `tests/core/per-project-cache.test.ts` (lightweight, uses fixture monorepo)

- [ ] **Step 1: Write the failing test**

Append to `tests/core/per-project-cache.test.ts`:

```typescript
import { runProjectScan } from "../../src/core/scan.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";

describe("runProjectScan (two-fingerprint cache)", () => {
  // Use a copy of the monorepo fixture so per-project cache files don't leak
  // into the checked-in tree.
  const tmpRoot = path.join(os.tmpdir(), `dd-runscan-${Date.now()}`);
  const project = {
    path: "services/api-gateway",
    language: "java",
    type: "container" as const,
    analyzerId: "java",
    buildFile: "build.gradle",
  };

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    // Copy fixture into tmpRoot
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("populates scanChecksum and modelChecksum on first run", async () => {
    const config = buildEffectiveConfig(configSchema.parse({}));
    const result = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config,
    });
    expect(result.fromCache).toBe(false);
    expect(result.modelStale).toBe(true); // first run → everything is fresh

    const cache = readProjectCache(path.join(tmpRoot, project.path));
    expect(cache).not.toBeNull();
    expect(cache!.scanChecksum).toMatch(/^sha256:/);
    expect(cache!.modelChecksum).toMatch(/^sha256:/);
    expect(cache!.scanChecksum).not.toBe(cache!.modelChecksum);
  });

  it("toggling levels.code re-scans but leaves modelStale = false", async () => {
    const off = buildEffectiveConfig(
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildEffectiveConfig(
      configSchema.parse({ levels: { code: true } }),
    );

    const first = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config: off,
    });
    expect(first.fromCache).toBe(false);

    const second = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config: on,
    });
    // The scan must re-run because L4 extraction wasn't done on the first pass.
    expect(second.fromCache).toBe(false);
    // But the L1–L3 model is unchanged, so modelStale must be false.
    expect(second.modelStale).toBe(false);
  });

  it("changing abstraction.granularity marks the model stale", async () => {
    const balanced = buildEffectiveConfig(
      configSchema.parse({ abstraction: { granularity: "balanced" } }),
    );
    const detailed = buildEffectiveConfig(
      configSchema.parse({ abstraction: { granularity: "detailed" } }),
    );

    await runProjectScan({ rootDir: tmpRoot, project, config: balanced });
    const second = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config: detailed,
    });
    expect(second.fromCache).toBe(false);
    expect(second.modelStale).toBe(true);
  });

  it("hits the cache when nothing changes", async () => {
    const config = buildEffectiveConfig(configSchema.parse({}));
    await runProjectScan({ rootDir: tmpRoot, project, config });
    const second = await runProjectScan({ rootDir: tmpRoot, project, config });
    expect(second.fromCache).toBe(true);
    expect(second.modelStale).toBe(false);
  });
});
```

Also add at the top of the file (if not already imported):

```typescript
import { configSchema } from "../../src/config/schema.js";
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: FAIL — `modelStale` doesn't exist on `ProjectScanResult`.

- [ ] **Step 3: Update `runProjectScan` and the result type**

In `src/core/scan.ts`, replace the `ProjectScanResult` interface (line 444) with:

```typescript
export interface ProjectScanResult {
  project: DiscoveredProject;
  scan: RawStructure;
  /** True when the project's scan output came from cache (no re-analyze). */
  fromCache: boolean;
  /**
   * True when the L1–L3 model derived from this scan needs to be rebuilt
   * — source files changed or a structural config key (excludes,
   * abstraction, schemaVersion, optional scan.include) changed. L4-only
   * config toggles do NOT set this.
   */
  modelStale: boolean;
}
```

Update the imports at the top of the file:

```typescript
import {
  readProjectCache,
  writeProjectScan,
  isScanStale,
  isModelStale,
} from "./per-project-cache.js";
import {
  computeProjectSourceHash,
  mixFingerprint,
  computeChecksum,
} from "./checksum.js";
```

Replace the body of `runProjectScan` (lines 457–562). Keep all analyzer-invocation / ID-normalization / filter-extraction logic intact — only the checksum computation and cache read/write change:

```typescript
export async function runProjectScan(options: {
  rootDir: string;
  project: DiscoveredProject;
  config: Config;
  force?: boolean;
  verbose?: boolean;
}): Promise<ProjectScanResult> {
  const { rootDir, project, config: effectiveConfig, force, verbose } = options;
  const projectAbsPath = path.resolve(rootDir, project.path);
  const effectiveExcludes = effectiveConfig.scan.exclude;

  const scanFingerprint = buildScanFingerprint(
    effectiveExcludes,
    effectiveConfig,
  );
  const modelFingerprint = buildModelFingerprint(
    effectiveExcludes,
    effectiveConfig,
  );

  const sourceHash = await computeProjectSourceHash(
    projectAbsPath,
    effectiveExcludes,
  );
  const scanChecksum = mixFingerprint(sourceHash, scanFingerprint);
  const modelChecksum = mixFingerprint(sourceHash, modelFingerprint);

  if (!force && !isScanStale(projectAbsPath, scanChecksum)) {
    const cache = readProjectCache(projectAbsPath);
    if (cache) {
      return {
        project,
        scan: cache.scan,
        fromCache: true,
        modelStale: cache.modelChecksum !== modelChecksum,
      };
    }
  }

  // Scan was stale (or missing) — re-run the analyzer.
  const analyzer = getAnalyzer(project.analyzerId);
  if (!analyzer) {
    throw new ScanError(`No analyzer found for ${project.analyzerId}`);
  }

  const scanConfig = {
    exclude: effectiveExcludes,
    abstraction: effectiveConfig.abstraction,
    levels: effectiveConfig.levels,
    code: effectiveConfig.code,
  };

  const result = await analyzer.analyze(projectAbsPath, scanConfig);

  const relativeId = slugify(project.path);
  const absolutePrefix = slugify(projectAbsPath);
  result.path = project.path;
  result.id = relativeId;

  for (const mod of result.modules) {
    if (mod.id.startsWith(absolutePrefix)) {
      mod.id = relativeId + mod.id.slice(absolutePrefix.length);
    }
  }
  for (const mod of result.modules) {
    for (const imp of mod.imports) {
      if (imp.resolved?.startsWith(absolutePrefix)) {
        imp.resolved = relativeId + imp.resolved.slice(absolutePrefix.length);
      }
    }
  }

  const filterResults = applyConfigFiltering([result]);
  if (verbose) {
    for (const [, filterResult] of filterResults) {
      for (const file of filterResult.kept) {
        const count = filterResult.signals.filter(
          (s) => s.filePath === file.path,
        ).length;
        console.error(`  Kept: ${file.path} (${count} signals)`);
      }
      for (const droppedPath of filterResult.dropped) {
        console.error(`  Filtered: ${droppedPath} (0 signals)`);
      }
    }
  }

  const extractionResults = applyConfigExtraction([result]);
  if (verbose) {
    for (const [, appResults] of extractionResults) {
      for (const r of appResults) {
        console.error(
          `  Extracted: ${r.filePath} (${r.originalLineCount} → ${r.extractedSignalCount} lines)`,
        );
      }
    }
  }

  const scan: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: scanChecksum,
    applications: [result],
  };

  // Determine whether the *model* became stale: compare the new model
  // checksum with what the previous cache held, if any.
  const prevCache = readProjectCache(projectAbsPath);
  const modelStale = !prevCache || prevCache.modelChecksum !== modelChecksum;

  writeProjectScan(projectAbsPath, scan, scanChecksum, modelChecksum);

  return { project, scan, fromCache: false, modelStale };
}
```

> Rationale: when the scan re-runs, we still consult the prior cache meta (if any) to decide whether the _model_ component of the fingerprint changed. If only `levels.code` flipped, `modelChecksum` matches the previous one → `modelStale: false` → downstream treats the architecture model as reusable. The order "read previous cache, then write new cache" is deliberate — swap it and `modelStale` would always be false on every re-scan.

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: PASS.

Also run the suite to catch adjacent breakage:

```bash
npx vitest run tests/core/ tests/config/
```

Expected: PASS (any failures here likely come from callers of the removed `isProjectStale` — fix them in this task if they exist outside `src/core/scan.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/core/scan.ts tests/core/per-project-cache.test.ts
git commit -m "feat(scan): compute scan and model checksums per project"
```

---

## Task 5: `runScanAll` exposes `modelStaleProjects`

**Files:**

- Modify: `src/core/scan.ts` (`runScanAll`, lines 571–659)
- Test: extend `tests/core/per-project-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/core/per-project-cache.test.ts`:

```typescript
import { runScanAll } from "../../src/core/scan.js";
import { discoverApplications } from "../../src/core/discovery.js";

describe("runScanAll (model-stale aggregation)", () => {
  const tmpRoot = path.join(os.tmpdir(), `dd-runscanall-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("flipping levels.code re-scans but modelStaleProjects stays empty", async () => {
    const off = buildEffectiveConfig(
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildEffectiveConfig(
      configSchema.parse({ levels: { code: true } }),
    );

    const projects = await discoverApplications(tmpRoot, off);

    const first = await runScanAll({
      rootDir: tmpRoot,
      config: off,
      projects,
    });
    expect(first.staleProjects.length).toBeGreaterThan(0);
    expect(first.modelStaleProjects.length).toBe(first.staleProjects.length);

    const second = await runScanAll({
      rootDir: tmpRoot,
      config: on,
      projects,
    });
    // Every project was re-scanned (L4 now extracted)...
    expect(second.staleProjects.length).toBe(projects.length);
    // ...but the L1–L3 model is still valid for every project.
    expect(second.modelStaleProjects).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: FAIL — `modelStaleProjects` is not on the `runScanAll` return type.

- [ ] **Step 3: Update `runScanAll`**

In `src/core/scan.ts`, change the return type and body of `runScanAll`:

```typescript
export async function runScanAll(options: {
  rootDir: string;
  config: Config;
  projects: DiscoveredProject[];
  getProjectConfig?: (projectAbsPath: string) => Config;
  force?: boolean;
  verbose?: boolean;
}): Promise<{
  rawStructure: RawStructure;
  projectResults: ProjectScanResult[];
  staleProjects: DiscoveredProject[];
  modelStaleProjects: DiscoveredProject[];
}> {
  const { rootDir, config, projects, getProjectConfig, force, verbose } =
    options;
  const projectResults: ProjectScanResult[] = [];
  const staleProjects: DiscoveredProject[] = [];
  const modelStaleProjects: DiscoveredProject[] = [];

  for (const project of projects) {
    console.error(`Scanning: ${project.path} (${project.type})`);
    const projectAbsPath = path.resolve(rootDir, project.path);
    const projectConfig = getProjectConfig
      ? getProjectConfig(projectAbsPath)
      : config;
    const result = await runProjectScan({
      rootDir,
      project,
      config: projectConfig,
      force,
      verbose,
    });

    if (result.fromCache) {
      console.error(`  Cached (unchanged)`);
    } else if (result.modelStale) {
      console.error(`  Scanned`);
      staleProjects.push(project);
    } else {
      console.error(`  Re-scanned (L4 only, model cache reused)`);
      staleProjects.push(project);
    }

    if (result.modelStale) {
      modelStaleProjects.push(project);
    }

    projectResults.push(result);
  }

  // ... keep existing post-processing (matchCrossAppCoordinates,
  // applyConfigFiltering, applyConfigExtraction, combinedChecksum, return) ...

  const allApplications = projectResults.flatMap((r) => r.scan.applications);
  matchCrossAppCoordinates(allApplications);

  const filterResults = applyConfigFiltering(allApplications);
  if (verbose) {
    for (const [, filterResult] of filterResults) {
      for (const file of filterResult.kept) {
        const count = filterResult.signals.filter(
          (s) => s.filePath === file.path,
        ).length;
        console.error(`  Kept: ${file.path} (${count} signals)`);
      }
      for (const droppedPath of filterResult.dropped) {
        console.error(`  Filtered: ${droppedPath} (0 signals)`);
      }
    }
  }

  const extractionResults = applyConfigExtraction(allApplications);
  if (verbose) {
    for (const [, appResults] of extractionResults) {
      for (const r of appResults) {
        console.error(
          `  Extracted: ${r.filePath} (${r.originalLineCount} → ${r.extractedSignalCount} lines)`,
        );
      }
    }
  }

  const combinedChecksum = allApplications
    .map((a) => a.id)
    .sort()
    .join(",");

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: `combined:${combinedChecksum}`,
    applications: allApplications,
  };

  return { rawStructure, projectResults, staleProjects, modelStaleProjects };
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/scan.ts tests/core/per-project-cache.test.ts
git commit -m "feat(scan): expose modelStaleProjects from runScanAll"
```

---

## Task 6: `resolveModel` uses `modelStaleProjects`

**Files:**

- Modify: `src/cli/commands/generate.ts` (`resolveModel`, lines 311–484)
- Test: new file `tests/integration/levels-code-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/levels-code-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runScanAll } from "../../src/core/scan.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";

const MONOREPO_ROOT = path.resolve(__dirname, "../fixtures/monorepo");

describe("levels.code toggle preserves L1-L3 model cache", () => {
  const tmpRoot = path.join(os.tmpdir(), `dd-l4-toggle-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("a prior run with levels.code=false followed by levels.code=true yields no modelStaleProjects", async () => {
    const off = buildEffectiveConfig(
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildEffectiveConfig(
      configSchema.parse({ levels: { code: true } }),
    );

    const projects = await discoverApplications(tmpRoot, off);
    await runScanAll({ rootDir: tmpRoot, config: off, projects });

    const second = await runScanAll({
      rootDir: tmpRoot,
      config: on,
      projects,
    });

    expect(second.modelStaleProjects).toEqual([]);
    // And at least one project re-scanned (otherwise the test is trivially true)
    expect(second.staleProjects.length).toBeGreaterThan(0);
  });
});
```

> Rationale: the `resolveModel` flow reads cleaner as a direct unit test on `runScanAll` (the place where the structural signal is produced). Once that's right, the one-line change in `resolveModel` falls out trivially.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run tests/integration/levels-code-cache.test.ts`
Expected: PASS if Task 5 was implemented correctly (this test duplicates the Task 5 assertion at integration level — it should already pass). If it fails, fix Task 5 before continuing.

Then verify the behavior at the `resolveModel` layer by running the broader generate test suite:

```bash
npx vitest run tests/cli/generate-deletion.test.ts tests/integration/code-level.test.ts
```

Expected: PASS unchanged.

- [ ] **Step 3: Wire `modelStaleProjects` through `resolveModel`**

In `src/cli/commands/generate.ts`, replace the three usages of `staleContainers` inside `resolveModel` so they derive from `modelStaleProjects`:

At line 348 (destructuring the `runScanAll` result):

```typescript
const { rawStructure, projectResults, modelStaleProjects } = await runScanAll({
  rootDir: configDir,
  config: effectiveConfig,
  projects: discovered,
  getProjectConfig,
});
```

At line 355, replace:

```typescript
const staleContainers = staleProjects.filter((p) => p.type === "container");
```

with:

```typescript
const staleContainers = modelStaleProjects.filter(
  (p) => p.type === "container",
);
```

Everything downstream (`staleContainers.length === 0` at line 360, the log at line 383, the manifestV2 synthesis timestamp at line 466) now correctly reflects structural staleness rather than any-cache-miss.

No other changes in this task. The per-container cache reading at lines 394–405 continues to use `result.fromCache` — that's correct, because a re-scanned project does have a fresh `scan.json` and we don't want to reuse its model fragment as-is (it may be stale even if the container-level structure is not; safer to let the model-builder rederive it from the fresh scan).

Wait — re-examine. If `modelStale === false` but `fromCache === false`, we _do_ want to reuse the cached model fragment. The fragment is per-container and depends on the same structural-fingerprint. Update lines 394–405:

```typescript
for (const result of projectResults) {
  if (result.project.type !== "container") continue;
  // Reuse the cached model fragment whenever the L1–L3 model is NOT stale —
  // covers both full cache hits and L4-only re-scans.
  if (!result.modelStale) {
    const cache = readProjectCache(
      path.resolve(configDir, result.project.path),
    );
    if (cache?.model) {
      const appId = result.scan.applications[0]?.id;
      if (appId) cachedModels.set(appId, cache.model);
    }
  }
}
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

Then smoke-test the end-to-end flow manually:

```bash
# In a scratch copy of the fixture monorepo:
rm -rf /tmp/dd-smoke && cp -r tests/fixtures/monorepo /tmp/dd-smoke
cd /tmp/dd-smoke

# First run with L4 off (or whatever default) — builds model deterministically
node <repo>/dist/cli.js generate --deterministic

# Capture mtime of the combined model
stat -f "%m" architecture-model.yaml

# Flip levels.code to true in diagram-docs.yaml, re-run
node <repo>/dist/cli.js generate --deterministic

# mtime changes (model file rewritten with codeElements attached) but the
# CLI log shows "all containers cached" rather than "N containers changed".
```

Expected: the second log shows `"Using model: ... (all containers cached)"` and `codeElements` now appear in `architecture-model.yaml`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/generate.ts tests/integration/levels-code-cache.test.ts
git commit -m "fix(generate): skip model rebuild on L4-only config changes"
```

---

## Task 7: Tripwire test — every config key is explicitly classified

**Files:**

- Create: `tests/config/fingerprint-coverage.test.ts`
- Modify: `src/core/scan.ts` (export the key-classification allowlists so the test can import them)

- [ ] **Step 1: Expose classification allowlists**

In `src/core/scan.ts`, above `buildScanFingerprint`, add:

```typescript
/**
 * Every top-level config key MUST appear in exactly one of these sets. New
 * keys fail the tripwire in tests/config/fingerprint-coverage.test.ts until
 * classified. This prevents silent cache-bypass bugs like the one that
 * motivated the scan/model fingerprint split.
 *
 * - SCAN_FINGERPRINT_KEYS: keys that affect scan output (must also appear
 *   in MODEL_FINGERPRINT_KEYS unless they're L4-only).
 * - MODEL_FINGERPRINT_KEYS: keys that affect L1-L3 model output.
 * - IGNORED_FINGERPRINT_KEYS: keys that don't affect either (rendering,
 *   LLM provider selection, etc.).
 */
export const SCAN_FINGERPRINT_KEYS = [
  "exclude",
  "abstraction",
  "levels",
  "code",
] as const;
export const MODEL_FINGERPRINT_KEYS = ["exclude", "abstraction"] as const;
export const IGNORED_FINGERPRINT_KEYS = [
  "system",
  "type",
  "scan", // include/forceInclude handled via buildScanFingerprint's includeScanInclude option
  "output",
  "externalSystems",
  "llm",
  "submodules",
  "override",
] as const;
```

> Adjust the last list after running the tripwire — it's seeded from a read of `src/config/schema.ts`. Any key missing from all three sets will fail the test; add it to the correct bucket.

Also refactor `buildScanFingerprint` and `buildModelFingerprint` to derive their body from these constants where practical (optional cleanup; not required for the test).

- [ ] **Step 2: Write the failing test**

Create `tests/config/fingerprint-coverage.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import {
  SCAN_FINGERPRINT_KEYS,
  MODEL_FINGERPRINT_KEYS,
  IGNORED_FINGERPRINT_KEYS,
} from "../../src/core/scan.js";

describe("fingerprint coverage tripwire", () => {
  it("every top-level config key is classified", () => {
    const schema = configSchema;
    // zod .shape gives us the top-level keys
    const allKeys = Object.keys(schema._def.schema?.shape ?? schema.shape);
    const classified = new Set<string>([
      ...SCAN_FINGERPRINT_KEYS,
      ...IGNORED_FINGERPRINT_KEYS,
    ]);
    const unclassified = allKeys.filter((k) => !classified.has(k));

    if (unclassified.length > 0) {
      throw new Error(
        `Unclassified config key(s): ${unclassified.join(", ")}. ` +
          "Add each to SCAN_FINGERPRINT_KEYS, MODEL_FINGERPRINT_KEYS, or " +
          "IGNORED_FINGERPRINT_KEYS in src/core/scan.ts. " +
          "Picking the wrong bucket causes silent cache-bypass bugs.",
      );
    }

    expect(unclassified).toEqual([]);
  });

  it("MODEL_FINGERPRINT_KEYS is a subset of SCAN_FINGERPRINT_KEYS", () => {
    const scanSet = new Set<string>(SCAN_FINGERPRINT_KEYS);
    for (const k of MODEL_FINGERPRINT_KEYS) {
      expect(scanSet.has(k)).toBe(true);
    }
  });
});
```

> Note: zod schema key extraction varies by version. If `schema._def.schema?.shape` is undefined on the installed zod, use `(schema as any)._def.schema?.shape ?? (schema as any).shape` or `schema.keyof().options` — whatever the test environment exposes. Iterate on the key-access expression until `allKeys` actually contains `["system", "type", "scan", "levels", "code", "abstraction", ...]`.

- [ ] **Step 3: Run the test and fix any unclassified keys**

Run: `npx vitest run tests/config/fingerprint-coverage.test.ts`
Expected: Initially PASS if `IGNORED_FINGERPRINT_KEYS` above is complete. If it fails, add the missing keys to the right bucket (probably `IGNORED_FINGERPRINT_KEYS` for anything rendering/LLM/output-related; `MODEL_FINGERPRINT_KEYS` if it truly affects L1–L3 structure).

- [ ] **Step 4: Run the full test suite once more**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/scan.ts tests/config/fingerprint-coverage.test.ts
git commit -m "test: tripwire for unclassified config keys in fingerprints"
```

---

## Self-Review Checklist

- **Spec coverage**
  - "Flip `levels.code` without source change must not invoke LLM" → Task 4 (unit), Task 5 (runScanAll aggregation), Task 6 (resolveModel wiring), Task 6 manual smoke.
  - "Structural config changes (exclude, abstraction) still rebuild the model" → Task 4 third test case.
  - "Backwards compatibility with existing caches" → Task 3 explicitly invalidates legacy `checksum`-only caches (safe because it forces one full re-scan on upgrade).
  - "Future-proofing against new config keys" → Task 7 tripwire.
- **Placeholders** — none; every step has either concrete code or a concrete command with expected output. The only "adjust to your zod version" caveat is in Task 7 where the key-extraction API is version-dependent; the plan tells the engineer how to iterate.
- **Type consistency** — `ProjectScanResult` gains `modelStale: boolean` (Task 4), consumed by `runScanAll` (Task 5), consumed by `resolveModel` via `modelStaleProjects` (Task 6). Names are consistent across tasks.
