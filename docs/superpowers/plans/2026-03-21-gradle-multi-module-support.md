# Gradle Multi-Module Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Java analyzer understand Gradle multi-module projects so that subproject directories are excluded from root scans, `project(':...')` and Maven coordinate dependencies produce relationships, and each app reports its published coordinates.

**Architecture:** New `gradle.ts` module handles all Gradle file parsing. The Java analyzer uses it to exclude subproject dirs, populate `internalImports` and `externalDependencies`, and set `publishedAs`. A post-scan pass in `scan.ts` matches Maven coordinates across apps.

**Tech Stack:** TypeScript, vitest, regex-based Gradle parsing

**Spec:** `docs/superpowers/specs/2026-03-21-gradle-multi-module-support-design.md`

---

## File Structure

| File | Role |
|------|------|
| `src/analyzers/java/gradle.ts` | **New** — `parseSettingsGradle()`, `parseGradleDependencies()` |
| `src/analyzers/java/index.ts` | **Modify** — use gradle.ts for subproject exclusion, dep parsing, publishedAs |
| `src/analyzers/types.ts` | **Modify** — add optional `publishedAs` to `ScannedApplication` |
| `src/schemas/raw-structure.schema.json` | **Modify** — add `publishedAs` field |
| `src/cli/commands/scan.ts` | **Modify** — add post-scan cross-app coordinate matching |
| `tests/analyzers/java/gradle.test.ts` | **New** — unit tests for gradle parsing |
| `tests/analyzers/java.test.ts` | **Modify** — add multi-module fixture tests |
| `tests/fixtures/gradle-multimodule/` | **New** — fixture for multi-module Gradle project |
| `tests/integration/pipeline.test.ts` | **Modify** — add cross-app coordinate matching test |

---

### Task 1: Add `publishedAs` to types and schema

**Files:**
- Modify: `src/analyzers/types.ts:12-21`
- Modify: `src/schemas/raw-structure.schema.json:14-72`

- [ ] **Step 1: Add `publishedAs` to `ScannedApplication` type**

In `src/analyzers/types.ts`, add after line 20 (`internalImports`):

```ts
  publishedAs?: string;
```

- [ ] **Step 2: Add `publishedAs` to JSON schema**

In `src/schemas/raw-structure.schema.json`, add inside the application properties object (after the `internalImports` property):

```json
"publishedAs": { "type": "string" }
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: All pass (field is optional, no consumers yet)

- [ ] **Step 4: Commit**

```bash
git add src/analyzers/types.ts src/schemas/raw-structure.schema.json
git commit -m "Add optional publishedAs field to ScannedApplication"
```

---

### Task 2: Create Gradle parsing module with tests (settings.gradle)

**Files:**
- Create: `src/analyzers/java/gradle.ts`
- Create: `tests/analyzers/java/gradle.test.ts`
- Create: `tests/fixtures/gradle-multimodule/` (fixture files)

- [ ] **Step 1: Create the fixture directory and settings.gradle files**

Create `tests/fixtures/gradle-multimodule/settings.gradle`:
```
rootProject.name = 'my-system'
include 'app'
include 'lib'
```

Create `tests/fixtures/gradle-multimodule/with-projectdir/settings.gradle`:
```
rootProject.name = 'my-db'
include('my-db-model')
project(':my-db-model').projectDir = file('model')
```

- [ ] **Step 2: Write failing tests for `parseSettingsGradle`**

Create `tests/analyzers/java/gradle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { parseSettingsGradle } from "../../../src/analyzers/java/gradle.js";

const FIXTURES = path.resolve(__dirname, "../../fixtures/gradle-multimodule");

