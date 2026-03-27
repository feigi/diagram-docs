# Per-Container Scanning & Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make diagram-docs cache and re-model per container so unchanged containers skip LLM calls, and support running from within a container directory with cascading config and library/container classification.

**Architecture:** Discovery gains a classification step (library vs container). Each project gets its own `.diagram-docs/` with per-project checksum, scan, and model cache. Config cascades from root to container. The generate pipeline assembles per-container model fragments, skipping LLM for cached containers.

**Tech Stack:** TypeScript, Zod, vitest, Node.js fs/path/crypto

---

## File Structure

**Create:**

- `src/core/classify.ts` — Project classification logic (library vs container)
- `src/core/cascading-config.ts` — Config resolution walking directory tree
- `src/core/per-project-cache.ts` — Per-project checksum, read/write cache
- `tests/core/classify.test.ts` — Classification unit tests
- `tests/core/cascading-config.test.ts` — Config cascade unit tests
- `tests/core/per-project-cache.test.ts` — Per-project cache unit tests
- `tests/fixtures/monorepo/services/api-gateway/diagram-docs.yaml` — Fixture for cascading config test

**Modify:**

- `src/analyzers/types.ts` — Add `DiscoveredProject` type, add `tags` to external system type
- `src/core/discovery.ts` — Return `DiscoveredProject[]` with classification
- `src/config/schema.ts` — Add `type` field to config schema
- `src/core/manifest.ts` — New v2 root manifest with project inventory
- `src/core/checksum.ts` — Per-project checksum function
- `src/core/scan.ts` — Per-project scan + `runScanAll()` orchestrator
- `src/core/model-builder.ts` — Inject library-as-external-system logic
- `src/core/parallel-model-builder.ts` — Accept pre-split results, skip cached containers
- `src/generator/d2/container.ts` — Render libraries with distinct style
- `src/cli/commands/scan.ts` — Root vs container dir behavior
- `src/cli/commands/generate.ts` — Assemble from per-container fragments

---

### Task 1: Add `type` field to types and config schema

**Files:**

- Modify: `src/analyzers/types.ts:6-11`
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Add `DiscoveredProject` type to `types.ts`**

In `src/analyzers/types.ts`, add after the existing imports and before `RawStructure`:

```typescript
export type ProjectType = "container" | "library";

export interface DiscoveredProject {
  path: string;
  buildFile: string;
  language: string;
  analyzerId: string;
  type: ProjectType;
}
```

