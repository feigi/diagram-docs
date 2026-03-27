# Recursive Diagram Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform diagram-docs from a flat single-system pipeline into a recursive descent engine that classifies folders by C4 role, generates appropriate diagrams at each level (including new Code-level diagrams), and links levels together — with LLM agent assist on by default.

**Architecture:** A new `processFolder` recursive function drives the tool. It collects structural signals per folder, classifies via agent (or heuristic fallback), then runs scan→model→generate scoped to that folder's role. Each level's diagrams link to children via D2 `link` properties and to parents via breadcrumb comments. A new `run` CLI command orchestrates the recursion.

**Tech Stack:** TypeScript, Zod (config), Commander (CLI), D2 (diagrams), Anthropic SDK (agent assist), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-20-recursive-diagram-generation-design.md`

---

## File Structure

### New files

- `src/core/classifier.ts` — Signal collection + heuristic `inferRole` classification
- `src/core/agent-assist.ts` — LLM integration for classification refinement + naming
- `src/core/recursive-runner.ts` — The `processFolder` recursive descent orchestrator
- `src/cli/commands/run.ts` — New `diagram-docs run` CLI command
- `src/analyzers/java/symbols.ts` — Java symbol extraction (classes, interfaces, enums)
- `src/analyzers/python/symbols.ts` — Python symbol extraction (classes, functions)
- `src/analyzers/c/symbols.ts` — C symbol extraction (structs, typedefs, functions)
- `src/generator/d2/code.ts` — Code-level D2 diagram generator
- `src/generator/d2/render.ts` — Extracted D2 rendering utility (shared by `generate` and `run`)
- `tests/core/classifier.test.ts` — Classifier unit tests
- `tests/core/agent-assist.test.ts` — Agent assist contract + cache tests
- `tests/core/recursive-runner.test.ts` — Recursive descent integration tests
- `tests/generator/code.test.ts` — Code diagram generation tests
- `tests/analyzers/java-symbols.test.ts` — Java symbol extraction tests
- `tests/analyzers/python-symbols.test.ts` — Python symbol extraction tests
- `tests/analyzers/c-symbols.test.ts` — C symbol extraction tests

### Modified files

- `src/config/schema.ts` — Replace `levels`/`submodules` with `agent`/`overrides`/`codeLevel`
- `src/analyzers/types.ts` — Add `Symbol`, `SymbolRelationship`, `analyzeModule` to `LanguageAnalyzer`
- `src/cli/index.ts` — Register `run` command
- `src/cli/commands/init.ts` — Update default config template
- `src/generator/d2/styles.ts` — Add `code` class for Code-level diagrams
- `src/generator/d2/container.ts` — Accept child previews for drill-down links
- `src/generator/d2/component.ts` — Accept child previews for drill-down links + breadcrumb
- `src/generator/d2/scaffold.ts` — Role-aware scaffolding (context, container, component, code)

### Removed files

- `src/generator/d2/submodule-scaffold.ts` — Subsumed by recursive descent

---

## Task 1: Config Schema Migration

Update the Zod config schema to replace `levels` and `submodules` with the new recursive model.

**Files:**

- Modify: `src/config/schema.ts:1-72`
- Modify: `src/cli/commands/init.ts:6-36`
- Test: `tests/core/config.test.ts` (new)

- [ ] **Step 1: Write failing test for new config schema**

```ts
// tests/core/config.test.ts
import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema", () => {
  it("parses empty config with defaults", () => {
    const config = configSchema.parse({});
    expect(config.agent.enabled).toBe(true);
    expect(config.output.docsDir).toBe("docs");
    expect(config.abstraction.codeLevel.minSymbols).toBe(2);
    expect(config.overrides).toEqual({});
  });

  it("rejects levels and submodules (removed fields)", () => {
    // Zod .strict() or passthrough — we use passthrough so old configs
    // don't break, but the fields are simply ignored
    const config = configSchema.parse({
      levels: { context: true },
      submodules: { enabled: true },
    });
    // These fields should not appear on the parsed result
    expect((config as Record<string, unknown>).levels).toBeUndefined();
    expect((config as Record<string, unknown>).submodules).toBeUndefined();
  });

  it("parses agent config", () => {
    const config = configSchema.parse({
      agent: { enabled: false, provider: "openai", model: "gpt-4o" },
    });
    expect(config.agent.enabled).toBe(false);
    expect(config.agent.provider).toBe("openai");
    expect(config.agent.model).toBe("gpt-4o");
  });

  it("parses overrides", () => {
    const config = configSchema.parse({
      overrides: {
        "services/order-service": {
          role: "container",
          name: "Order Service",
          description: "Handles orders",
        },
        "libs/utils": { role: "skip" },
      },
    });
    expect(config.overrides["services/order-service"].role).toBe("container");
    expect(config.overrides["libs/utils"].role).toBe("skip");
  });

  it("validates role enum in overrides", () => {
    expect(() =>
      configSchema.parse({
        overrides: { foo: { role: "invalid" } },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/config.test.ts`
Expected: FAIL — `agent`, `overrides`, `codeLevel` don't exist on schema yet

- [ ] **Step 3: Update config schema**

Replace the full content of `src/config/schema.ts`:

```ts
import { z } from "zod";

const roleEnum = z.enum([
  "system",
  "container",
  "component",
  "code-only",
  "skip",
]);

export const configSchema = z
  .object({
    system: z
      .object({
        name: z.string().default("My System"),
        description: z.string().default(""),
      })
      .default({}),

    scan: z
      .object({
        include: z.array(z.string()).default(["**"]),
        exclude: z
          .array(z.string())
          .default([
            "**/test/**",
            "**/tests/**",
            "**/node_modules/**",
            "**/build/**",
            "**/dist/**",
            "**/target/**",
          ]),
      })
      .default({}),

    agent: z
      .object({
        enabled: z.boolean().default(true),
        provider: z.string().default("anthropic"),
        model: z.string().default("claude-sonnet-4-20250514"),
      })
      .default({}),

    abstraction: z
      .object({
        granularity: z
          .enum(["detailed", "balanced", "overview"])
          .default("balanced"),
        excludePatterns: z
          .array(z.string())
          .default(["logging", "metrics", "middleware", "config", "utils"]),
        codeLevel: z
          .object({
            minSymbols: z.number().default(2),
          })
          .default({}),
      })
      .default({}),

    output: z
      .object({
        docsDir: z.string().default("docs"),
        theme: z.number().default(0),
        layout: z.string().default("elk"),
        format: z.enum(["svg", "png"]).default("svg"),
      })
      .default({}),

    overrides: z
      .record(
        z.string(),
        z.object({
          role: roleEnum.optional(),
          name: z.string().optional(),
          description: z.string().optional(),
        }),
      )
      .default({}),
  })
  .strip(); // strip unknown keys like old `levels`/`submodules`

export type Config = z.infer<typeof configSchema>;
export type FolderRole = z.infer<typeof roleEnum>;
```

- [ ] **Step 4: Update init template**

Replace `DEFAULT_CONFIG` in `src/cli/commands/init.ts:6-36`:

```ts
const DEFAULT_CONFIG = {
  system: {
    name: "My System",
    description: "Description for context diagram",
  },
  scan: {
    include: ["**"],
    exclude: [
      "**/test/**",
      "**/tests/**",
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "**/target/**",
    ],
  },
  agent: {
    enabled: true,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
  },
  abstraction: {
    granularity: "balanced",
    excludePatterns: ["logging", "metrics", "middleware", "config", "utils"],
    codeLevel: {
      minSymbols: 2,
    },
  },
  output: {
    docsDir: "docs",
    theme: 0,
    layout: "elk",
    format: "svg",
  },
};
```

- [ ] **Step 5: Fix compilation errors in existing commands**

Update references to removed config fields. In `src/cli/commands/generate.ts`, replace `config.levels.context` / `config.levels.container` / `config.levels.component` with `true` (generate command now always generates all levels it finds in the model — the recursive runner controls which levels get generated per folder). Replace `config.output.dir` with `path.join(config.output.docsDir, "architecture")`. Replace `config.submodules.*` references. This is a compatibility bridge — the `generate` command will be superseded by `run` but should still work standalone.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/core/config.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All existing tests pass (some may need minor fixes for config field changes)

- [ ] **Step 8: Commit**

```bash
git add src/config/schema.ts src/cli/commands/init.ts src/cli/commands/generate.ts tests/core/config.test.ts
git commit -m "feat: migrate config schema — replace levels/submodules with agent/overrides/codeLevel"
```

---

## Task 2: Folder Classifier

Implement signal collection and heuristic classification.

**Files:**

- Create: `src/core/classifier.ts`
- Test: `tests/core/classifier.test.ts`

- [ ] **Step 1: Write failing tests for signal collection and classification**

```ts
// tests/core/classifier.test.ts
import { describe, it, expect } from "vitest";
import { collectSignals, inferRole } from "../../src/core/classifier.js";
import type { FolderSignals } from "../../src/core/classifier.js";

describe("inferRole", () => {
  it("classifies folder with multiple children having build files as system", () => {
    const signals: FolderSignals = {
      buildFiles: [],
      childrenWithBuildFiles: 3,
      infraFiles: ["docker-compose.yml"],
      sourceFileCount: 0,
      sourceLanguages: [],
      hasPackageStructure: false,
      depth: 0,
      childFolderNames: ["order-service", "user-service", "gateway"],
      readmeSnippet: null,
      hasSourceFiles: false,
    };
    expect(inferRole(signals)).toBe("system");
  });

  it("classifies folder with build file and package structure as container", () => {
    const signals: FolderSignals = {
      buildFiles: ["pom.xml"],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 25,
      sourceLanguages: ["java"],
      hasPackageStructure: true,
      depth: 1,
      childFolderNames: ["src", "test"],
      readmeSnippet: null,
      hasSourceFiles: true,
    };
    expect(inferRole(signals)).toBe("container");
  });

  it("classifies folder with build file but no package structure as code-only", () => {
    const signals: FolderSignals = {
      buildFiles: ["pyproject.toml"],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 3,
      sourceLanguages: ["python"],
      hasPackageStructure: false,
      depth: 1,
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: true,
    };
    expect(inferRole(signals)).toBe("code-only");
  });

  it("classifies package directory with source files as component", () => {
    const signals: FolderSignals = {
      buildFiles: [],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 5,
      sourceLanguages: ["python"],
      hasPackageStructure: false,
      depth: 3,
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: true,
      isPackageDir: true,
    };
    expect(inferRole(signals)).toBe("component");
  });

  it("classifies empty folder as skip", () => {
    const signals: FolderSignals = {
      buildFiles: [],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 0,
      sourceLanguages: [],
      hasPackageStructure: false,
      depth: 2,
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: false,
    };
    expect(inferRole(signals)).toBe("skip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/classifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement classifier**

```ts
// src/core/classifier.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import type { FolderRole } from "../config/schema.js";

const BUILD_FILE_PATTERNS = [
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "package.json",
  "CMakeLists.txt",
  "Makefile",
  "Cargo.toml",
  "go.mod",
];

const INFRA_FILE_PATTERNS = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
];

const INFRA_DIR_PATTERNS = ["k8s", "kubernetes", "terraform", ".terraform"];

const SOURCE_EXTENSIONS = new Set([
  ".java",
  ".py",
  ".c",
  ".h",
  ".ts",
  ".js",
  ".go",
  ".rs",
  ".kt",
  ".scala",
  ".cs",
]);

const PACKAGE_MARKERS = ["__init__.py"];

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "target",
  ".diagram-docs",
  "__pycache__",
  ".venv",
  "venv",
]);

export interface FolderSignals {
  buildFiles: string[];
  childrenWithBuildFiles: number;
  infraFiles: string[];
  sourceFileCount: number;
  sourceLanguages: string[];
  hasPackageStructure: boolean;
  hasSourceFiles: boolean;
  isPackageDir?: boolean;
  depth: number;
  childFolderNames: string[];
  readmeSnippet: string | null;
}

export async function collectSignals(
  folderPath: string,
  rootPath: string,
): Promise<FolderSignals> {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const dirNames = entries
    .filter((e) => e.isDirectory() && !EXCLUDE_DIRS.has(e.name))
    .map((e) => e.name);

  // Build files in this folder
  const buildFiles = fileNames.filter((f) => BUILD_FILE_PATTERNS.includes(f));

  // Children with build files
  let childrenWithBuildFiles = 0;
  for (const dir of dirNames) {
    const childPath = path.join(folderPath, dir);
    const childEntries = fs.readdirSync(childPath, { withFileTypes: true });
    const childFiles = childEntries
      .filter((e) => e.isFile())
      .map((e) => e.name);
    if (childFiles.some((f) => BUILD_FILE_PATTERNS.includes(f))) {
      childrenWithBuildFiles++;
    }
  }

  // Infrastructure files
  const infraFiles = fileNames.filter((f) => INFRA_FILE_PATTERNS.includes(f));
  // Also check for infra directories
  for (const dir of dirNames) {
    if (INFRA_DIR_PATTERNS.includes(dir)) {
      infraFiles.push(dir);
    }
  }

  // Source files (recursive count, shallow — max 2 levels for performance)
  let sourceFileCount = 0;
  const sourceLanguages = new Set<string>();
  const langMap: Record<string, string> = {
    ".java": "java",
    ".py": "python",
    ".c": "c",
    ".h": "c",
    ".ts": "typescript",
    ".js": "javascript",
    ".go": "go",
    ".rs": "rust",
    ".kt": "kotlin",
  };

  for (const f of fileNames) {
    const ext = path.extname(f);
    if (SOURCE_EXTENSIONS.has(ext)) {
      sourceFileCount++;
      if (langMap[ext]) sourceLanguages.add(langMap[ext]);
    }
  }
  // One level deeper
  for (const dir of dirNames) {
    try {
      const subEntries = fs.readdirSync(path.join(folderPath, dir), {
        withFileTypes: true,
      });
      for (const e of subEntries) {
        if (e.isFile()) {
          const ext = path.extname(e.name);
          if (SOURCE_EXTENSIONS.has(ext)) {
            sourceFileCount++;
            if (langMap[ext]) sourceLanguages.add(langMap[ext]);
          }
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  // Package structure detection
  const hasPackageStructure =
    fileNames.some((f) => PACKAGE_MARKERS.includes(f)) ||
    dirNames.some(
      (d) =>
        fs.existsSync(path.join(folderPath, d, "__init__.py")) ||
        // Java: src/main/java pattern
        (d === "src" &&
          fs.existsSync(path.join(folderPath, "src", "main", "java"))),
    );

  // Is this itself a package directory?
  const isPackageDir =
    fileNames.includes("__init__.py") ||
    // Java package: parent has src/main/java ancestor
    folderPath.includes(path.join("src", "main", "java"));

  // Depth
  const depth = path
    .relative(rootPath, folderPath)
    .split(path.sep)
    .filter(Boolean).length;

  // README snippet
  let readmeSnippet: string | null = null;
  const readmeNames = ["README.md", "README.rst", "README.txt", "README"];
  for (const name of readmeNames) {
    const readmePath = path.join(folderPath, name);
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, "utf-8");
      readmeSnippet = content.slice(0, 200);
      break;
    }
  }

  return {
    buildFiles,
    childrenWithBuildFiles,
    infraFiles,
    sourceFileCount,
    sourceLanguages: [...sourceLanguages],
    hasPackageStructure,
    hasSourceFiles: sourceFileCount > 0,
    isPackageDir,
    depth,
    childFolderNames: dirNames,
    readmeSnippet,
  };
}

export function inferRole(signals: FolderSignals): FolderRole {
  if (signals.childrenWithBuildFiles >= 2) {
    return "system";
  }

  if (signals.buildFiles.length > 0 && signals.hasSourceFiles) {
    if (signals.hasPackageStructure) {
      return "container";
    }
    return "code-only";
  }

  if (signals.isPackageDir && signals.hasSourceFiles) {
    return "component";
  }

  return "skip";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/classifier.ts tests/core/classifier.test.ts
git commit -m "feat: add folder classifier with signal collection and heuristic inferRole"
```

---

## Task 3: Type Extensions for Code-Level Analysis

Add `Symbol`, `SymbolRelationship`, and `analyzeModule` to the analyzer types.

**Files:**

- Modify: `src/analyzers/types.ts:86-98`

- [ ] **Step 1: Extend types**

Add after the existing `LanguageAnalyzer` interface in `src/analyzers/types.ts`:

```ts
/** Code-level symbol types for L4 diagrams */

export interface CodeSymbol {
  id: string;
  name: string;
  kind: "class" | "interface" | "function" | "struct" | "enum";
  visibility?: "public" | "private";
}

export interface SymbolRelationship {
  sourceId: string;
  targetId: string;
  kind:
    | "extends"
    | "implements"
    | "uses"
    | "calls"
    | "field-type"
    | "param-type"
    | "return-type";
  label?: string;
}

export interface ModuleSymbols {
  symbols: CodeSymbol[];
  relationships: SymbolRelationship[];
}
```

Also add `analyzeModule` as an optional method on `LanguageAnalyzer`:

```ts
export interface LanguageAnalyzer {
  id: string;
  name: string;
  buildFilePatterns: string[];
  analyze(appPath: string, config: ScanConfig): Promise<ScannedApplication>;
  analyzeModule?(
    modulePath: string,
    config: ScanConfig,
  ): Promise<ModuleSymbols>;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors (analyzeModule is optional so existing analyzers don't break)

- [ ] **Step 3: Commit**

```bash
git add src/analyzers/types.ts
git commit -m "feat: add CodeSymbol, SymbolRelationship, and analyzeModule types"
```

---

## Task 4: Java Symbol Extraction

Implement `analyzeModule` for the Java analyzer — extract classes, interfaces, enums, records and their relationships.

**Files:**

- Create: `src/analyzers/java/symbols.ts`
- Modify: `src/analyzers/java/index.ts` (add analyzeModule)
- Test: `tests/analyzers/java-symbols.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/analyzers/java-symbols.test.ts
import { describe, it, expect } from "vitest";
import { extractJavaSymbols } from "../../src/analyzers/java/symbols.js";

describe("extractJavaSymbols", () => {
  it("extracts class declaration", () => {
    const source = `
package com.example;

public class OrderService {
  private final OrderRepository repo;

  public Order createOrder(CreateOrderRequest request) {
    return repo.save(new Order(request));
  }
}`;
    const result = extractJavaSymbols([
      { path: "OrderService.java", content: source },
    ]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({
        name: "OrderService",
        kind: "class",
        visibility: "public",
      }),
    );
  });

  it("extracts interface", () => {
    const source = `
package com.example;

public interface OrderRepository {
  Order save(Order order);
  Order findById(String id);
}`;
    const result = extractJavaSymbols([
      { path: "OrderRepository.java", content: source },
    ]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderRepository", kind: "interface" }),
    );
  });

  it("extracts enum", () => {
    const source = `
package com.example;

public enum OrderStatus {
  PENDING, CONFIRMED, SHIPPED, DELIVERED
}`;
    const result = extractJavaSymbols([
      { path: "OrderStatus.java", content: source },
    ]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderStatus", kind: "enum" }),
    );
  });

  it("detects extends relationship", () => {
    const source = `
public class PremiumOrder extends Order {
}`;
    const result = extractJavaSymbols([
      { path: "Order.java", content: "public class Order {}" },
      { path: "PremiumOrder.java", content: source },
    ]);
    const rel = result.relationships.find((r) => r.kind === "extends");
    expect(rel).toBeDefined();
    expect(rel!.sourceId).toContain("PremiumOrder");
    expect(rel!.targetId).toContain("Order");
  });

  it("detects implements relationship", () => {
    const source = `
public class OrderServiceImpl implements OrderService {
}`;
    const result = extractJavaSymbols([
      {
        path: "OrderService.java",
        content: "public interface OrderService {}",
      },
      { path: "OrderServiceImpl.java", content: source },
    ]);
    const rel = result.relationships.find((r) => r.kind === "implements");
    expect(rel).toBeDefined();
  });

  it("detects field-type relationship", () => {
    const source = `
public class OrderService {
  private OrderRepository repository;
}`;
    const result = extractJavaSymbols([
      {
        path: "OrderRepository.java",
        content: "public interface OrderRepository {}",
      },
      { path: "OrderService.java", content: source },
    ]);
    const rel = result.relationships.find((r) => r.kind === "field-type");
    expect(rel).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/java-symbols.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Java symbol extraction**

Create `src/analyzers/java/symbols.ts` — use regex-based parsing to extract:

- Class/interface/enum/record declarations with visibility
- `extends` and `implements` relationships
- Field type references to known symbols

Wire into `src/analyzers/java/index.ts` by adding `analyzeModule` method to the `javaAnalyzer` export.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/java-symbols.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/java/symbols.ts src/analyzers/java/index.ts tests/analyzers/java-symbols.test.ts
git commit -m "feat: add Java symbol extraction for Code-level diagrams"
```

---

## Task 5: Python Symbol Extraction

Implement `analyzeModule` for the Python analyzer.

**Files:**

- Create: `src/analyzers/python/symbols.ts`
- Modify: `src/analyzers/python/index.ts` (add analyzeModule)
- Test: `tests/analyzers/python-symbols.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/analyzers/python-symbols.test.ts
import { describe, it, expect } from "vitest";
import { extractPythonSymbols } from "../../src/analyzers/python/symbols.js";

describe("extractPythonSymbols", () => {
  it("extracts class with inheritance", () => {
    const source = `
class OrderService(BaseService):
    def __init__(self, repo: OrderRepository):
        self.repo = repo

    def create_order(self, request: dict) -> Order:
        return self.repo.save(request)
`;
    const result = extractPythonSymbols([
      { path: "service.py", content: source },
    ]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderService", kind: "class" }),
    );
    const rel = result.relationships.find((r) => r.kind === "extends");
    expect(rel).toBeDefined();
  });

  it("extracts top-level functions", () => {
    const source = `
def process_payment(order_id: str, amount: float) -> bool:
    return True

def validate_order(order: dict) -> bool:
    return True
`;
    const result = extractPythonSymbols([
      { path: "utils.py", content: source },
    ]);
    expect(result.symbols).toHaveLength(2);
    expect(result.symbols[0].kind).toBe("function");
  });

  it("ignores private methods inside classes", () => {
    const source = `
class Foo:
    def public_method(self):
        pass

    def _private_method(self):
        pass
`;
    const result = extractPythonSymbols([{ path: "foo.py", content: source }]);
    // Only the class itself should be a symbol, not its methods
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("Foo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/python-symbols.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Python symbol extraction**

Create `src/analyzers/python/symbols.ts` — regex-based parsing for:

- `class Foo(Bar):` declarations and inheritance
- Top-level `def` functions (not indented = top-level)
- Skip class-internal methods (indented defs)

Wire into `src/analyzers/python/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/python-symbols.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/python/symbols.ts src/analyzers/python/index.ts tests/analyzers/python-symbols.test.ts
git commit -m "feat: add Python symbol extraction for Code-level diagrams"
```

---

## Task 6: C Symbol Extraction

Implement `analyzeModule` for the C analyzer.

**Files:**

- Create: `src/analyzers/c/symbols.ts`
- Modify: `src/analyzers/c/index.ts` (add analyzeModule)
- Test: `tests/analyzers/c-symbols.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/analyzers/c-symbols.test.ts
import { describe, it, expect } from "vitest";
import { extractCSymbols } from "../../src/analyzers/c/symbols.js";

describe("extractCSymbols", () => {
  it("extracts struct definition", () => {
    const source = `
typedef struct {
    int id;
    char name[64];
    float amount;
} Order;
`;
    const result = extractCSymbols([{ path: "order.h", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "Order", kind: "struct" }),
    );
  });

  it("extracts function declarations from headers", () => {
    const source = `
Order* order_create(const char* name, float amount);
void order_destroy(Order* order);
int order_validate(const Order* order);
`;
    const result = extractCSymbols([{ path: "order.h", content: source }]);
    expect(result.symbols.filter((s) => s.kind === "function")).toHaveLength(3);
  });

  it("detects param-type relationships", () => {
    const header = `
typedef struct { int id; } Order;
void order_process(Order* order);
`;
    const result = extractCSymbols([{ path: "order.h", content: header }]);
    const rel = result.relationships.find((r) => r.kind === "param-type");
    expect(rel).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/c-symbols.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement C symbol extraction**

Create `src/analyzers/c/symbols.ts` — parse:

- `typedef struct { ... } Name;` declarations
- Function declarations from headers
- `param-type` and `return-type` relationships to known struct names

Wire into `src/analyzers/c/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/c-symbols.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/c/symbols.ts src/analyzers/c/index.ts tests/analyzers/c-symbols.test.ts
git commit -m "feat: add C symbol extraction for Code-level diagrams"
```

---

## Task 7: Code-Level D2 Generator

Generate D2 diagrams from `ModuleSymbols` — the fourth C4 level.

**Files:**

- Create: `src/generator/d2/code.ts`
- Modify: `src/generator/d2/styles.ts:19-61` (add `code` class)
- Test: `tests/generator/code.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/generator/code.test.ts
import { describe, it, expect } from "vitest";
import { generateCodeDiagram } from "../../src/generator/d2/code.js";
import type { ModuleSymbols } from "../../src/analyzers/types.js";

describe("generateCodeDiagram", () => {
  it("generates D2 for classes with inheritance", () => {
    const symbols: ModuleSymbols = {
      symbols: [
        { id: "order", name: "Order", kind: "class", visibility: "public" },
        {
          id: "premium-order",
          name: "PremiumOrder",
          kind: "class",
          visibility: "public",
        },
      ],
      relationships: [
        { sourceId: "premium-order", targetId: "order", kind: "extends" },
      ],
    };
    const d2 = generateCodeDiagram(symbols, "Order Service");
    expect(d2).toContain("order:");
    expect(d2).toContain("premium_order:");
    expect(d2).toContain("premium_order -> order");
    expect(d2).toContain("extends");
  });

  it("generates D2 for interfaces and implementations", () => {
    const symbols: ModuleSymbols = {
      symbols: [
        { id: "repo", name: "OrderRepository", kind: "interface" },
        { id: "repo-impl", name: "OrderRepositoryImpl", kind: "class" },
      ],
      relationships: [
        { sourceId: "repo-impl", targetId: "repo", kind: "implements" },
      ],
    };
    const d2 = generateCodeDiagram(symbols, "Order Module");
    expect(d2).toContain("interface");
    expect(d2).toContain("implements");
  });

  it("uses code class for styling", () => {
    const symbols: ModuleSymbols = {
      symbols: [{ id: "foo", name: "Foo", kind: "class" }],
      relationships: [],
    };
    const d2 = generateCodeDiagram(symbols, "Test");
    expect(d2).toContain("class: code");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/generator/code.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Code diagram generator**

```ts
// src/generator/d2/code.ts
import type { ModuleSymbols } from "../../analyzers/types.js";
import { D2Writer } from "./writer.js";
import { toD2Id, sortById, sortRelationships } from "./stability.js";

/**
 * Generate L4 Code diagram for a single module.
 * Shows: classes, interfaces, functions, structs and their relationships.
 */
export function generateCodeDiagram(
  symbols: ModuleSymbols,
  moduleName: string,
): string {
  const w = new D2Writer();

  w.comment(`C4 Code Diagram (Level 4) — ${moduleName}`);
  w.comment("Auto-generated by diagram-docs — do not edit");
  w.blank();

  const sorted = sortById(symbols.symbols);

  for (const sym of sorted) {
    const id = toD2Id(sym.id);
    const kindLabel = sym.kind.charAt(0).toUpperCase() + sym.kind.slice(1);
    const visPrefix =
      sym.visibility === "private"
        ? "- "
        : sym.visibility === "public"
          ? "+ "
          : "";
    w.shape(id, `${visPrefix}${sym.name}\\n\\n[${kindLabel}]`, {
      class: "code",
    });
  }

  if (sorted.length > 0) w.blank();

  const symIds = new Set(symbols.symbols.map((s) => s.id));
  const validRels = symbols.relationships.filter(
    (r) => symIds.has(r.sourceId) && symIds.has(r.targetId),
  );

  for (const rel of sortRelationships(validRels)) {
    const label = rel.label ? `${rel.kind}: ${rel.label}` : rel.kind;
    w.connection(toD2Id(rel.sourceId), toD2Id(rel.targetId), label);
  }

  return w.toString();
}
```

- [ ] **Step 4: Add `code` class to styles**

In `src/generator/d2/styles.ts`, add after the `component` class block (before `system-boundary`):

```ts
w.raw("  code: {");
w.raw("    shape: rectangle");
w.raw('    style.fill: "#C9DEF1"');
w.raw('    style.font-color: "#000000"');
w.raw('    style.stroke: "#A8C8E0"');
w.raw("    style.border-radius: 4");
w.raw("  }");
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/generator/code.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/generator/d2/code.ts src/generator/d2/styles.ts tests/generator/code.test.ts
git commit -m "feat: add Code-level D2 diagram generator"
```

---

## Task 8: Agent Assist

LLM integration for classification refinement and naming. On by default, cached.

**Files:**

- Create: `src/core/agent-assist.ts`
- Test: `tests/core/agent-assist.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/agent-assist.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  agentClassify,
  loadAgentCache,
  saveAgentCache,
  computeSignalHash,
} from "../../src/core/agent-assist.js";
import type { FolderSignals } from "../../src/core/classifier.js";

const mockSignals: FolderSignals = {
  buildFiles: ["pom.xml"],
  childrenWithBuildFiles: 0,
  infraFiles: ["Dockerfile"],
  sourceFileCount: 25,
  sourceLanguages: ["java"],
  hasPackageStructure: true,
  hasSourceFiles: true,
  depth: 1,
  childFolderNames: ["src", "test"],
  readmeSnippet: "Order service handles...",
};

describe("computeSignalHash", () => {
  it("returns consistent hash for same signals", () => {
    const h1 = computeSignalHash(mockSignals);
    const h2 = computeSignalHash(mockSignals);
    expect(h1).toBe(h2);
  });

  it("returns different hash for different signals", () => {
    const h1 = computeSignalHash(mockSignals);
    const h2 = computeSignalHash({ ...mockSignals, sourceFileCount: 100 });
    expect(h1).not.toBe(h2);
  });
});

describe("agent cache", () => {
  it("round-trips cache entries", () => {
    const cache = new Map();
    cache.set("services/order", {
      role: "container" as const,
      name: "Order Service",
      description: "Handles orders",
      confidence: 0.95,
      signalHash: "abc123",
    });
    // Test serialization format
    const serialized = JSON.stringify([...cache.entries()]);
    const deserialized = new Map(JSON.parse(serialized));
    expect(deserialized.get("services/order")?.role).toBe("container");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/agent-assist.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agent assist**

```ts
// src/core/agent-assist.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { FolderSignals } from "./classifier.js";
import type { FolderRole, Config } from "../config/schema.js";

export interface AgentClassification {
  role: FolderRole;
  name: string;
  description: string;
  confidence: number;
}

interface CacheEntry extends AgentClassification {
  signalHash: string;
}

const CACHE_FILE = ".diagram-docs/agent-cache.yaml";

export function computeSignalHash(signals: FolderSignals): string {
  const data = JSON.stringify(signals);
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export function loadAgentCache(rootDir: string): Map<string, CacheEntry> {
  const cachePath = path.join(rootDir, CACHE_FILE);
  if (!fs.existsSync(cachePath)) return new Map();
  try {
    const raw = parseYaml(fs.readFileSync(cachePath, "utf-8"));
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

export function saveAgentCache(
  rootDir: string,
  cache: Map<string, CacheEntry>,
): void {
  const cachePath = path.join(rootDir, CACHE_FILE);
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const obj = Object.fromEntries(cache);
  fs.writeFileSync(cachePath, stringifyYaml(obj, { lineWidth: 120 }), "utf-8");
}

export async function agentClassify(
  folderPath: string,
  signals: FolderSignals,
  heuristicRole: FolderRole,
  config: Config,
  rootDir: string,
  parentContext?: { name: string; role: string },
): Promise<AgentClassification> {
  const relPath = path.relative(rootDir, folderPath);
  const signalHash = computeSignalHash(signals);

  // Check cache
  const cache = loadAgentCache(rootDir);
  const cached = cache.get(relPath);
  if (cached && cached.signalHash === signalHash) {
    return cached;
  }

  // Build prompt
  const prompt = buildClassificationPrompt(
    relPath,
    signals,
    heuristicRole,
    parentContext,
  );

  // Call LLM
  const result = await callLLM(prompt, config);

  // Cache result
  const entry: CacheEntry = { ...result, signalHash };
  cache.set(relPath, entry);
  saveAgentCache(rootDir, cache);

  return result;
}

function buildClassificationPrompt(
  folderPath: string,
  signals: FolderSignals,
  heuristicRole: FolderRole,
  parentContext?: { name: string; role: string },
): string {
  const lines = [
    "You are classifying a folder in a code repository for architecture diagram generation.",
    "",
    `Folder: ${folderPath}`,
    `Heuristic classification: ${heuristicRole}`,
    "",
    "Signals:",
    `  Build files: ${signals.buildFiles.join(", ") || "none"}`,
    `  Children with build files: ${signals.childrenWithBuildFiles}`,
    `  Infrastructure files: ${signals.infraFiles.join(", ") || "none"}`,
    `  Source file count: ${signals.sourceFileCount}`,
    `  Languages: ${signals.sourceLanguages.join(", ") || "none"}`,
    `  Has package structure: ${signals.hasPackageStructure}`,
    `  Depth: ${signals.depth}`,
    `  Child folders: ${signals.childFolderNames.join(", ") || "none"}`,
  ];

  if (signals.readmeSnippet) {
    lines.push(`  README excerpt: ${signals.readmeSnippet}`);
  }

  if (parentContext) {
    lines.push("", `Parent: ${parentContext.name} (${parentContext.role})`);
  }

  lines.push(
    "",
    "Respond with JSON only:",
    '{ "role": "system"|"container"|"component"|"code-only"|"skip",',
    '  "name": "Human-readable name",',
    '  "description": "One-line description",',
    '  "confidence": 0.0-1.0 }',
  );

  return lines.join("\n");
}

async function callLLM(
  prompt: string,
  config: Config,
): Promise<AgentClassification> {
  const provider = config.agent.provider;
  const model = config.agent.model;

  if (provider === "anthropic") {
    // Dynamic import to avoid hard dependency
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    return parseAgentResponse(text);
  }

  // Fallback: use OpenAI-compatible API
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });
  return parseAgentResponse(response.choices[0]?.message?.content ?? "");
}

function parseAgentResponse(text: string): AgentClassification {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      role: parsed.role ?? "skip",
      name: parsed.name ?? "",
      description: parsed.description ?? "",
      confidence: parsed.confidence ?? 0.5,
    };
  } catch {
    return { role: "skip", name: "", description: "", confidence: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/agent-assist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-assist.ts tests/core/agent-assist.test.ts
git commit -m "feat: add agent assist for LLM-powered folder classification and naming"
```

---

## Task 9: Recursive Runner

The core `processFolder` function that drives the recursive descent.

**Files:**

- Create: `src/core/recursive-runner.ts`
- Test: `tests/core/recursive-runner.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/recursive-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("processFolder", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-test-"));
  });

  it("classifies a monorepo root as system and generates context + container diagrams", async () => {
    // Create a monorepo-like structure
    // root/
    //   service-a/ (has pom.xml + src/main/java/)
    //   service-b/ (has pom.xml + src/main/java/)
    for (const svc of ["service-a", "service-b"]) {
      const svcDir = path.join(tmpDir, svc);
      fs.mkdirSync(path.join(svcDir, "src", "main", "java"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(svcDir, "pom.xml"), "<project/>");
      fs.writeFileSync(
        path.join(svcDir, "src", "main", "java", "App.java"),
        "public class App {}",
      );
    }

    const { processFolder } =
      await import("../../src/core/recursive-runner.js");
    const configSchema = await import("../../src/config/schema.js");
    const config = configSchema.configSchema.parse({
      agent: { enabled: false },
    });

    await processFolder(tmpDir, tmpDir, config);

    // Root should have context + container diagrams
    const rootDocs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(rootDocs, "_generated", "context.d2"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(rootDocs, "_generated", "container.d2")),
    ).toBe(true);
  });

  it("classifies a single-app folder as container and generates component diagram", async () => {
    // Single app with package structure
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src", "main", "java", "com", "example"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main", "java", "com", "example", "App.java"),
      "public class App {}",
    );

    const { processFolder } =
      await import("../../src/core/recursive-runner.js");
    const configSchema = await import("../../src/config/schema.js");
    const config = configSchema.configSchema.parse({
      agent: { enabled: false },
    });

    await processFolder(tmpDir, tmpDir, config);

    const docs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(docs, "_generated", "component.d2"))).toBe(
      true,
    );
  });

  it("respects config overrides for role", async () => {
    // Create a folder that heuristics would classify as system
    for (const svc of ["svc-a", "svc-b"]) {
      const svcDir = path.join(tmpDir, svc);
      fs.mkdirSync(svcDir, { recursive: true });
      fs.writeFileSync(path.join(svcDir, "pom.xml"), "<project/>");
      fs.writeFileSync(path.join(svcDir, "App.java"), "public class App {}");
    }

    const { processFolder } =
      await import("../../src/core/recursive-runner.js");
    const configSchema = await import("../../src/config/schema.js");
    const config = configSchema.configSchema.parse({
      agent: { enabled: false },
      overrides: { ".": { role: "skip" } },
    });

    await processFolder(tmpDir, tmpDir, config);

    // Should not generate anything due to skip override
    const docs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(docs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/recursive-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement recursive runner**

Create `src/core/recursive-runner.ts`:

```ts
// src/core/recursive-runner.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { Config, FolderRole } from "../config/schema.js";
import { collectSignals, inferRole } from "./classifier.js";
import { agentClassify } from "./agent-assist.js";
import { humanizeName } from "./humanize.js";
import { buildModel } from "./model-builder.js";
import { generateContextDiagram } from "../generator/d2/context.js";
import { generateContainerDiagram } from "../generator/d2/container.js";
import { generateComponentDiagram } from "../generator/d2/component.js";
import { generateCodeDiagram } from "../generator/d2/code.js";
import { scaffoldForRole } from "../generator/d2/scaffold.js";
import { getAnalyzer } from "../analyzers/registry.js";
import { slugify } from "./slugify.js";
import type { RawStructure } from "../analyzers/types.js";
import { discoverApplications } from "./discovery.js";

// Dynamically exclude the configured docs dir to avoid recursing into output
function getExcludeDirs(config: Config): Set<string> {
  return new Set([
    "node_modules",
    ".git",
    "build",
    "dist",
    "target",
    ".diagram-docs",
    "__pycache__",
    ".venv",
    "venv",
    config.output.docsDir, // exclude output directory
  ]);
}

interface ParentContext {
  parentPath: string;
  parentRole: FolderRole;
  parentName: string;
}

interface ChildPreview {
  path: string;
  role: FolderRole;
  name: string;
}

export async function processFolder(
  folderPath: string,
  rootPath: string,
  config: Config,
  parentContext?: ParentContext,
): Promise<string[]> {
  const collectedD2Files: string[] = [];
  const relPath = path.relative(rootPath, folderPath) || ".";

  // 1. Check config overrides first
  const override = config.overrides[relPath];

  // 2. Collect signals
  const signals = await collectSignals(folderPath, rootPath);

  // 3. Classify
  let role: FolderRole;
  let name: string;
  let description: string;

  if (override?.role) {
    role = override.role;
    name = override.name ?? humanizeName(path.basename(folderPath));
    description = override.description ?? "";
  } else if (config.agent.enabled) {
    const heuristicRole = inferRole(signals);
    const result = await agentClassify(
      folderPath,
      signals,
      heuristicRole,
      config,
      rootPath,
      parentContext
        ? { name: parentContext.parentName, role: parentContext.parentRole }
        : undefined,
    );
    role = result.role;
    name =
      (override?.name ?? result.name) ||
      humanizeName(path.basename(folderPath));
    description = (override?.description ?? result.description) || "";
  } else {
    role = inferRole(signals);
    name = override?.name ?? humanizeName(path.basename(folderPath));
    description = override?.description ?? "";
  }

  if (role === "skip") return collectedD2Files;

  // 4. Pre-scan children for links
  const excludeDirs = getExcludeDirs(config);
  const childPreviews = await prescanChildren(
    folderPath,
    rootPath,
    config,
    excludeDirs,
  );

  // 5. Generate diagrams for this folder based on role
  const outputDir = path.join(
    folderPath,
    config.output.docsDir,
    "architecture",
  );
  const generatedDir = path.join(outputDir, "_generated");

  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  await generateForRole(
    role,
    folderPath,
    rootPath,
    outputDir,
    generatedDir,
    name,
    description,
    config,
    childPreviews,
    parentContext,
  );

  // Scaffold user-facing files
  scaffoldForRole(
    outputDir,
    role,
    name,
    config,
    parentContext
      ? {
          outputDir: path.join(
            parentContext.parentPath,
            config.output.docsDir,
            "architecture",
          ),
        }
      : undefined,
  );

  console.error(`Generated ${role} diagrams: ${relPath}/`);

  // Collect user-facing D2 files for rendering
  const userD2 = path.join(
    outputDir,
    role === "system"
      ? "context.d2"
      : role === "container"
        ? "component.d2"
        : "code.d2",
  );
  if (fs.existsSync(userD2)) collectedD2Files.push(userD2);
  if (role === "system") {
    const containerD2 = path.join(outputDir, "container.d2");
    if (fs.existsSync(containerD2)) collectedD2Files.push(containerD2);
  }

  // 6. Recurse into children
  for (const child of childPreviews) {
    const childD2Files = await processFolder(child.path, rootPath, config, {
      parentPath: folderPath,
      parentRole: role,
      parentName: name,
    });
    collectedD2Files.push(...childD2Files);
  }

  return collectedD2Files;
}

async function prescanChildren(
  folderPath: string,
  rootPath: string,
  config: Config,
  excludeDirs: Set<string>,
): Promise<ChildPreview[]> {
  const previews: ChildPreview[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return previews;
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !excludeDirs.has(e.name))
    .filter(
      (e) =>
        !config.scan.exclude.some((pat) => {
          // Simple prefix match for excluded patterns
          const normalized = pat.replace(/\*\*/g, "").replace(/\*/g, "");
          return e.name === normalized.replace(/\//g, "");
        }),
    );

  for (const dir of dirs) {
    const childPath = path.join(folderPath, dir.name);
    const relPath = path.relative(rootPath, childPath);
    const override = config.overrides[relPath];

    if (override?.role === "skip") continue;

    const signals = await collectSignals(childPath, rootPath);
    const role = override?.role ?? inferRole(signals);

    if (role !== "skip") {
      previews.push({
        path: childPath,
        role,
        name: override?.name ?? humanizeName(dir.name),
      });
    }
  }

  return previews;
}

async function generateForRole(
  role: FolderRole,
  folderPath: string,
  rootPath: string,
  outputDir: string,
  generatedDir: string,
  name: string,
  description: string,
  config: Config,
  childPreviews: ChildPreview[],
  parentContext?: ParentContext,
): Promise<void> {
  switch (role) {
    case "system":
      await generateSystemDiagrams(
        folderPath,
        rootPath,
        outputDir,
        generatedDir,
        name,
        description,
        config,
        childPreviews,
      );
      break;
    case "container":
      await generateContainerDiagrams(
        folderPath,
        rootPath,
        outputDir,
        generatedDir,
        name,
        description,
        config,
        childPreviews,
        parentContext,
      );
      break;
    case "component":
      await generateComponentDiagrams(
        folderPath,
        rootPath,
        outputDir,
        generatedDir,
        name,
        config,
        parentContext,
      );
      break;
    case "code-only":
      await generateCodeOnlyDiagrams(
        folderPath,
        rootPath,
        outputDir,
        generatedDir,
        name,
        config,
        parentContext,
      );
      break;
  }
}

async function generateSystemDiagrams(
  folderPath: string,
  rootPath: string,
  outputDir: string,
  generatedDir: string,
  name: string,
  description: string,
  config: Config,
  childPreviews: ChildPreview[],
): Promise<void> {
  // Scan all child apps to build a model
  const discovered = await discoverApplications(folderPath, config);
  if (discovered.length === 0) return;

  const applications = [];
  for (const app of discovered) {
    const analyzer = getAnalyzer(app.analyzerId);
    if (!analyzer) continue;
    const result = await analyzer.analyze(path.resolve(folderPath, app.path), {
      exclude: config.scan.exclude,
      abstraction: config.abstraction,
    });
    result.path = app.path;
    result.id = slugify(app.path);
    applications.push(result);
  }

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: "",
    applications,
  };

  const model = buildModel({ config, rawStructure });
  model.system.name = name;
  model.system.description = description;

  // Context diagram
  const contextD2 = generateContextDiagram(model);
  writeIfChanged(path.join(generatedDir, "context.d2"), contextD2);

  // Container diagram with drill-down links
  const containerD2 = generateContainerDiagram(model, {
    submoduleLinkResolver: (containerId) => {
      const child = childPreviews.find((c) => {
        const childSlug = slugify(path.relative(folderPath, c.path));
        return childSlug === containerId || c.name === containerId;
      });
      if (!child) return null;
      const childOutputDir = path.join(
        child.path,
        config.output.docsDir,
        "architecture",
      );
      const rel = path.relative(outputDir, childOutputDir);
      return `${rel}/component.${config.output.format}`;
    },
    format: config.output.format,
  });
  writeIfChanged(path.join(generatedDir, "container.d2"), containerD2);
}

async function generateContainerDiagrams(
  folderPath: string,
  rootPath: string,
  outputDir: string,
  generatedDir: string,
  name: string,
  description: string,
  config: Config,
  childPreviews: ChildPreview[],
  parentContext?: ParentContext,
): Promise<void> {
  // Scan this folder as a single application
  const discovered = await discoverApplications(folderPath, config);
  if (discovered.length === 0) return;

  const app = discovered[0];
  const analyzer = getAnalyzer(app.analyzerId);
  if (!analyzer) return;

  const result = await analyzer.analyze(path.resolve(folderPath, app.path), {
    exclude: config.scan.exclude,
    abstraction: config.abstraction,
  });
  result.path = app.path === "." ? path.basename(folderPath) : app.path;
  result.id = slugify(result.path);

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: "",
    applications: [result],
  };

  const model = buildModel({ config, rawStructure });
  if (model.containers.length === 0) return;

  const containerId = model.containers[0].id;
  const componentD2 = generateComponentDiagram(model, containerId);
  writeIfChanged(path.join(generatedDir, "component.d2"), componentD2);
}

async function generateComponentDiagrams(
  folderPath: string,
  rootPath: string,
  outputDir: string,
  generatedDir: string,
  name: string,
  config: Config,
  parentContext?: ParentContext,
): Promise<void> {
  // Find the language analyzer for this module
  const entries = fs.readdirSync(folderPath);
  const langMap: Record<string, string> = {
    ".java": "java",
    ".py": "python",
    ".c": "c",
    ".h": "c",
  };

  let analyzerId: string | null = null;
  for (const entry of entries) {
    const ext = path.extname(entry);
    if (langMap[ext]) {
      analyzerId = langMap[ext];
      break;
    }
  }

  if (!analyzerId) return;

  const analyzer = getAnalyzer(analyzerId);
  if (!analyzer?.analyzeModule) return;

  const symbols = await analyzer.analyzeModule(folderPath, {
    exclude: config.scan.exclude,
    abstraction: config.abstraction,
  });

  if (symbols.symbols.length < config.abstraction.codeLevel.minSymbols) return;

  const codeD2 = generateCodeDiagram(symbols, name);
  writeIfChanged(path.join(generatedDir, "code.d2"), codeD2);
}

async function generateCodeOnlyDiagrams(
  folderPath: string,
  rootPath: string,
  outputDir: string,
  generatedDir: string,
  name: string,
  config: Config,
  parentContext?: ParentContext,
): Promise<void> {
  // Same as component but generates code.d2 at the top level
  await generateComponentDiagrams(
    folderPath,
    rootPath,
    outputDir,
    generatedDir,
    name,
    config,
    parentContext,
  );
}

function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return false;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/recursive-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/recursive-runner.ts tests/core/recursive-runner.test.ts
git commit -m "feat: add recursive runner — processFolder drives the recursive descent"
```

---

## Task 10: CLI `run` Command

Wire the recursive runner into a new CLI command.

**Files:**

- Create: `src/cli/commands/run.ts`
- Modify: `src/cli/index.ts:1-23`

- [ ] **Step 1: Create the `run` command**

```ts
// src/cli/commands/run.ts
import { Command } from "commander";
import * as path from "node:path";
import { loadConfig } from "../../config/loader.js";
import { processFolder } from "../../core/recursive-runner.js";

export const runCommand = new Command("run")
  .description(
    "Recursively analyze and generate architecture diagrams for the entire repository",
  )
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("--no-agent", "Disable LLM agent assist (use heuristics only)")
  .action(async (options) => {
    const { config, configDir } = loadConfig(options.config);

    // CLI --no-agent flag overrides config
    if (options.agent === false) {
      config.agent.enabled = false;
    }

    const rootDir = configDir;
    console.error(`diagram-docs: recursive analysis starting at ${rootDir}`);
    console.error(
      `Agent assist: ${config.agent.enabled ? `enabled (${config.agent.provider}/${config.agent.model})` : "disabled"}`,
    );

    const d2Files = await processFolder(rootDir, rootDir, config);

    // Render all collected D2 files to SVG/PNG
    if (d2Files.length > 0) {
      const { renderD2Files } = await import("../../generator/d2/render.js");
      renderD2Files(d2Files, config);
    }

    console.error("Done.");
  });
```

- [ ] **Step 2: Register in CLI index**

Add to `src/cli/index.ts`:

```ts
import { runCommand } from "./commands/run.js";
// ... after other addCommand calls:
program.addCommand(runCommand);
```

- [ ] **Step 3: Verify it compiles and runs**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npx tsx src/cli/index.ts run --help`
Expected: Shows help for the `run` command

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/run.ts src/cli/index.ts
git commit -m "feat: add 'diagram-docs run' CLI command for recursive diagram generation"
```

---

## Task 11: Update Scaffold for Role-Aware Generation

Update the user-facing file scaffolding to work with any role.

**Files:**

- Modify: `src/generator/d2/scaffold.ts:1-89`

- [ ] **Step 1: Update scaffold to be role-aware**

Replace `src/generator/d2/scaffold.ts` to scaffold user-facing D2 files based on role instead of `config.levels.*`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { Config, FolderRole } from "../../config/schema.js";
import { generateStyles } from "./styles.js";

/**
 * Scaffold user-facing D2 files for a given role.
 * Only creates files that don't already exist — never overwrites user work.
 */
export function scaffoldForRole(
  outputDir: string,
  role: FolderRole,
  name: string,
  config: Config,
  parentContext?: { outputDir: string },
): void {
  // Styles file
  const stylesPath = path.join(outputDir, "styles.d2");
  const stylesContent = generateStyles(
    config.output.theme,
    config.output.layout,
  );
  if (
    !fs.existsSync(stylesPath) ||
    fs.readFileSync(stylesPath, "utf-8") !== stylesContent
  ) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(stylesPath, stylesContent, "utf-8");
  }

  const breadcrumb = parentContext
    ? `# Parent: ${path.relative(outputDir, parentContext.outputDir)}/\n`
    : "";

  switch (role) {
    case "system":
      scaffoldFile(
        path.join(outputDir, "context.d2"),
        [
          `# C4 Context Diagram`,
          `# System: ${name}`,
          breadcrumb,
          "...@_generated/context.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      scaffoldFile(
        path.join(outputDir, "container.d2"),
        [
          `# C4 Container Diagram`,
          `# System: ${name}`,
          breadcrumb,
          "...@_generated/container.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      break;

    case "container":
      scaffoldFile(
        path.join(outputDir, "component.d2"),
        [
          `# C4 Component Diagram — ${name}`,
          breadcrumb,
          "...@_generated/component.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      break;

    case "component":
    case "code-only":
      scaffoldFile(
        path.join(outputDir, "code.d2"),
        [
          `# C4 Code Diagram — ${name}`,
          breadcrumb,
          "...@_generated/code.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      break;
  }
}

function scaffoldFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
```

- [ ] **Step 2: Update recursive runner to call scaffolding**

In `src/core/recursive-runner.ts`, add `scaffoldForRole` call after generating diagrams in `generateForRole`.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/generator/d2/scaffold.ts src/core/recursive-runner.ts
git commit -m "feat: update scaffold for role-aware user-facing D2 files"
```

---

## Task 12: Extract D2 Rendering Utility

The existing `renderD2Files` function lives inside `src/cli/commands/generate.ts` as a private function. Extract it to a shared module so both `generate` and `run` commands can use it.

**Files:**

- Create: `src/generator/d2/render.ts`
- Modify: `src/cli/commands/generate.ts` (import from shared module)

- [ ] **Step 1: Extract renderD2Files to shared module**

Move `renderD2Files` and `isUpToDate` from `src/cli/commands/generate.ts:209-292` to `src/generator/d2/render.ts`. Export `renderD2Files`.

- [ ] **Step 2: Update generate.ts to import from shared module**

Replace the local `renderD2Files` / `isUpToDate` in `generate.ts` with:

```ts
import { renderD2Files } from "../../generator/d2/render.js";
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/generator/d2/render.ts src/cli/commands/generate.ts
git commit -m "refactor: extract renderD2Files to shared module"
```

---

**Note on `discovery.ts`:** The spec lists `discovery.ts` as "Modified — refactored into signal collection." In practice, `discovery.ts` is reused as-is inside the recursive runner for the `system` role (to find child applications). Signal collection is handled by the new `classifier.ts` module instead. This is a deliberate simplification — less churn, same result.

---

## Task 13: Remove Submodule Scaffold

Remove the old submodule scaffolding code now that recursive descent handles it.

**Files:**

- Delete: `src/generator/d2/submodule-scaffold.ts`
- Modify: `src/cli/commands/generate.ts` (remove submodule import and usage)

- [ ] **Step 1: Remove submodule-scaffold.ts**

Delete the file `src/generator/d2/submodule-scaffold.ts`.

- [ ] **Step 2: Remove submodule references from generate command**

In `src/cli/commands/generate.ts`:

- Remove the import of `generateSubmoduleDocs`
- Remove the `--submodules` CLI option
- Remove the submodule generation block (lines 123-134)

- [ ] **Step 3: Remove submodule integration test**

Remove or update `tests/integration/submodule.test.ts` — replace with a recursive runner integration test.

- [ ] **Step 4: Verify all tests pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove submodule-scaffold — subsumed by recursive descent"
```

---

## Task 13: Install Anthropic SDK Dependency

Add the Anthropic SDK as an optional dependency for agent assist.

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency for agent assist"
```

---

## Task 15: End-to-End Integration Test

Full recursive descent test on a realistic fixture.

**Files:**

- Create: `tests/integration/recursive.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// tests/integration/recursive.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { processFolder } from "../../src/core/recursive-runner.js";
import { configSchema } from "../../src/config/schema.js";

describe("recursive descent integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-recursive-"));
  });

  it("generates full diagram hierarchy for a Java monorepo", async () => {
    // Create structure:
    // root/
    //   service-a/ (pom.xml, java packages)
    //   service-b/ (pom.xml, java packages)
    for (const svc of ["service-a", "service-b"]) {
      const base = path.join(tmpDir, svc);
      fs.mkdirSync(path.join(base, "src", "main", "java", "com", "example"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(base, "pom.xml"), "<project/>");
      fs.writeFileSync(
        path.join(base, "src", "main", "java", "com", "example", "App.java"),
        [
          "package com.example;",
          "public class App {",
          "  public static void main(String[] args) {}",
          "}",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(
          base,
          "src",
          "main",
          "java",
          "com",
          "example",
          "Service.java",
        ),
        [
          "package com.example;",
          "public class Service {",
          "  private App app;",
          "}",
        ].join("\n"),
      );
    }

    const config = configSchema.parse({ agent: { enabled: false } });
    await processFolder(tmpDir, tmpDir, config);

    // Root: system level — context + container
    const rootDocs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(rootDocs, "_generated", "context.d2"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(rootDocs, "_generated", "container.d2")),
    ).toBe(true);

    // Each service: container level — component
    for (const svc of ["service-a", "service-b"]) {
      const svcDocs = path.join(tmpDir, svc, "docs", "architecture");
      expect(
        fs.existsSync(path.join(svcDocs, "_generated", "component.d2")),
      ).toBe(true);
    }
  });

  it("generates only code diagram for a small library", async () => {
    // Single Python file with a pyproject.toml, no package structure
    fs.writeFileSync(
      path.join(tmpDir, "pyproject.toml"),
      '[project]\nname = "tiny-lib"\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, "lib.py"),
      [
        "class Calculator:",
        "    def add(self, a, b):",
        "        return a + b",
        "",
        "class AdvancedCalculator(Calculator):",
        "    def multiply(self, a, b):",
        "        return a * b",
      ].join("\n"),
    );

    const config = configSchema.parse({ agent: { enabled: false } });
    await processFolder(tmpDir, tmpDir, config);

    const docs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(docs, "_generated", "code.d2"))).toBe(true);
    // Should NOT have context or container diagrams
    expect(fs.existsSync(path.join(docs, "_generated", "context.d2"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(docs, "_generated", "container.d2"))).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/integration/recursive.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/integration/recursive.test.ts
git commit -m "test: add end-to-end integration tests for recursive diagram generation"
```

---

## Task 16: Final Cleanup and Verification

Verify everything works together, fix any remaining compilation issues.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Manual smoke test**

Run `diagram-docs run --no-agent` on a test repo to verify end-to-end output.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for recursive diagram generation"
```