describe("parseSettingsGradle", () => {
  it("extracts root project name and subprojects", () => {
    const result = parseSettingsGradle(FIXTURES);
    expect(result).not.toBeNull();
    expect(result!.rootProjectName).toBe("my-system");
    expect(result!.subprojects).toEqual([
      { name: "app", dir: "app" },
      { name: "lib", dir: "lib" },
    ]);
  });

  it("handles projectDir overrides", () => {
    const result = parseSettingsGradle(
      path.join(FIXTURES, "with-projectdir"),
    );
    expect(result).not.toBeNull();
    expect(result!.rootProjectName).toBe("my-db");
    expect(result!.subprojects).toEqual([
      { name: "my-db-model", dir: "model" },
    ]);
  });

  it("returns null when no settings file exists", () => {
    const result = parseSettingsGradle("/tmp/nonexistent-dir");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/java/gradle.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `parseSettingsGradle`**

Create `src/analyzers/java/gradle.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";

export interface GradleSettings {
  rootProjectName: string | null;
  subprojects: Array<{ name: string; dir: string }>;
}

export function parseSettingsGradle(appPath: string): GradleSettings | null {
  const settingsFile = findFile(appPath, [
    "settings.gradle",
    "settings.gradle.kts",
  ]);
  if (!settingsFile) return null;

  const content = fs.readFileSync(settingsFile, "utf-8");

  // Extract rootProject.name
  const nameMatch = content.match(
    /rootProject\.name\s*=\s*['"]([^'"]+)['"]/,
  );
  const rootProjectName = nameMatch?.[1] ?? null;

  // Extract include directives: include 'foo', include('foo'), include('foo', 'bar')
  const subprojects: Array<{ name: string; dir: string }> = [];
  for (const match of content.matchAll(
    /include\s*\(?['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])*/g,
  )) {
    // First capture group
    addSubproject(match[1], subprojects);
    // Additional includes in the same call
    if (match[2]) addSubproject(match[2], subprojects);
  }

  // Handle multi-arg include: include('a', 'b', 'c')
  // The regex above only gets first two. Re-scan for all quoted strings in include() calls.
  for (const includeMatch of content.matchAll(
    /include\s*\(([^)]+)\)/g,
  )) {
    const args = includeMatch[1];
    for (const argMatch of args.matchAll(/['"]([^'"]+)['"]/g)) {
      const name = argMatch[1];
      if (!subprojects.some((s) => s.name === name)) {
        addSubproject(name, subprojects);
      }
    }
  }

  // Handle projectDir overrides:
  // project(':foo').projectDir = file('bar')
  for (const match of content.matchAll(
    /project\s*\(\s*['"][:.]?([^'"]+)['"]\s*\)\.projectDir\s*=\s*file\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    const projectName = match[1];
    const dir = match[2];
    const existing = subprojects.find((s) => s.name === projectName);
    if (existing) {
      existing.dir = dir;
    }
  }

  return { rootProjectName, subprojects };
}

function addSubproject(
  name: string,
  subprojects: Array<{ name: string; dir: string }>,
): void {
  // Strip leading colon (Gradle project paths use ':app' notation)
  const clean = name.replace(/^:/, "");
  subprojects.push({ name: clean, dir: clean });
}

function findFile(dir: string, names: string[]): string | null {
  for (const name of names) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/analyzers/java/gradle.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/analyzers/java/gradle.ts tests/analyzers/java/gradle.test.ts tests/fixtures/gradle-multimodule/
git commit -m "Add parseSettingsGradle for Gradle multi-module discovery"
```

---

### Task 3: Add `parseGradleDependencies` with tests

**Files:**
- Modify: `src/analyzers/java/gradle.ts`
- Modify: `tests/analyzers/java/gradle.test.ts`
- Create: `tests/fixtures/gradle-multimodule/app/build.gradle`
- Create: `tests/fixtures/gradle-multimodule/build.gradle`

- [ ] **Step 1: Create fixture build.gradle files**

Create `tests/fixtures/gradle-multimodule/build.gradle`:
```
plugins {
    id 'base'
}

subprojects {
    repositories {
        mavenCentral()
    }
}
```

Create `tests/fixtures/gradle-multimodule/app/build.gradle`:
```
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.5.7'
}

group = 'com.example.myapp'

dependencies {
    implementation project(':lib')
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'com.bmw.losnext:los-chargingdb-model:4.1.4'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

- [ ] **Step 2: Write failing tests for `parseGradleDependencies`**

Add to `tests/analyzers/java/gradle.test.ts`:

```ts
import { parseGradleDependencies } from "../../../src/analyzers/java/gradle.js";

describe("parseGradleDependencies", () => {
  it("extracts group, project deps, and maven deps", () => {
    const buildFile = path.join(FIXTURES, "app", "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(result.group).toBe("com.example.myapp");
    expect(result.projectDeps).toEqual(["lib"]);
    expect(result.mavenDeps).toContainEqual({
      group: "org.springframework.boot",
      artifact: "spring-boot-starter-web",
    });
    expect(result.mavenDeps).toContainEqual({
      group: "com.bmw.losnext",
      artifact: "los-chargingdb-model",
      version: "4.1.4",
    });
  });

  it("returns empty results for shell build files", () => {
    const buildFile = path.join(FIXTURES, "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(result.group).toBeNull();
    expect(result.projectDeps).toEqual([]);
    expect(result.mavenDeps).toEqual([]);
  });

  it("excludes test dependencies", () => {
    const buildFile = path.join(FIXTURES, "app", "build.gradle");
    const result = parseGradleDependencies(buildFile);

    expect(
      result.mavenDeps.some((d) => d.artifact === "spring-boot-starter-test"),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/analyzers/java/gradle.test.ts`
Expected: FAIL — `parseGradleDependencies` not exported

- [ ] **Step 4: Implement `parseGradleDependencies`**

Add to `src/analyzers/java/gradle.ts`:

```ts
export interface GradleDependencies {
  group: string | null;
  projectDeps: string[];
  mavenDeps: Array<{ group: string; artifact: string; version?: string }>;
}

export function parseGradleDependencies(buildFilePath: string): GradleDependencies {
  if (!fs.existsSync(buildFilePath)) {
    return { group: null, projectDeps: [], mavenDeps: [] };
  }

  const content = fs.readFileSync(buildFilePath, "utf-8");

  // Extract group
  const groupMatch = content.match(/^group\s*=\s*['"]([^'"]+)['"]/m);
  const group = groupMatch?.[1] ?? null;

  const projectDeps: string[] = [];
  const mavenDeps: GradleDependencies["mavenDeps"] = [];

  // Match dependency lines: implementation/api/compileOnly project(':name')
  // Exclude test configurations
  // Word-boundary prefix prevents matching testImplementation as implementation
  const implConfigs = "(?:^|\\s)(?:implementation|api|compileOnly|runtimeOnly)";
  const testConfigs = "(?:testImplementation|testCompileOnly|testRuntimeOnly|testAnnotationProcessor)";

  for (const match of content.matchAll(
    new RegExp(`${implConfigs}\\s+project\\s*\\(\\s*['\"][:.]?([^'\"]+)['\"]\\s*\\)`, "g"),
  )) {
    projectDeps.push(match[1].replace(/^:/, ""));
  }

  // Match Maven coordinate deps: implementation 'group:artifact:version'
  // and implementation 'group:artifact' (version managed by BOM)
  for (const match of content.matchAll(
    new RegExp(`${implConfigs}\\s+['"]([^'":]+):([^'":]+)(?::([^'"]+))?['\"]`, "g"),
  )) {
    mavenDeps.push({
      group: match[1],
      artifact: match[2],
      version: match[3] || undefined,
    });
  }

  // Exclude deps from test configurations — scan for those and remove matches
  const testDeps = new Set<string>();
  for (const match of content.matchAll(
    new RegExp(`${testConfigs}\\s+['"]([^'":]+):([^'":]+)(?::([^'"]+))?['\"]`, "g"),
  )) {
    testDeps.add(`${match[1]}:${match[2]}`);
  }
  const filteredMaven = mavenDeps.filter(
    (d) => !testDeps.has(`${d.group}:${d.artifact}`),
  );

  return { group, projectDeps, mavenDeps: filteredMaven };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/analyzers/java/gradle.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/analyzers/java/gradle.ts tests/analyzers/java/gradle.test.ts tests/fixtures/gradle-multimodule/
git commit -m "Add parseGradleDependencies for Gradle dependency extraction"
```

---

### Task 4: Wire gradle.ts into the Java analyzer

**Files:**
- Modify: `src/analyzers/java/index.ts`
- Create: `tests/fixtures/gradle-multimodule/app/src/main/java/com/example/app/App.java`
- Create: `tests/fixtures/gradle-multimodule/lib/build.gradle`
- Create: `tests/fixtures/gradle-multimodule/lib/src/main/java/com/example/lib/Util.java`
- Modify: `tests/analyzers/java.test.ts`

- [ ] **Step 1: Create Java source fixtures for multi-module project**

Create `tests/fixtures/gradle-multimodule/app/src/main/java/com/example/app/App.java`:
```java
package com.example.app;

import com.example.lib.Util;

public class App {
    public String run() {
        return Util.greet("world");
    }
}
```

Create `tests/fixtures/gradle-multimodule/lib/build.gradle`:
```
plugins {
    id 'java-library'
}

group = 'com.example.mylib'
```

Create `tests/fixtures/gradle-multimodule/lib/src/main/java/com/example/lib/Util.java`:
```java
package com.example.lib;

public class Util {
    public static String greet(String name) {
        return "Hello " + name;
    }
}
```

- [ ] **Step 2: Write failing tests for analyzer multi-module behavior**

Add to `tests/analyzers/java.test.ts`:

```ts
const GRADLE_FIXTURES = path.resolve(__dirname, "../fixtures/gradle-multimodule");

describe("Java Analyzer — Gradle multi-module", () => {
  it("excludes subproject directories from root scan", async () => {
    const result = await javaAnalyzer.analyze(GRADLE_FIXTURES, defaultConfig);
    // Root has settings.gradle with include 'app' and 'lib'
    // Root has no src/main/java, so without exclusion it would scan app/ and lib/
    // With exclusion, it should find 0 modules
    expect(result.modules).toHaveLength(0);
  });

  it("parses Gradle dependencies as externalDependencies", async () => {
    const appPath = path.join(GRADLE_FIXTURES, "app");
    const result = await javaAnalyzer.analyze(appPath, defaultConfig);

    expect(
      result.externalDependencies.some((d) =>
        d.name.includes("spring-boot-starter-web"),
      ),
    ).toBe(true);
  });

  it("populates internalImports for project deps", async () => {
    const appPath = path.join(GRADLE_FIXTURES, "app");
    const result = await javaAnalyzer.analyze(appPath, defaultConfig);

    expect(result.internalImports).toHaveLength(1);
    expect(result.internalImports[0].targetPath).toBe("lib");
  });

  it("sets publishedAs from group and artifact name", async () => {
    const appPath = path.join(GRADLE_FIXTURES, "app");
    const result = await javaAnalyzer.analyze(appPath, defaultConfig);

    // app is a subproject of 'my-system', so artifact is 'app'
    // group is 'com.example.myapp'
    expect(result.publishedAs).toBe("com.example.myapp:app");
  });

  it("sets publishedAs using rootProject.name for root projects", async () => {
    const result = await javaAnalyzer.analyze(GRADLE_FIXTURES, defaultConfig);
    // Root project: rootProject.name = 'my-system', no group in root build.gradle
    expect(result.publishedAs).toBeUndefined();
  });

  it("sets publishedAs for lib subproject", async () => {
    const libPath = path.join(GRADLE_FIXTURES, "lib");
    const result = await javaAnalyzer.analyze(libPath, defaultConfig);
    expect(result.publishedAs).toBe("com.example.mylib:lib");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/analyzers/java.test.ts`
Expected: FAIL — analyzer doesn't use gradle.ts yet

- [ ] **Step 4: Implement the analyzer changes**

Modify `src/analyzers/java/index.ts`. Add imports at top:

```ts
import { parseSettingsGradle, parseGradleDependencies } from "./gradle.js";
```

Replace the body of `javaAnalyzer.analyze()` with:

```ts
async analyze(appPath: string, config: ScanConfig): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const appName = path.basename(appPath);

    // Parse Gradle multi-module structure
    const settings = parseSettingsGradle(appPath);
    const subprojectDirs = settings?.subprojects.map((s) => s.dir) ?? [];

    // Exclude subproject directories from this scan
    const excludePatterns = [
      ...config.exclude,
      ...subprojectDirs.map((d) => `${d}/**`),
    ];

    const packages = await extractPackages(appPath, excludePatterns);

    const srcMain = path.join(appPath, "src", "main", "java");
    const searchBase = fs.existsSync(srcMain) ? srcMain : appPath;

    const modules: ScannedModule[] = [];

    for (const pkg of packages) {
      const imports: ModuleImport[] = [];
      const metadata: Record<string, string> = {};
      const allAnnotations: string[] = [];

      for (const file of pkg.files) {
        const fullPath = path.join(searchBase, file);
        const javaImports = parseJavaImports(fullPath);

        for (const imp of javaImports) {
          const pkgPrefix = imp.source.split(".").slice(0, -1).join(".");
          const isInternal = packages.some((p) => p.name === pkgPrefix || imp.source.startsWith(p.name));
          imports.push({
            source: imp.source,
            isExternal: !isInternal,
          });
        }

        const annotations = detectSpringAnnotations(fullPath);
        allAnnotations.push(...annotations);
      }

      if (allAnnotations.length > 0) {
        metadata["spring.stereotypes"] = [...new Set(allAnnotations)].join(",");
      }

      modules.push({
        id: slugify(`${appPath}/${pkg.path}`),
        path: pkg.path,
        name: pkg.name,
        files: pkg.files,
        exports: pkg.publicClasses,
        imports: deduplicateImports(imports),
        metadata,
      });
    }

    // Parse build file dependencies
    const pomPath = path.join(appPath, "pom.xml");
    const gradleBuildFile = findBuildGradle(appPath);

    let externalDependencies: ExternalDep[] = [];
    const internalImports: import("../types.js").InternalImport[] = [];
    let publishedAs: string | undefined;

    if (fs.existsSync(pomPath)) {
      externalDependencies = parsePomDependencies(pomPath);
    } else if (gradleBuildFile) {
      const gradleDeps = parseGradleDependencies(gradleBuildFile);

      // Maven coordinate deps → externalDependencies
      externalDependencies = gradleDeps.mavenDeps.map((d) => ({
        name: `${d.group}:${d.artifact}`,
        version: d.version,
      }));

      // project(':...') deps → internalImports
      for (const projDep of gradleDeps.projectDeps) {
        // Resolve project name to directory using settings from parent
        const parentSettings = parseSettingsGradle(path.dirname(appPath));
        const sub = parentSettings?.subprojects.find((s) => s.name === projDep);
        const targetDir = sub?.dir ?? projDep;

        internalImports.push({
          sourceModuleId: appId,
          targetApplicationId: slugify(
            path.join(path.dirname(appPath), targetDir),
          ),
          targetPath: targetDir,
        });
      }

      // Compute publishedAs
      if (gradleDeps.group) {
        // Determine artifact name: use subproject name if this is a subproject
        const parentSettings = parseSettingsGradle(path.dirname(appPath));
        const artifactName = parentSettings
          ? (parentSettings.subprojects.find(
              (s) => s.dir === path.basename(appPath),
            )?.name ?? appName)
          : (settings?.rootProjectName ?? appName);
        publishedAs = `${gradleDeps.group}:${artifactName}`;
      }
    }

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "java",
      buildFile: fs.existsSync(pomPath)
        ? "pom.xml"
        : gradleBuildFile
          ? path.basename(gradleBuildFile)
          : "build.gradle",
      modules,
      externalDependencies,
      internalImports,
      publishedAs,
    };
  },
```

Add the helper function at the bottom of the file:

```ts
function findBuildGradle(appPath: string): string | null {
  for (const name of ["build.gradle", "build.gradle.kts"]) {
    const p = path.join(appPath, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
```

Also add the missing import at the top:

```ts
import type { InternalImport } from "../types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/analyzers/java.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/analyzers/java/index.ts tests/analyzers/java.test.ts tests/fixtures/gradle-multimodule/
git commit -m "Wire Gradle multi-module support into Java analyzer"
```

---

### Task 5: Post-scan cross-app coordinate matching

**Files:**
- Modify: `src/cli/commands/scan.ts`
- Modify: `tests/integration/pipeline.test.ts`

- [ ] **Step 1: Write failing integration test**

Add to `tests/integration/pipeline.test.ts` a new describe block:

```ts
describe("Integration: Post-scan cross-app coordinate matching", () => {
  it("promotes matching external deps to internalImports", async () => {
    // Simulate two apps: 'consumer' depends on 'com.example:producer'
    // and 'producer' publishes as 'com.example:producer'
    const apps: ScannedApplication[] = [
      {
        id: "producer",
        path: "producer",
        name: "producer",
        language: "java",
        buildFile: "build.gradle",
        modules: [],
        externalDependencies: [],
        internalImports: [],
        publishedAs: "com.example:producer",
      },
      {
        id: "consumer",
        path: "consumer",
        name: "consumer",
        language: "java",
        buildFile: "build.gradle",
        modules: [],
        externalDependencies: [
          { name: "com.example:producer", version: "1.0.0" },
          { name: "org.springframework:spring-web" },
        ],
        internalImports: [],
      },
    ];

    const { matchCrossAppCoordinates } = await import("../../src/cli/commands/scan.js");
    matchCrossAppCoordinates(apps);

    // The matching dep should be promoted
    expect(apps[1].internalImports).toHaveLength(1);
    expect(apps[1].internalImports[0].targetApplicationId).toBe("producer");

    // The matched dep should be removed from externalDependencies
    expect(apps[1].externalDependencies).toHaveLength(1);
    expect(apps[1].externalDependencies[0].name).toBe(
      "org.springframework:spring-web",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pipeline.test.ts`
Expected: FAIL — `matchCrossAppCoordinates` not exported

- [ ] **Step 3: Implement `matchCrossAppCoordinates` in scan.ts**

Add to `src/cli/commands/scan.ts`, before the `scanCommand` definition:

```ts
/**
 * Post-scan pass: match externalDependencies against other apps'
 * publishedAs coordinates. Matches are promoted to internalImports.
 */
export function matchCrossAppCoordinates(
  applications: ScannedApplication[],
): void {
  // Build lookup: "group:artifact" → app ID
  const coordToAppId = new Map<string, string>();
  for (const app of applications) {
    if (app.publishedAs) {
      coordToAppId.set(app.publishedAs, app.id);
    }
  }

  for (const app of applications) {
    const remaining: typeof app.externalDependencies = [];

    for (const dep of app.externalDependencies) {
      // dep.name is "group:artifact" — strip version if present
      const coord = dep.name;
      const targetAppId = coordToAppId.get(coord);

      if (targetAppId && targetAppId !== app.id) {
        app.internalImports.push({
          sourceModuleId: app.id,
          targetApplicationId: targetAppId,
          targetPath: applications.find((a) => a.id === targetAppId)?.path ?? targetAppId,
        });
      } else {
        remaining.push(dep);
      }
    }

    app.externalDependencies = remaining;
  }
}
```

Then in the `scanCommand` action, add normalization of `internalImports` targetApplicationId inside the existing ID normalization loop (after the module import fixups around line 106):

```ts
      // Fix internalImports targetApplicationId: replace absolute-path prefix
      for (const imp of result.internalImports) {
        if (imp.targetApplicationId.startsWith(absolutePrefix)) {
          imp.targetApplicationId =
            relativeId + imp.targetApplicationId.slice(absolutePrefix.length);
        }
        // Also normalize targets that use absolute paths of other apps
        const rootPrefix = slugify(rootDir);
        if (imp.targetApplicationId.startsWith(rootPrefix)) {
          imp.targetApplicationId =
            imp.targetApplicationId.slice(rootPrefix.length + 1); // +1 for the separator
        }
      }
```

And after the analysis loop, before building `rawStructure`, call:

```ts
    // Cross-app coordinate matching
    matchCrossAppCoordinates(applications);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/pipeline.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/scan.ts tests/integration/pipeline.test.ts
git commit -m "Add post-scan cross-app coordinate matching"
```

---

### Task 6: End-to-end verification with charging-triad

This task verifies the full pipeline works on the real project that exposed the issues.

- [ ] **Step 1: Run scan on charging-triad**

```bash
npm run dev -- scan -c /Users/chris/Downloads/charging-triad/diagram-docs.yaml \
  -o /Users/chris/Downloads/charging-triad/raw-structure.json --force
```

Verify:
- `los-cha` root project has 0 modules (subproject dirs excluded)
- `los-chargingdb` root project has 0 modules
- `los-kafka-chargingdb-sink` root project has 0 modules
- `los-cha-app` still has ~89 modules
- `publishedAs` is set on apps with `group` declarations
- Cross-app Maven coordinate matches appear in `internalImports`

- [ ] **Step 2: Run model**

```bash
npm run dev -- model -c /Users/chris/Downloads/charging-triad/diagram-docs.yaml \
  -i /Users/chris/Downloads/charging-triad/raw-structure.json \
  -o /Users/chris/Downloads/charging-triad/architecture-model.yaml
```

Verify:
- Relationships exist between `los-cha-app` → `los-chargingdb-model`
- Relationships exist between `los-kafka-chargingdb-sink-app` → `los-chargingdb-model`

- [ ] **Step 3: Run generate**

```bash
npm run dev -- generate -c /Users/chris/Downloads/charging-triad/diagram-docs.yaml \
  -m /Users/chris/Downloads/charging-triad/architecture-model.yaml
```

Verify: All D2 files validate and render successfully.