Keep the existing `DiscoveredApp` type alias for backwards compatibility in `discovery.ts` (we'll migrate it in Task 3).

Also add `tags` to the external system shape in `ArchitectureModel`:

Find the `externalSystems` array item type and add `tags`:

```typescript
externalSystems: Array<{
  id: string;
  name: string;
  description: string;
  technology?: string;
  tags?: string[];
}>;
```

- [ ] **Step 2: Add `type` to config schema**

In `src/config/schema.ts`, add a top-level `type` field to the schema (after the `system` field):

```typescript
type: z.enum(["container", "library"]).optional(),
```

This is optional — when absent, classification is inferred from build files.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (new fields are optional, no existing code breaks)

- [ ] **Step 4: Commit**

```bash
git add src/analyzers/types.ts src/config/schema.ts
git commit -m "feat: add ProjectType, DiscoveredProject, and config type field"
```

---

### Task 2: Project classification logic

**Files:**

- Create: `src/core/classify.ts`
- Create: `tests/core/classify.test.ts`

- [ ] **Step 1: Write failing tests for classification**

Create `tests/core/classify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyProject } from "../../src/core/classify.js";
import type { DiscoveredApp } from "../../src/core/discovery.js";

describe("classifyProject", () => {
  describe("C projects", () => {
    it("classifies CMakeLists with add_library as library", () => {
      const result = classifyProject(
        {
          path: "libs/mathlib",
          buildFile: "CMakeLists.txt",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-library",
      );
      expect(result).toBe("library");
    });

    it("classifies CMakeLists with add_executable as container", () => {
      const result = classifyProject(
        {
          path: "services/daemon",
          buildFile: "CMakeLists.txt",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-executable",
      );
      expect(result).toBe("container");
    });
  });

  describe("Java projects", () => {
    it("classifies pom.xml with jar packaging and no main class as library", () => {
      const result = classifyProject(
        {
          path: "libs/common",
          buildFile: "pom.xml",
          language: "java",
          analyzerId: "java",
        },
        "tests/fixtures/classify/java-library",
      );
      expect(result).toBe("library");
    });

    it("classifies pom.xml with spring-boot-maven-plugin as container", () => {
      const result = classifyProject(
        {
          path: "services/api",
          buildFile: "pom.xml",
          language: "java",
          analyzerId: "java",
        },
        "tests/fixtures/classify/java-spring",
      );
      expect(result).toBe("container");
    });

    it("classifies pom.xml with war packaging as container", () => {
      const result = classifyProject(
        {
          path: "services/web",
          buildFile: "pom.xml",
          language: "java",
          analyzerId: "java",
        },
        "tests/fixtures/classify/java-war",
      );
      expect(result).toBe("container");
    });
  });

  describe("TypeScript projects", () => {
    it("classifies package.json without bin/main/server scripts as library", () => {
      const result = classifyProject(
        {
          path: "libs/utils",
          buildFile: "package.json",
          language: "typescript",
          analyzerId: "typescript",
        },
        "tests/fixtures/classify/ts-library",
      );
      expect(result).toBe("library");
    });

    it("classifies package.json with bin field as container", () => {
      const result = classifyProject(
        {
          path: "services/cli",
          buildFile: "package.json",
          language: "typescript",
          analyzerId: "typescript",
        },
        "tests/fixtures/classify/ts-bin",
      );
      expect(result).toBe("container");
    });

    it("classifies package.json with start script as container", () => {
      const result = classifyProject(
        {
          path: "services/api",
          buildFile: "package.json",
          language: "typescript",
          analyzerId: "typescript",
        },
        "tests/fixtures/classify/ts-server",
      );
      expect(result).toBe("container");
    });
  });

  describe("Python projects", () => {
    it("classifies project without __main__.py or app.py as library", () => {
      const result = classifyProject(
        {
          path: "libs/pyutils",
          buildFile: "setup.py",
          language: "python",
          analyzerId: "python",
        },
        "tests/fixtures/classify/python-library",
      );
      expect(result).toBe("library");
    });

    it("classifies project with __main__.py as container", () => {
      const result = classifyProject(
        {
          path: "services/worker",
          buildFile: "setup.py",
          language: "python",
          analyzerId: "python",
        },
        "tests/fixtures/classify/python-main",
      );
      expect(result).toBe("container");
    });
  });

  describe("config override", () => {
    it("config type overrides inference", () => {
      const result = classifyProject(
        {
          path: "libs/mathlib",
          buildFile: "CMakeLists.txt",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-library",
        "container", // config override
      );
      expect(result).toBe("container");
    });
  });

  describe("defaults", () => {
    it("defaults to container when inference is ambiguous", () => {
      const result = classifyProject(
        {
          path: "apps/unknown",
          buildFile: "Makefile",
          language: "c",
          analyzerId: "c",
        },
        "tests/fixtures/classify/c-ambiguous",
      );
      expect(result).toBe("container");
    });
  });
});
```

- [ ] **Step 2: Create test fixtures for classification**

Create minimal fixture directories. Each needs just the build file:

`tests/fixtures/classify/c-library/CMakeLists.txt`:

```cmake
add_library(mathlib STATIC src/math.c)
```

`tests/fixtures/classify/c-executable/CMakeLists.txt`:

```cmake
add_executable(daemon src/main.c)
```

`tests/fixtures/classify/c-ambiguous/Makefile`:

```makefile
all: build
```

`tests/fixtures/classify/java-library/pom.xml`:

```xml
<project>
  <packaging>jar</packaging>
  <dependencies/>
</project>
```

`tests/fixtures/classify/java-spring/pom.xml`:

```xml
<project>
  <packaging>jar</packaging>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
```

`tests/fixtures/classify/java-war/pom.xml`:

```xml
<project>
  <packaging>war</packaging>
</project>
```

`tests/fixtures/classify/ts-library/package.json`:

```json
{
  "name": "@monorepo/utils",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  }
}
```

`tests/fixtures/classify/ts-bin/package.json`:

```json
{
  "name": "@monorepo/cli",
  "version": "1.0.0",
  "bin": { "my-cli": "./dist/index.js" }
}
```

`tests/fixtures/classify/ts-server/package.json`:

```json
{
  "name": "@monorepo/api",
  "version": "1.0.0",
  "scripts": {
    "start": "node dist/server.js",
    "dev": "tsx src/server.ts"
  }
}
```

`tests/fixtures/classify/python-library/setup.py`:

```python
from setuptools import setup
setup(name="pyutils", packages=["pyutils"])
```

`tests/fixtures/classify/python-main/__main__.py`:

```python
print("hello")
```

`tests/fixtures/classify/python-main/setup.py`:

```python
from setuptools import setup
setup(name="worker", packages=["worker"])
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/core/classify.test.ts`
Expected: FAIL — `classifyProject` does not exist

- [ ] **Step 4: Implement classification**

Create `src/core/classify.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectType } from "../analyzers/types.js";
import type { DiscoveredApp } from "./discovery.js";

/**
 * Classify a discovered project as container or library by inspecting
 * its build file. An explicit config override takes precedence.
 */
export function classifyProject(
  app: DiscoveredApp,
  appAbsPath: string,
  configOverride?: ProjectType,
): ProjectType {
  if (configOverride) return configOverride;

  switch (app.language) {
    case "c":
      return classifyC(appAbsPath, app.buildFile);
    case "java":
      return classifyJava(appAbsPath, app.buildFile);
    case "typescript":
      return classifyTypeScript(appAbsPath, app.buildFile);
    case "python":
      return classifyPython(appAbsPath);
    default:
      return "container";
  }
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function classifyC(appAbsPath: string, buildFile: string): ProjectType {
  if (buildFile !== "CMakeLists.txt") return "container";

  const content = readFileIfExists(path.join(appAbsPath, buildFile));
  if (!content) return "container";

  if (/add_library\s*\(/i.test(content)) return "library";
  if (/add_executable\s*\(/i.test(content)) return "container";
  return "container";
}

function classifyJava(appAbsPath: string, buildFile: string): ProjectType {
  const content = readFileIfExists(path.join(appAbsPath, buildFile));
  if (!content) return "container";

  // WAR packaging → container
  if (/<packaging>\s*war\s*<\/packaging>/i.test(content)) return "container";

  // Spring Boot plugin → container
  if (/spring-boot-maven-plugin/i.test(content)) return "container";

  // application plugin (Gradle) → container
  if (/application\s*\{|id\s+['"]application['"]/i.test(content))
    return "container";

  // jar packaging with no container signals → library
  if (/<packaging>\s*jar\s*<\/packaging>/i.test(content)) return "library";

  return "container";
}

function classifyTypeScript(
  appAbsPath: string,
  buildFile: string,
): ProjectType {
  if (buildFile !== "package.json") return "container";

  const content = readFileIfExists(path.join(appAbsPath, buildFile));
  if (!content) return "container";

  let pkg: { bin?: unknown; main?: string; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(content);
  } catch {
    return "container";
  }

  if (pkg.bin) return "container";

  // Check for server-like scripts
  const scripts = pkg.scripts ?? {};
  const serverScripts = ["start", "serve", "dev"];
  for (const name of serverScripts) {
    const script = scripts[name];
    if (
      script &&
      /\b(server|app|index|main)\b/i.test(script) &&
      !/\b(vitest|jest|mocha|tsc|eslint|prettier)\b/i.test(script)
    ) {
      return "container";
    }
  }

  return "library";
}

function classifyPython(appAbsPath: string): ProjectType {
  // Check for __main__.py or app.py
  const entrypoints = ["__main__.py", "app.py", "main.py"];
  for (const entry of entrypoints) {
    // Check in root and one level deep
    if (fs.existsSync(path.join(appAbsPath, entry))) return "container";

    // Check subdirectories (e.g., package/__main__.py)
    try {
      const entries = fs.readdirSync(appAbsPath, { withFileTypes: true });
      for (const dir of entries) {
        if (
          dir.isDirectory() &&
          !dir.name.startsWith(".") &&
          !dir.name.startsWith("_")
        ) {
          if (fs.existsSync(path.join(appAbsPath, dir.name, entry))) {
            return "container";
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Check pyproject.toml for scripts/gui-scripts
  const pyproject = readFileIfExists(path.join(appAbsPath, "pyproject.toml"));
  if (pyproject && /\[project\.scripts\]/i.test(pyproject)) return "container";

  // Check setup.cfg for console_scripts
  const setupCfg = readFileIfExists(path.join(appAbsPath, "setup.cfg"));
  if (setupCfg && /console_scripts/i.test(setupCfg)) return "container";

  return "library";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/core/classify.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/classify.ts tests/core/classify.test.ts tests/fixtures/classify/
git commit -m "feat: add project classification (library vs container)"
```

---

### Task 3: Integrate classification into discovery

**Files:**

- Modify: `src/core/discovery.ts`
- Modify: `tests/integration/pipeline.test.ts` (verify no breakage)

- [ ] **Step 1: Update discovery to return `DiscoveredProject[]`**

In `src/core/discovery.ts`, update the imports and types:

```typescript
import * as path from "node:path";
import { glob } from "glob";
import { getRegistry } from "../analyzers/registry.js";
import type { Config } from "../config/schema.js";
import type { ProjectType } from "../analyzers/types.js";
import { classifyProject } from "./classify.js";

/** @deprecated Use DiscoveredProject instead */
export type DiscoveredApp = DiscoveredProject;

export interface DiscoveredProject {
  path: string;
  buildFile: string;
  language: string;
  analyzerId: string;
  type: ProjectType;
}

export interface DiscoveryProgress {
  onSearching: (language: string, pattern: string) => void;
  onFound: (app: DiscoveredProject) => void;
}
```

Update the `discoverApplications` function — add `rootDir` to the parameters so we can resolve absolute paths for classification:

```typescript
export async function discoverApplications(
  rootDir: string,
  config: Config,
  progress?: DiscoveryProgress,
): Promise<DiscoveredProject[]> {
  const registry = getRegistry();
  const discovered: DiscoveredProject[] = [];
  const seenPaths = new Set<string>();

  for (const analyzer of registry) {
    for (const pattern of analyzer.buildFilePatterns) {
      progress?.onSearching(analyzer.id, pattern);
      const includePatterns = config.scan.include.map((inc) =>
        path.join(inc, "**", pattern),
      );

      includePatterns.push(pattern);

      for (const includePattern of includePatterns) {
        const matches = await glob(includePattern, {
          cwd: rootDir,
          ignore: config.scan.exclude,
          nodir: true,
        });

        for (const match of matches) {
          const appDir = path.dirname(match);
          const absAppDir = path.resolve(rootDir, appDir);

          if (seenPaths.has(absAppDir)) continue;
          seenPaths.add(absAppDir);

          const base: Omit<DiscoveredProject, "type"> = {
            path: appDir === "." ? "." : appDir,
            buildFile: path.basename(match),
            language: analyzer.id,
            analyzerId: analyzer.id,
          };

          const type = classifyProject(
            base as DiscoveredApp,
            absAppDir,
            config.type,
          );

          const found: DiscoveredProject = { ...base, type };
          progress?.onFound(found);
          discovered.push(found);
        }
      }
    }
  }

  return discovered.sort((a, b) => a.path.localeCompare(b.path));
}
```

- [ ] **Step 2: Run existing tests to verify no breakage**

Run: `npm test`
Expected: PASS — `DiscoveredApp` is aliased, existing code still works

- [ ] **Step 3: Commit**

```bash
git add src/core/discovery.ts
git commit -m "feat: integrate classification into discovery pipeline"
```

---

### Task 4: Per-project checksum

**Files:**

- Modify: `src/core/checksum.ts`
- Create: `tests/core/per-project-cache.test.ts`

- [ ] **Step 1: Write failing test for per-project checksum**

Create `tests/core/per-project-cache.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeProjectChecksum } from "../../src/core/checksum.js";
import * as path from "node:path";

const MONOREPO_ROOT = path.resolve("tests/fixtures/monorepo");

describe("computeProjectChecksum", () => {
  it("computes checksum for a single project directory", async () => {
    const checksum = await computeProjectChecksum(
      path.join(MONOREPO_ROOT, "services/api-gateway"),
      [],
    );
    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces different checksums for different projects", async () => {
    const checksumA = await computeProjectChecksum(
      path.join(MONOREPO_ROOT, "services/api-gateway"),
      [],
    );
    const checksumB = await computeProjectChecksum(
      path.join(MONOREPO_ROOT, "libs/mathlib"),
      [],
    );
    expect(checksumA).not.toBe(checksumB);
  });

  it("includes config fingerprint in checksum", async () => {
    const base = path.join(MONOREPO_ROOT, "services/api-gateway");
    const without = await computeProjectChecksum(base, []);
    const with_ = await computeProjectChecksum(base, [], "fingerprint-a");
    expect(without).not.toBe(with_);
  });

  it("is deterministic", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const a = await computeProjectChecksum(dir, []);
    const b = await computeProjectChecksum(dir, []);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: FAIL — `computeProjectChecksum` does not exist

- [ ] **Step 3: Add `computeProjectChecksum` to `checksum.ts`**

Add to the end of `src/core/checksum.ts`:

```typescript
/**
 * Compute a checksum for a single project directory.
 * Hashes all source files within the directory, in sorted order.
 */
export async function computeProjectChecksum(
  projectDir: string,
  exclude: string[],
  configFingerprint?: string,
): Promise<string> {
  const hash = crypto.createHash("sha256");

  if (configFingerprint) {
    hash.update(configFingerprint);
  }

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/checksum.ts tests/core/per-project-cache.test.ts
git commit -m "feat: add per-project checksum computation"
```

---

### Task 5: Per-project cache read/write

**Files:**

- Create: `src/core/per-project-cache.ts`
- Modify: `tests/core/per-project-cache.test.ts`

- [ ] **Step 1: Write failing tests for cache read/write**

Add to `tests/core/per-project-cache.test.ts`:

```typescript
import {
  readProjectCache,
  writeProjectScan,
  writeProjectModel,
  isProjectStale,
} from "../../src/core/per-project-cache.js";
import * as fs from "node:fs";
import * as os from "node:os";

describe("per-project cache", () => {
  const tmpDir = path.join(os.tmpdir(), `diagram-docs-test-${Date.now()}`);
  const projectDir = path.join(tmpDir, "my-service");
  const cacheDir = path.join(projectDir, ".diagram-docs");

  beforeEach(() => {
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no cache exists", () => {
    const cache = readProjectCache(projectDir);
    expect(cache).toBeNull();
  });

  it("writes and reads scan cache", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:abc",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:abc");

    const cache = readProjectCache(projectDir);
    expect(cache).not.toBeNull();
    expect(cache!.checksum).toBe("sha256:abc");
    expect(cache!.scan).toEqual(scan);
    expect(cache!.model).toBeNull();
  });

  it("writes and reads model cache", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:abc",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:abc");

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

  it("detects stale project when checksum changes", () => {
    writeProjectScan(
      projectDir,
      {
        version: 1 as const,
        scannedAt: "2026-01-01T00:00:00Z",
        checksum: "sha256:old",
        applications: [],
      },
      "sha256:old",
    );

    expect(isProjectStale(projectDir, "sha256:old")).toBe(false);
    expect(isProjectStale(projectDir, "sha256:new")).toBe(true);
  });

  it("detects stale when no cache exists", () => {
    expect(isProjectStale(projectDir, "sha256:any")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement per-project cache**

Create `src/core/per-project-cache.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";

const CACHE_DIR = ".diagram-docs";

export interface ProjectCache {
  checksum: string;
  scan: RawStructure;
  model: ArchitectureModel | null;
}

/**
 * Read cached scan and model for a project.
 * Returns null if no cache exists.
 */
export function readProjectCache(projectDir: string): ProjectCache | null {
  const cacheDir = path.join(projectDir, CACHE_DIR);

  const checksumPath = path.join(cacheDir, "checksum");
  if (!fs.existsSync(checksumPath)) return null;

  const checksum = fs.readFileSync(checksumPath, "utf-8").trim();

  const scanPath = path.join(cacheDir, "scan.json");
  if (!fs.existsSync(scanPath)) return null;

  const scan: RawStructure = JSON.parse(fs.readFileSync(scanPath, "utf-8"));

  const modelPath = path.join(cacheDir, "model.yaml");
  let model: ArchitectureModel | null = null;
  if (fs.existsSync(modelPath)) {
    model = parseYaml(fs.readFileSync(modelPath, "utf-8")) as ArchitectureModel;
  }

  return { checksum, scan, model };
}

/**
 * Write scan output and checksum to the project's cache directory.
 */
export function writeProjectScan(
  projectDir: string,
  scan: RawStructure,
  checksum: string,
): void {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(cacheDir, "scan.json"),
    JSON.stringify(scan, null, 2),
    "utf-8",
  );
  fs.writeFileSync(path.join(cacheDir, "checksum"), checksum, "utf-8");
}

/**
 * Write a per-container model fragment to the project's cache directory.
 */
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

/**
 * Check if a project's cache is stale by comparing checksums.
 */
export function isProjectStale(
  projectDir: string,
  currentChecksum: string,
): boolean {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  const checksumPath = path.join(cacheDir, "checksum");

  if (!fs.existsSync(checksumPath)) return true;

  const cached = fs.readFileSync(checksumPath, "utf-8").trim();
  return cached !== currentChecksum;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/per-project-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/per-project-cache.ts tests/core/per-project-cache.test.ts
git commit -m "feat: add per-project cache read/write"
```

---

### Task 6: Cascading config

**Files:**

- Create: `src/core/cascading-config.ts`
- Create: `tests/core/cascading-config.test.ts`
- Create: `tests/fixtures/monorepo/services/api-gateway/diagram-docs.yaml`

- [ ] **Step 1: Write failing tests**

Create `tests/core/cascading-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../src/core/cascading-config.js";
import * as path from "node:path";

const MONOREPO = path.resolve("tests/fixtures/monorepo");

describe("resolveConfig", () => {
  it("loads root config when run from root", () => {
    const config = resolveConfig(MONOREPO);
    expect(config.system.name).toBe("Test Monorepo");
  });

  it("merges container config with root config", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    // Container config should override specific fields
    expect(config.levels.component).toBe(false);
    // Root config fields should be inherited
    expect(config.levels.context).toBe(true);
  });

  it("scalars: local wins", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    expect(config.abstraction.granularity).toBe("overview");
  });

  it("arrays: local replaces", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    // Container specifies its own exclude, should NOT include root's
    expect(config.scan.exclude).toEqual(["**/generated/**"]);
  });

  it("objects: deep merge", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    // levels.component overridden locally, levels.context inherited from root
    expect(config.levels.component).toBe(false);
    expect(config.levels.context).toBe(true);
    expect(config.levels.container).toBe(true);
  });

  it("returns defaults when no config exists", () => {
    const config = resolveConfig(path.join(MONOREPO, "libs/mathlib"));
    // No local config, uses root config
    expect(config.system.name).toBe("Test Monorepo");
  });

  it("stops walking at .git boundary", () => {
    // The monorepo fixture is inside the repo, so it will find
    // the real repo's .git before escaping. This test just
    // verifies it doesn't throw or walk forever.
    const config = resolveConfig(MONOREPO);
    expect(config).toBeDefined();
  });
});
```

- [ ] **Step 2: Create container-level fixture config**

Create `tests/fixtures/monorepo/services/api-gateway/diagram-docs.yaml`:

```yaml
levels:
  component: false
abstraction:
  granularity: overview
scan:
  exclude:
    - "**/generated/**"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/core/cascading-config.test.ts`
Expected: FAIL — `resolveConfig` does not exist

- [ ] **Step 4: Implement cascading config**

Create `src/core/cascading-config.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema, type Config } from "../config/schema.js";

const CONFIG_FILENAMES = ["diagram-docs.yaml", "diagram-docs.yml"];

/**
 * Resolve config for a directory by walking up the tree, merging
 * closest-parent-wins (like .eslintrc). Stops at .git or filesystem root.
 */
export function resolveConfig(dir: string): Config {
  const configs = collectConfigs(path.resolve(dir));

  if (configs.length === 0) {
    return configSchema.parse({});
  }

  // configs is ordered closest-first. Merge from root down so local wins.
  configs.reverse();

  let merged: Record<string, unknown> = {};
  for (const raw of configs) {
    merged = deepMerge(merged, raw);
  }

  return configSchema.parse(merged);
}

/**
 * Find the root config path by walking up from a directory.
 * Returns null if no config found.
 */
export function findRootConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);

  // Walk up past the start dir to find a parent config
  dir = path.dirname(dir);

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) return candidate;
    }

    // Stop at .git boundary
    if (fs.existsSync(path.join(dir, ".git"))) return null;

    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Collect raw parsed YAML configs from dir upward.
 * Returns closest-first order. Stops at .git or filesystem root.
 */
function collectConfigs(startDir: string): Record<string, unknown>[] {
  const configs: Record<string, unknown>[] = [];
  let dir = startDir;

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf-8");
        const parsed = parseYaml(raw);
        if (parsed && typeof parsed === "object") {
          configs.push(parsed as Record<string, unknown>);
        }
        break; // Only one config per directory
      }
    }

    // Stop at .git boundary
    if (fs.existsSync(path.join(dir, ".git"))) break;

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return configs;
}

/**
 * Deep merge two config objects.
 * - Scalars: override wins
 * - Arrays: override replaces entirely
 * - Objects: recursive merge
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];

    if (Array.isArray(overVal)) {
      // Arrays: override replaces
      result[key] = overVal;
    } else if (
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      // Objects: deep merge
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else {
      // Scalars: override wins
      result[key] = overVal;
    }
  }

  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/core/cascading-config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/cascading-config.ts tests/core/cascading-config.test.ts tests/fixtures/monorepo/services/api-gateway/diagram-docs.yaml
git commit -m "feat: add cascading config resolution"
```

---

### Task 7: Root manifest v2

**Files:**

- Modify: `src/core/manifest.ts`
- Modify: existing manifest tests (if any)

- [ ] **Step 1: Add v2 manifest types to `manifest.ts`**

Add to `src/core/manifest.ts`, keeping existing types for backwards compat:

```typescript
import type { ProjectType } from "../analyzers/types.js";

export interface ManifestV2 {
  version: 2;
  projects: Record<
    string,
    {
      type: ProjectType;
      path: string;
      language: string;
    }
  >;
  synthesis?: {
    timestamp: string;
  };
}

export function readManifestV2(rootDir: string): ManifestV2 | null {
  const mp = manifestPath(rootDir);
  if (!fs.existsSync(mp)) return null;

  const raw = fs.readFileSync(mp, "utf-8");
  const parsed = parseYaml(raw);
  if (parsed?.version === 2) return parsed as ManifestV2;
  return null;
}

export function writeManifestV2(rootDir: string, manifest: ManifestV2): void {
  const dir = path.join(rootDir, MANIFEST_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(manifest, { lineWidth: 120 });
  fs.writeFileSync(manifestPath(rootDir), yaml, "utf-8");
}

export function createDefaultManifestV2(): ManifestV2 {
  return {
    version: 2,
    projects: {},
  };
}
```

- [ ] **Step 2: Run existing tests to verify no breakage**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/manifest.ts
git commit -m "feat: add v2 root manifest with project inventory"
```

---

### Task 8: Per-project scan pipeline

**Files:**

- Modify: `src/core/scan.ts`

- [ ] **Step 1: Add `runProjectScan` function to `scan.ts`**

Add below the existing `runScan` function in `src/core/scan.ts`:

```typescript
import { computeProjectChecksum } from "./checksum.js";
import {
  readProjectCache,
  writeProjectScan,
  isProjectStale,
} from "./per-project-cache.js";
import type { DiscoveredProject } from "./discovery.js";
import type { ProjectType } from "../analyzers/types.js";

export interface ProjectScanResult {
  project: DiscoveredProject;
  scan: RawStructure;
  fromCache: boolean;
}

/**
 * Scan a single project, using per-project cache.
 */
export async function runProjectScan(options: {
  rootDir: string;
  project: DiscoveredProject;
  config: Config;
  force?: boolean;
}): Promise<ProjectScanResult> {
  const { rootDir, project, config, force } = options;
  const projectAbsPath = path.resolve(rootDir, project.path);

  const effectiveExcludes = computeEffectiveExcludes(config, getRegistry());

  const configFingerprint = JSON.stringify({
    exclude: effectiveExcludes,
    abstraction: config.abstraction,
  });

  const checksum = await computeProjectChecksum(
    projectAbsPath,
    effectiveExcludes,
    configFingerprint,
  );

  // Check per-project cache
  if (!force && !isProjectStale(projectAbsPath, checksum)) {
    const cache = readProjectCache(projectAbsPath);
    if (cache) {
      return { project, scan: cache.scan, fromCache: true };
    }
  }

  // Run analyzer
  const analyzer = getAnalyzer(project.analyzerId);
  if (!analyzer) {
    throw new ScanError(`No analyzer found for ${project.analyzerId}`);
  }

  const scanConfig = {
    exclude: effectiveExcludes,
    abstraction: config.abstraction,
  };

  const result = await analyzer.analyze(projectAbsPath, scanConfig);

  // Normalize IDs to relative paths
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

  const scan: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum,
    applications: [result],
  };

  // Write per-project cache
  writeProjectScan(projectAbsPath, scan, checksum);

  return { project, scan, fromCache: false };
}

/**
 * Scan all projects from root, using per-project caching.
 * Returns combined RawStructure + per-project results.
 */
export async function runScanAll(options: {
  rootDir: string;
  config: Config;
  projects: DiscoveredProject[];
  force?: boolean;
}): Promise<{
  rawStructure: RawStructure;
  projectResults: ProjectScanResult[];
  staleProjects: DiscoveredProject[];
}> {
  const { rootDir, config, projects, force } = options;
  const projectResults: ProjectScanResult[] = [];
  const staleProjects: DiscoveredProject[] = [];

  for (const project of projects) {
    console.error(`Scanning: ${project.path} (${project.type})`);
    const result = await runProjectScan({
      rootDir,
      project,
      config,
      force,
    });

    if (result.fromCache) {
      console.error(`  Cached (unchanged)`);
    } else {
      console.error(`  Scanned`);
      staleProjects.push(project);
    }

    projectResults.push(result);
  }

  // Combine into a single RawStructure
  const allApplications = projectResults.flatMap((r) => r.scan.applications);

  // Cross-app coordinate matching
  matchCrossAppCoordinates(allApplications);

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

  return { rawStructure, projectResults, staleProjects };
}
```

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/scan.ts
git commit -m "feat: add per-project scan pipeline with caching"
```

---

### Task 9: Library-as-external-system in model builder

**Files:**

- Modify: `src/core/model-builder.ts`

- [ ] **Step 1: Add library injection to `buildModel`**

In `src/core/model-builder.ts`, add an optional parameter to accept library metadata and inject them as external systems.

Add to the `BuildModelOptions` interface:

```typescript
export interface BuildModelOptions {
  readonly config: Config;
  readonly rawStructure: RawStructure;
  /** Libraries discovered in the project — injected as external systems. */
  readonly libraries?: Array<{
    id: string;
    name: string;
    language: string;
    path: string;
  }>;
}
```

In `buildModel()`, after the existing external systems are built (after the `buildExternalSystems` call), add library injection:

```typescript
// Inject libraries as external systems
if (options.libraries) {
  for (const lib of options.libraries) {
    const libId = slugify(lib.id);
    // Skip if already present (e.g., from config externalSystems)
    if (externalSystems.some((es) => es.id === libId)) continue;

    externalSystems.push({
      id: libId,
      name: humanizeName(lib.name),
      description: `Shared ${lib.language} library`,
      technology: lib.language,
      tags: ["library"],
    });
  }
}
```

Also add relationships from containers that import from libraries. Find the section where `internalImports` are processed and add:

```typescript
// Add relationships from containers to libraries
if (options.libraries) {
  const libraryIds = new Set(options.libraries.map((l) => slugify(l.id)));
  for (const app of rawStructure.applications) {
    for (const imp of app.internalImports) {
      const targetId = slugify(imp.targetApplicationId);
      if (libraryIds.has(targetId)) {
        const key = `${slugify(app.id)}->${targetId}`;
        if (!seenRelKeys.has(key)) {
          seenRelKeys.add(key);
          relationships.push({
            sourceId: slugify(app.id),
            targetId,
            label: "Uses",
            technology: undefined,
          });
        }
      }
    }
  }
}
```

- [ ] **Step 2: Run existing tests to verify no breakage**

Run: `npm test`
Expected: PASS (libraries param is optional, existing behavior unchanged)

- [ ] **Step 3: Commit**

```bash
git add src/core/model-builder.ts
git commit -m "feat: inject libraries as external systems in model builder"
```

---

### Task 10: Update parallel model builder to skip cached containers

**Files:**

- Modify: `src/core/parallel-model-builder.ts`

- [ ] **Step 1: Add cached model support to `buildModelParallel`**

Add a `cachedModels` option to `ParallelBuildOptions`:

```typescript
export interface ParallelBuildOptions {
  readonly rawStructure: RawStructure;
  readonly config: Config;
  readonly configYaml?: string;
  readonly provider: LLMProvider;
  readonly onStatus?: (status: string) => void;
  readonly onProgress?: (event: ProgressEvent) => void;
  /** Pre-built models for unchanged containers — skips LLM for these. */
  readonly cachedModels?: Map<string, ArchitectureModel>;
}
```

In `buildModelParallel`, after splitting into slices and building anchors, modify the dispatch loop to check `cachedModels`:

Replace the existing `partialPromises` block (around line 500):

```typescript
const cachedModels = options.cachedModels ?? new Map();

const partialPromises = slices.map((slice, i) => {
  const appId = slice.applications[0].id;
  const cached = cachedModels.get(appId);

  if (cached) {
    if (progress) {
      progress.updateApp(appId, "done");
    }
    onStatus?.(`Cached: ${appId}`);
    return Promise.resolve({
      model: cached,
      fellBack: false,
    } as AppBuildResult);
  }

  return buildOneApp(slice, anchors[i], i);
});
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run tests/core/parallel-model-builder.test.ts`
Expected: PASS (cachedModels defaults to empty map, no behavior change)

- [ ] **Step 3: Commit**

```bash
git add src/core/parallel-model-builder.ts
git commit -m "feat: skip LLM for cached containers in parallel builder"
```

---

### Task 11: Library styling in D2 container diagram

**Files:**

- Modify: `src/generator/d2/container.ts`

- [ ] **Step 1: Add library styling to container diagram**

In `src/generator/d2/container.ts`, in the external systems rendering section (around line 136), differentiate libraries from other external systems:

Replace the external systems block:

```typescript
// External systems
for (const ext of sortById(model.externalSystems)) {
  const id = toD2Id(ext.id);
  const tech = ext.technology ? `\\n[${ext.technology}]` : "";
  const isLibrary = ext.tags?.includes("library");
  const label = isLibrary
    ? `${ext.name}\\n\\n[Library]${tech}\\n${wrapText(ext.description)}`
    : `${ext.name}\\n\\n[External System]${tech}\\n${wrapText(ext.description)}`;
  const className = isLibrary ? "library" : "external-system";

  w.shape(id, label, { class: className });
}
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run tests/generator/d2.test.ts`
Expected: PASS (no existing external systems have tags, no behavior change)

- [ ] **Step 3: Commit**

```bash
git add src/generator/d2/container.ts
git commit -m "feat: render libraries with distinct style in C2 diagram"
```

---

### Task 12: Filter libraries from C1 context diagram

**Files:**

- Modify: `src/generator/d2/context.ts`

- [ ] **Step 1: Filter library external systems from context diagram**

In `src/generator/d2/context.ts`, in the external systems rendering section (around line 43), filter out libraries:

```typescript
// External systems (exclude libraries — they're internal to the system)
for (const ext of sortById(
  model.externalSystems.filter((e) => !e.tags?.includes("library")),
)) {
```

Also update the relationship filtering to exclude library endpoints. In the `contextIds` set, exclude library IDs:

```typescript
const libraryIds = new Set(
  model.externalSystems
    .filter((e) => e.tags?.includes("library"))
    .map((e) => e.id),
);

const externalIds = new Set(
  model.externalSystems
    .filter((e) => !e.tags?.includes("library"))
    .map((e) => e.id),
);
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run tests/generator/d2.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/generator/d2/context.ts
git commit -m "feat: filter libraries from C1 context diagram"
```

---

### Task 13: Wire up generate command

**Files:**

- Modify: `src/cli/commands/generate.ts`

- [ ] **Step 1: Update `resolveModel` to use per-project pipeline**

Replace the `resolveModel` function in `src/cli/commands/generate.ts`:

```typescript
import { resolveConfig, findRootConfig } from "../../core/cascading-config.js";
import {
  runScanAll,
  runProjectScan,
  matchCrossAppCoordinates,
} from "../../core/scan.js";
import { discoverApplications } from "../../core/discovery.js";
import {
  readProjectCache,
  writeProjectModel,
} from "../../core/per-project-cache.js";
import {
  readManifestV2,
  writeManifestV2,
  createDefaultManifestV2,
} from "../../core/manifest.js";
import type { DiscoveredProject } from "../../core/discovery.js";

async function resolveModel(
  modelPath: string | undefined,
  configDir: string,
  config: Config,
  deterministic?: boolean,
) {
  // 1. Explicit path provided — trust the user
  if (modelPath) {
    return loadModel(path.resolve(modelPath));
  }

  // 2. Discover and classify projects
  const discovered = await discoverApplications(configDir, config, {
    onSearching: (language, pattern) => {
      console.error(`  Searching: ${language} (${pattern})`);
    },
    onFound: (app) => {
      console.error(`  Found: ${app.path} (${app.type}: ${app.buildFile})`);
    },
  });

  if (discovered.length === 0) {
    console.error("No applications discovered.");
    process.exit(1);
  }

  const containers = discovered.filter((d) => d.type === "container");
  const libraries = discovered.filter((d) => d.type === "library");

  // 3. Per-project scan with caching
  const { rawStructure, projectResults, staleProjects } = await runScanAll({
    rootDir: configDir,
    config,
    projects: discovered,
    force: false,
  });

  const staleContainers = staleProjects.filter((p) => p.type === "container");

  // 4. Check if any container changed — if not, try loading combined model
  const autoModelPath = path.resolve(configDir, "architecture-model.yaml");

  if (staleContainers.length === 0 && fs.existsSync(autoModelPath)) {
    console.error(
      `Using model: ${path.relative(process.cwd(), autoModelPath)} (all containers cached)`,
    );
    return loadModel(autoModelPath);
  }

  if (staleContainers.length > 0) {
    console.error(
      `${staleContainers.length} container(s) changed: ${staleContainers.map((c) => c.path).join(", ")}`,
    );
  }

  // 5. Build model — collect cached models for unchanged containers
  const cachedModels = new Map<
    string,
    import("../../analyzers/types.js").ArchitectureModel
  >();

  for (const result of projectResults) {
    if (result.project.type !== "container") continue;
    if (result.fromCache) {
      const cache = readProjectCache(
        path.resolve(configDir, result.project.path),
      );
      if (cache?.model) {
        cachedModels.set(
          result.scan.applications[0]?.id ?? result.project.path,
          cache.model,
        );
      }
    }
  }

  const libraryMeta = libraries.map((lib) => ({
    id: lib.path,
    name: path.basename(lib.path),
    language: lib.language,
    path: lib.path,
  }));

  // 6. Build model
  const model = await buildModelFromScan(
    rawStructure,
    configDir,
    config,
    deterministic,
    cachedModels,
    libraryMeta,
  );

  // 7. Cache per-container model fragments
  for (const container of containers) {
    const containerId = (await import("../../core/slugify.js")).slugify(
      container.path,
    );
    const containerModel: import("../../analyzers/types.js").ArchitectureModel =
      {
        version: 1,
        system: model.system,
        actors: model.actors.filter((a) =>
          model.relationships.some(
            (r) =>
              (r.sourceId === a.id || r.targetId === a.id) &&
              (r.sourceId === containerId || r.targetId === containerId),
          ),
        ),
        externalSystems: [],
        containers: model.containers.filter((c) => c.id === containerId),
        components: model.components.filter(
          (c) => c.containerId === containerId,
        ),
        relationships: model.relationships.filter(
          (r) =>
            model.components.some(
              (c) =>
                c.containerId === containerId &&
                (c.id === r.sourceId || c.id === r.targetId),
            ) ||
            r.sourceId === containerId ||
            r.targetId === containerId,
        ),
      };

    if (!cachedModels.has(containerId)) {
      writeProjectModel(
        path.resolve(configDir, container.path),
        containerModel,
      );
    }
  }

  // 8. Update root manifest
  const manifestV2 = readManifestV2(configDir) ?? createDefaultManifestV2();
  for (const proj of discovered) {
    const id = (await import("../../core/slugify.js")).slugify(proj.path);
    manifestV2.projects[id] = {
      type: proj.type,
      path: proj.path,
      language: proj.language,
    };
  }
  if (staleContainers.length > 0) {
    manifestV2.synthesis = { timestamp: new Date().toISOString() };
  }
  writeManifestV2(configDir, manifestV2);

  // 9. Persist combined model
  fs.writeFileSync(autoModelPath, serializeModel(model), "utf-8");
  console.error(
    `Model written to ${path.relative(process.cwd(), autoModelPath)}`,
  );

  return model;
}
```

- [ ] **Step 2: Update `buildModelFromScan` to pass cached models and libraries**

Update the signature and body:

```typescript
async function buildModelFromScan(
  rawStructure: import("../../analyzers/types.js").RawStructure,
  configDir: string,
  config: Config,
  deterministic?: boolean,
  cachedModels?: Map<
    string,
    import("../../analyzers/types.js").ArchitectureModel
  >,
  libraries?: Array<{
    id: string;
    name: string;
    language: string;
    path: string;
  }>,
) {
  if (deterministic) {
    console.error("Building model (deterministic)...");
    return buildModel({ config, rawStructure, libraries });
  }

  const configPath = path.resolve(configDir, "diagram-docs.yaml");
  const configYaml = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : undefined;

  try {
    const model = await buildModelWithLLM({
      rawStructure,
      config,
      configYaml,
      cachedModels,
      libraries,
    });
    return model;
  } catch (err) {
    // ... existing error handling unchanged ...
  }
}
```

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/generate.ts
git commit -m "feat: wire up per-container scanning in generate command"
```

---

### Task 14: Update scan CLI for container-dir execution

**Files:**

- Modify: `src/cli/commands/scan.ts`

- [ ] **Step 1: Update scan command to detect root vs container context**

Replace the scan command action in `src/cli/commands/scan.ts`:

```typescript
import { resolveConfig, findRootConfig } from "../../core/cascading-config.js";
import { discoverApplications } from "../../core/discovery.js";
import {
  runScanAll,
  runProjectScan,
  runScan,
  matchCrossAppCoordinates,
} from "../../core/scan.js";

export const scanCommand = new Command("scan")
  .description("Scan source code and produce raw structure")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("-o, --output <path>", "Output file (default: stdout)")
  .option("--force", "Re-scan even if source is unchanged")
  .action(async (options) => {
    const cwd = process.cwd();

    // Determine if we're in a container dir or root
    const rootConfigPath = findRootConfig(cwd);
    const config = resolveConfig(cwd);

    // Check if cwd has a build file (i.e., is a project dir)
    const localDiscovery = await discoverApplications(cwd, config);
    const isProjectDir =
      localDiscovery.length === 1 && localDiscovery[0].path === ".";

    if (isProjectDir) {
      // Container-level scan
      const project = localDiscovery[0];
      console.error(
        `Scanning single project: ${project.language} (${project.type})`,
      );

      const result = await runProjectScan({
        rootDir: cwd,
        project: { ...project, path: "." },
        config,
        force: options.force,
      });

      const json = JSON.stringify(result.scan, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, json, "utf-8");
        console.error(`Written to ${options.output}`);
      } else {
        process.stdout.write(json + "\n");
      }
    } else {
      // Root-level scan — existing behavior using new pipeline
      const discovered = await discoverApplications(cwd, config, {
        onSearching: (language, pattern) => {
          console.error(`  Searching: ${language} (${pattern})`);
        },
        onFound: (app) => {
          console.error(`  Found: ${app.path} (${app.type}: ${app.buildFile})`);
        },
      });

      if (discovered.length === 0) {
        console.error("No applications discovered.");
        process.exit(1);
      }

      const { rawStructure } = await runScanAll({
        rootDir: cwd,
        config,
        projects: discovered,
        force: options.force,
      });

      const json = JSON.stringify(rawStructure, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, json, "utf-8");
        console.error(`Written to ${options.output}`);
      } else {
        process.stdout.write(json + "\n");
      }
    }
  });
```

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/scan.ts
git commit -m "feat: scan command supports container-dir execution"
```

---

### Task 15: Update LLM model builder to pass through cached models and libraries

**Files:**

- Modify: `src/core/llm-model-builder.ts`

- [ ] **Step 1: Add `cachedModels` and `libraries` to `buildModelWithLLM`**

Find the `buildModelWithLLM` function options interface and add:

```typescript
/** Pre-built models for unchanged containers. */
readonly cachedModels?: Map<string, ArchitectureModel>;
/** Libraries to inject as external systems. */
readonly libraries?: Array<{ id: string; name: string; language: string; path: string }>;
```

In the function body, pass these through to `buildModelParallel`:

```typescript
const model = await buildModelParallel({
  rawStructure,
  config,
  configYaml,
  provider,
  cachedModels: options.cachedModels,
  // ... existing options
});
```

And pass `libraries` to the deterministic `buildModel` call for the anchor:

```typescript
const anchor = buildModel({
  config,
  rawStructure,
  libraries: options.libraries,
});
```

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/llm-model-builder.ts
git commit -m "feat: pass cached models and libraries through LLM builder"
```

---

### Task 16: Integration test — per-container caching end-to-end

**Files:**

- Modify: `tests/integration/pipeline.test.ts`

- [ ] **Step 1: Add per-container caching integration test**

Add a new test to `tests/integration/pipeline.test.ts`:

```typescript
import { classifyProject } from "../../src/core/classify.js";
import { computeProjectChecksum } from "../../src/core/checksum.js";
import {
  writeProjectScan,
  readProjectCache,
  isProjectStale,
} from "../../src/core/per-project-cache.js";
import { resolveConfig } from "../../src/core/cascading-config.js";

describe("per-container scanning", () => {
  const monorepoRoot = path.resolve("tests/fixtures/monorepo");

  it("classifies libs/mathlib as library", () => {
    const type = classifyProject(
      {
        path: "libs/mathlib",
        buildFile: "CMakeLists.txt",
        language: "c",
        analyzerId: "c",
      },
      path.join(monorepoRoot, "libs/mathlib"),
    );
    expect(type).toBe("library");
  });

  it("classifies services/api-gateway as container", () => {
    const type = classifyProject(
      {
        path: "services/api-gateway",
        buildFile: "package.json",
        language: "typescript",
        analyzerId: "typescript",
      },
      path.join(monorepoRoot, "services/api-gateway"),
    );
    // api-gateway has a "start" script → container
    expect(type).toBe("container");
  });

  it("computes independent checksums per project", async () => {
    const checksumA = await computeProjectChecksum(
      path.join(monorepoRoot, "services/api-gateway"),
      [],
    );
    const checksumB = await computeProjectChecksum(
      path.join(monorepoRoot, "libs/mathlib"),
      [],
    );
    expect(checksumA).not.toBe(checksumB);
  });

  it("resolves cascading config for container", () => {
    const config = resolveConfig(
      path.join(monorepoRoot, "services/api-gateway"),
    );
    // Has local override
    expect(config.levels.component).toBe(false);
    // Inherits from root
    expect(config.system.name).toBe("Test Monorepo");
  });

  it("discovery returns classified projects", async () => {
    const config = resolveConfig(monorepoRoot);
    const projects = await discoverApplications(monorepoRoot, config);

    const mathlib = projects.find((p) => p.path.includes("mathlib"));
    expect(mathlib?.type).toBe("library");

    const apiGateway = projects.find((p) => p.path.includes("api-gateway"));
    expect(apiGateway?.type).toBe("container");
  });
});
```

- [ ] **Step 2: Verify the api-gateway fixture has a start script**

Check `tests/fixtures/monorepo/services/api-gateway/package.json`. If it doesn't have a `start` script, add one:

```json
{
  "name": "@monorepo/api-gateway",
  "scripts": {
    "start": "node dist/index.js"
  }
}
```

- [ ] **Step 3: Run integration tests**

Run: `npx vitest run tests/integration/pipeline.test.ts`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/pipeline.test.ts tests/fixtures/monorepo/services/api-gateway/package.json
git commit -m "test: add per-container scanning integration tests"
```

---

### Task 17: Update quality ground truth for library classification

**Files:**

- Modify: `tests/quality/fixtures/c-cmake/expected.json`
- Modify: `tests/quality/correctness.test.ts` (if needed)

- [ ] **Step 1: Check current c-cmake ground truth**

Read `tests/quality/fixtures/c-cmake/expected.json` to see if the C fixture uses `add_library`. If it does, the classification test expectations may need updating, but the ground truth should still pass since classification only affects model building, not scan output.

- [ ] **Step 2: Run quality tests**

Run: `npm run test:correctness`
Expected: PASS (scan output format unchanged — classification is a separate concern)

- [ ] **Step 3: Run full suite and verify**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit (if any ground truth changes needed)**

```bash
git add tests/quality/
git commit -m "test: update quality fixtures for library classification"
```

---

### Task 18: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Verify .gitignore covers per-project cache dirs**

Check that `.diagram-docs/` is in `.gitignore`. If not, add it:

```
.diagram-docs/
```

This covers both root and per-project cache directories.

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for per-container scanning"
```
