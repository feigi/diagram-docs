# C4 Code-Level (L4) Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth C4 level (`c4-code`) that renders a D2 diagram per component, showing the code-level building blocks inside it — classes, interfaces, enums, structs, typedefs, and functions — across Java, TypeScript, Python, and C, using tree-sitter-based extraction.

**Architecture:** A new `code` config flag gates L4 extraction throughout the pipeline. Each language analyzer runs tree-sitter queries to produce `RawCodeElement[]`, stored on each `ScannedModule`. The model-builder resolves short names to qualified IDs and produces `CodeElement[]` + `CodeRelationship[]` on the `ArchitectureModel`. A new `src/generator/d2/code.ts` generator emits per-component `c4-code.d2` files using per-language rendering profiles (Java/TypeScript/Python share a profile; C has its own).

**Tech Stack:** TypeScript (Node16 ES modules), Zod (config validation), `web-tree-sitter` + bundled WASM grammars (new dep), D2 (existing writer), vitest (tests).

**Spec:** `docs/superpowers/specs/2026-04-14-c4-code-level-diagrams-design.md`

---

## File Structure

New files:

```
src/analyzers/tree-sitter.ts                 # shared WASM loader + query runner
src/analyzers/java/code.ts                   # Java RawCodeElement extractor
src/analyzers/java/queries/code.scm          # Java tree-sitter query
src/analyzers/typescript/code.ts             # TypeScript extractor
src/analyzers/typescript/queries/code.scm    # TypeScript tree-sitter query
src/analyzers/python/code.ts                 # Python extractor
src/analyzers/python/queries/code.scm        # Python tree-sitter query
src/analyzers/c/code.ts                      # C extractor
src/analyzers/c/queries/code.scm             # C tree-sitter query
src/core/code-model.ts                       # buildCodeModel(): resolution + filters
src/generator/d2/code.ts                     # L4 generator skeleton + profile dispatch
src/generator/d2/code-profiles.ts            # JavaTsPy + C rendering profiles
src/generator/d2/code-scaffold.ts            # scaffold writer for user-facing c4-code.d2
assets/tree-sitter/tree-sitter-java.wasm
assets/tree-sitter/tree-sitter-typescript.wasm
assets/tree-sitter/tree-sitter-python.wasm
assets/tree-sitter/tree-sitter-c.wasm

tests/analyzers/java-code.test.ts
tests/analyzers/typescript-code.test.ts
tests/analyzers/python-code.test.ts
tests/analyzers/c-code.test.ts
tests/core/code-model.test.ts
tests/generator/d2/code.test.ts
tests/integration/code-level.test.ts
tests/bench/code-extraction.bench.ts
tests/fixtures/code-level/java/                # minimal Java fixture
tests/fixtures/code-level/typescript/          # minimal TS fixture
tests/fixtures/code-level/python/              # minimal Python fixture
tests/fixtures/code-level/c/                   # minimal C fixture
```

Modified files:

```
src/config/schema.ts                        # add levels.code + code.* section
src/analyzers/types.ts                      # add RawCodeElement/CodeElement/CodeRelationship + optional fields
src/schemas/raw-structure.schema.json       # add codeElements on ScannedModule
src/schemas/architecture-model.schema.json  # add codeElements + codeRelationships
src/analyzers/java/index.ts                 # call extractCode() when config.levels.code
src/analyzers/typescript/index.ts           # same
src/analyzers/python/index.ts               # same
src/analyzers/c/index.ts                    # same
src/core/model-builder.ts                   # call buildCodeModel() after component building
src/cli/commands/generate.ts                # add L4 branch + scaffold call + drift check
package.json                                # add web-tree-sitter + language grammar deps
```

---

## Phase 1: Foundation (config, types, schemas)

### Task 1: Extend config schema with `levels.code` and `code` section

**Files:**

- Modify: `src/config/schema.ts:31-48`
- Modify: `tests/config/build-effective-config.test.ts` (add case for new defaults)

- [ ] **Step 1: Write the failing test**

Add to `tests/config/build-effective-config.test.ts`:

```typescript
it("defaults levels.code to false and exposes code config defaults", () => {
  const config = buildEffectiveConfig({});
  expect(config.levels.code).toBe(false);
  expect(config.code.includePrivate).toBe(false);
  expect(config.code.includeMembers).toBe(true);
  expect(config.code.minElements).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/build-effective-config.test.ts -t "code"`
Expected: FAIL — `config.levels.code` is undefined; `config.code` is undefined.

- [ ] **Step 3: Modify `src/config/schema.ts`**

Find the `levels` object at line 31 and add `code` inside it; then add a new `code` sibling section:

```typescript
levels: z
  .object({
    context: z.boolean().default(true),
    container: z.boolean().default(true),
    component: z.boolean().default(true),
    code: z.boolean().default(false),
  })
  .default({}),
code: z
  .object({
    includePrivate: z.boolean().default(false),
    includeMembers: z.boolean().default(true),
    minElements: z.number().int().min(1).default(2),
  })
  .default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config/build-effective-config.test.ts -t "code"`
Expected: PASS.

- [ ] **Step 5: Run full typecheck + test suite**

Run: `npm run typecheck && npm test`
Expected: all pass. If any existing test relied on the exact shape of `Config`, update it.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts tests/config/build-effective-config.test.ts
git commit -m "feat: add levels.code and code config section for L4 diagrams"
```

---

### Task 2: Extend `src/analyzers/types.ts` with code-level interfaces

**Files:**

- Modify: `src/analyzers/types.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/analyzers/types-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  RawCodeElement,
  CodeMember,
  RawCodeReference,
  CodeElement,
  CodeRelationship,
  ScannedModule,
  ArchitectureModel,
} from "../../src/analyzers/types.js";

describe("code-level types", () => {
  it("RawCodeElement has required and optional fields", () => {
    const el: RawCodeElement = {
      id: "com.example.Foo",
      kind: "class",
      name: "Foo",
      location: { file: "Foo.java", line: 1 },
    };
    expect(el.id).toBe("com.example.Foo");
  });

  it("CodeElement carries componentId", () => {
    const el: CodeElement = {
      id: "api.users.UserService",
      componentId: "users",
      kind: "class",
      name: "UserService",
    };
    expect(el.componentId).toBe("users");
  });

  it("ScannedModule accepts optional codeElements", () => {
    const mod: ScannedModule = {
      id: "m",
      path: "/tmp",
      name: "m",
      files: [],
      exports: [],
      imports: [],
      metadata: {},
      codeElements: [],
    };
    expect(mod.codeElements).toEqual([]);
  });

  it("ArchitectureModel accepts optional codeElements + codeRelationships", () => {
    const model: Partial<ArchitectureModel> = {
      codeElements: [],
      codeRelationships: [],
    };
    expect(model.codeElements).toEqual([]);
  });

  it("CodeRelationship kind enumerates the four semantic relations", () => {
    const rels: CodeRelationship[] = [
      { sourceId: "a", targetId: "b", kind: "inherits" },
      { sourceId: "a", targetId: "b", kind: "implements" },
      { sourceId: "a", targetId: "b", kind: "uses" },
      { sourceId: "a", targetId: "b", kind: "contains" },
    ];
    expect(rels.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/types-code.test.ts`
Expected: FAIL — type imports don't exist.

- [ ] **Step 3: Modify `src/analyzers/types.ts`**

Add after the existing `ModuleImport` interface:

```typescript
export interface RawCodeElement {
  id: string;
  kind: string;
  name: string;
  visibility?: "public" | "internal" | "private";
  parentId?: string;
  members?: CodeMember[];
  tags?: string[];
  references?: RawCodeReference[];
  location: { file: string; line: number };
}

export interface CodeMember {
  name: string;
  kind: "field" | "method";
  signature?: string;
  visibility?: "public" | "internal" | "private";
}

export interface RawCodeReference {
  targetName: string;
  kind: "extends" | "implements" | "uses" | "contains";
}
```

Add to the existing `ScannedModule` interface:

```typescript
export interface ScannedModule {
  id: string;
  path: string;
  name: string;
  files: string[];
  exports: string[];
  imports: ModuleImport[];
  metadata: Record<string, string>;
  codeElements?: RawCodeElement[]; // NEW
}
```

Add after the existing `ArchitectureModel` interface:

```typescript
export interface CodeElement {
  id: string;
  componentId: string;
  kind: string;
  name: string;
  visibility?: "public" | "internal" | "private";
  parentElementId?: string;
  members?: CodeMember[];
  tags?: string[];
}

export interface CodeRelationship {
  sourceId: string;
  targetId: string;
  kind: "inherits" | "implements" | "uses" | "contains";
  label?: string;
}
```

Add to the existing `ArchitectureModel` interface:

```typescript
export interface ArchitectureModel {
  // ... existing fields
  codeElements?: CodeElement[]; // NEW
  codeRelationships?: CodeRelationship[]; // NEW
}
```

Also extend `ScanConfig` so analyzers can gate extraction:

```typescript
export interface ScanConfig {
  exclude: string[];
  abstraction: Config["abstraction"];
  levels?: Config["levels"]; // NEW — analyzers read levels.code
  code?: Config["code"]; // NEW — analyzers read includePrivate etc.
}
```

- [ ] **Step 4: Thread config through `src/core/scan.ts`**

Search `scan.ts` for where it constructs the `ScanConfig` passed to analyzers. Add `levels: config.levels` and `code: config.code` to every construction site. Expected: one or two call sites.

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/analyzers/types-code.test.ts && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/analyzers/types.ts src/core/scan.ts tests/analyzers/types-code.test.ts
git commit -m "feat: add code-level types to analyzer and model interfaces"
```

---

### Task 3: Extend JSON schemas

**Files:**

- Modify: `src/schemas/raw-structure.schema.json`
- Modify: `src/schemas/architecture-model.schema.json`
- Test: `tests/core/schemas.test.ts` (create if absent; add case if present)

- [ ] **Step 1: Write the failing test**

Create or extend `tests/core/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import rawSchema from "../../src/schemas/raw-structure.schema.json" with { type: "json" };
import modelSchema from "../../src/schemas/architecture-model.schema.json" with { type: "json" };

describe("JSON schemas include code-level fields", () => {
  it("raw-structure schema allows codeElements on a module", () => {
    const modProps =
      rawSchema.definitions?.ScannedModule?.properties ??
      rawSchema.properties?.applications?.items?.properties?.modules?.items
        ?.properties;
    expect(modProps).toBeDefined();
    expect(modProps.codeElements).toBeDefined();
    expect(modProps.codeElements.type).toBe("array");
  });

  it("architecture-model schema defines codeElements and codeRelationships", () => {
    expect(modelSchema.properties.codeElements).toBeDefined();
    expect(modelSchema.properties.codeRelationships).toBeDefined();
  });
});
```

Note: the exact path to ScannedModule's properties depends on schema layout — inspect `src/schemas/raw-structure.schema.json` and use whichever selector resolves to the module-properties object.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/schemas.test.ts`
Expected: FAIL — `codeElements` not defined.

- [ ] **Step 3: Modify `src/schemas/raw-structure.schema.json`**

Add under the `ScannedModule` properties block:

```json
"codeElements": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "kind", "name", "location"],
    "properties": {
      "id": { "type": "string" },
      "kind": { "type": "string" },
      "name": { "type": "string" },
      "visibility": { "type": "string", "enum": ["public", "internal", "private"] },
      "parentId": { "type": "string" },
      "members": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "kind"],
          "properties": {
            "name": { "type": "string" },
            "kind": { "type": "string", "enum": ["field", "method"] },
            "signature": { "type": "string" },
            "visibility": { "type": "string", "enum": ["public", "internal", "private"] }
          }
        }
      },
      "tags": { "type": "array", "items": { "type": "string" } },
      "references": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["targetName", "kind"],
          "properties": {
            "targetName": { "type": "string" },
            "kind": { "type": "string", "enum": ["extends", "implements", "uses", "contains"] }
          }
        }
      },
      "location": {
        "type": "object",
        "required": ["file", "line"],
        "properties": {
          "file": { "type": "string" },
          "line": { "type": "integer" }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Modify `src/schemas/architecture-model.schema.json`**

Add to top-level properties (after `relationships`):

```json
"codeElements": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "required": ["id", "componentId", "kind", "name"],
    "properties": {
      "id": { "type": "string" },
      "componentId": { "type": "string" },
      "kind": { "type": "string" },
      "name": { "type": "string" },
      "visibility": { "type": "string", "enum": ["public", "internal", "private"] },
      "parentElementId": { "type": "string" },
      "members": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "kind"],
          "properties": {
            "name": { "type": "string" },
            "kind": { "type": "string", "enum": ["field", "method"] },
            "signature": { "type": "string" },
            "visibility": { "type": "string", "enum": ["public", "internal", "private"] }
          }
        }
      },
      "tags": { "type": "array", "items": { "type": "string" } }
    }
  }
},
"codeRelationships": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "required": ["sourceId", "targetId", "kind"],
    "properties": {
      "sourceId": { "type": "string" },
      "targetId": { "type": "string" },
      "kind": { "type": "string", "enum": ["inherits", "implements", "uses", "contains"] },
      "label": { "type": "string" }
    }
  }
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/core/schemas.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/ tests/core/schemas.test.ts
git commit -m "feat: extend JSON schemas with code-level fields"
```

---

## Phase 2: Tree-sitter infrastructure

### Task 4: Install `web-tree-sitter` and bundle language WASM grammars

**Files:**

- Modify: `package.json`
- Create: `assets/tree-sitter/tree-sitter-{java,typescript,python,c}.wasm`
- Modify: `.gitignore` (optionally, if grammars are committed as artifacts)
- Test: `tests/analyzers/tree-sitter.test.ts` (created in Task 5)

- [ ] **Step 1: Install `web-tree-sitter`**

Run: `npm install web-tree-sitter@^0.21.0`
Expected: adds `web-tree-sitter` to `package.json` dependencies.

- [ ] **Step 2: Install prebuilt WASM grammars**

Run (as dev deps — the `.wasm` files inside each package are what we need):

```bash
npm install --save-dev tree-sitter-java tree-sitter-typescript tree-sitter-python tree-sitter-c
```

Each package ships a `.wasm` file at a known path inside its directory. Verify with:

```bash
find node_modules -name "tree-sitter-*.wasm" -type f | head
```

- [ ] **Step 3: Copy grammars into bundled `assets/tree-sitter/`**

Create `assets/tree-sitter/` (it will be shipped with the package):

```bash
mkdir -p assets/tree-sitter
cp node_modules/tree-sitter-java/tree-sitter-java.wasm assets/tree-sitter/
cp node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm assets/tree-sitter/
cp node_modules/tree-sitter-python/tree-sitter-python.wasm assets/tree-sitter/
cp node_modules/tree-sitter-c/tree-sitter-c.wasm assets/tree-sitter/
```

The actual grammar package paths may vary slightly — use the output of the `find` command from Step 2 and adjust. If a package ships pre-built source instead of `.wasm`, add a build step to `prepack` script via `tree-sitter-cli build --wasm`.

- [ ] **Step 4: Include `assets/` in published files**

Modify `package.json` `files` array (or create one if absent) to include `assets/`:

```json
"files": [
  "dist/",
  "assets/"
]
```

- [ ] **Step 5: Verify grammars load**

Write a one-off sanity script at `scripts/verify-grammars.mjs`:

```javascript
import TreeSitter from "web-tree-sitter";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(__dirname, "..", "assets", "tree-sitter");

await TreeSitter.init();
for (const lang of ["java", "typescript", "python", "c"]) {
  const file = path.join(assets, `tree-sitter-${lang}.wasm`);
  const g = await TreeSitter.Language.load(file);
  console.log(`${lang}: ${g.nodeTypeCount} node types`);
}
```

Run: `node scripts/verify-grammars.mjs`
Expected: four lines, each reporting a positive `nodeTypeCount`. Delete the script afterwards — the Task 5 test will be the durable check.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json assets/ .gitignore
git commit -m "chore: add web-tree-sitter and bundle language grammars"
```

---

### Task 5: Create shared tree-sitter module

**Files:**

- Create: `src/analyzers/tree-sitter.ts`
- Test: `tests/analyzers/tree-sitter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/analyzers/tree-sitter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  loadLanguage,
  runQuery,
  resetLoaderForTesting,
} from "../../src/analyzers/tree-sitter.js";

describe("tree-sitter loader", () => {
  it("loads the Java grammar and runs a class-name query", async () => {
    resetLoaderForTesting();
    const source = `package com.example; public class Foo { }`;
    const query = `(class_declaration name: (identifier) @name)`;
    const matches = await runQuery("java", source, query);
    const names = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(names).toContain("Foo");
  });

  it("caches grammars across invocations", async () => {
    resetLoaderForTesting();
    const src = `def f(): pass`;
    await runQuery(
      "python",
      src,
      `(function_definition name: (identifier) @n)`,
    );
    // second call should hit the cache; no user-visible effect, but covers the path.
    const matches = await runQuery(
      "python",
      src,
      `(function_definition name: (identifier) @n)`,
    );
    expect(matches.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/tree-sitter.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/analyzers/tree-sitter.ts`**

```typescript
import TreeSitter from "web-tree-sitter";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type SupportedLanguage = "java" | "typescript" | "python" | "c";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/analyzers/tree-sitter.js → repo root → assets/tree-sitter/
const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets", "tree-sitter");

let parserInitialized = false;
const grammarCache = new Map<SupportedLanguage, TreeSitter.Language>();

export function resetLoaderForTesting(): void {
  parserInitialized = false;
  grammarCache.clear();
}

async function initOnce(): Promise<void> {
  if (parserInitialized) return;
  await TreeSitter.init();
  parserInitialized = true;
}

export async function loadLanguage(
  lang: SupportedLanguage,
): Promise<TreeSitter.Language> {
  await initOnce();
  const cached = grammarCache.get(lang);
  if (cached) return cached;
  const file = path.join(ASSETS_DIR, `tree-sitter-${lang}.wasm`);
  const grammar = await TreeSitter.Language.load(file);
  grammarCache.set(lang, grammar);
  return grammar;
}

export interface QueryMatch {
  pattern: number;
  captures: Array<{ name: string; node: TreeSitter.SyntaxNode }>;
}

export async function runQuery(
  lang: SupportedLanguage,
  source: string,
  queryText: string,
): Promise<QueryMatch[]> {
  const grammar = await loadLanguage(lang);
  const parser = new TreeSitter();
  parser.setLanguage(grammar);
  const tree = parser.parse(source);
  const query = grammar.query(queryText);
  const matches = query.matches(tree.rootNode);
  return matches.map((m) => ({
    pattern: m.pattern,
    captures: m.captures.map((c) => ({ name: c.name, node: c.node })),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/tree-sitter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/tree-sitter.ts tests/analyzers/tree-sitter.test.ts
git commit -m "feat: add shared tree-sitter loader and query runner"
```

---

## Phase 3: Per-language code extraction

Each task in this phase follows the same pattern: a tree-sitter query file, an `extractCode()` function that turns matches into `RawCodeElement[]`, a minimal fixture, and a test.

### Task 6: Java code extraction

**Files:**

- Create: `src/analyzers/java/queries/code.scm`
- Create: `src/analyzers/java/code.ts`
- Create: `tests/analyzers/java-code.test.ts`
- Create: `tests/fixtures/code-level/java/UserService.java`

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/code-level/java/UserService.java`:

```java
package com.example.users;

import java.util.List;
import java.io.Serializable;

public interface Auditable {
    String getAuditLog();
}

public class User implements Serializable {
    private String name;
    public String getName() { return name; }
}

public class UserService implements Auditable {
    private final List<User> users;

    public UserService(List<User> users) {
        this.users = users;
    }

    public User findByName(String name) { return null; }

    public String getAuditLog() { return ""; }
}

enum Role { ADMIN, USER }
```

- [ ] **Step 2: Write the failing test**

Create `tests/analyzers/java-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractJavaCode } from "../../src/analyzers/java/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/java/UserService.java",
);

describe("java code extraction", () => {
  it("extracts classes, interfaces, and enums", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const elements = await extractJavaCode(FIXTURE, source);
    const names = elements.map((e) => e.name).sort();
    expect(names).toEqual(["Auditable", "Role", "User", "UserService"]);
  });

  it("marks interfaces and enums with correct kind", () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    return extractJavaCode(FIXTURE, source).then((els) => {
      const kinds = Object.fromEntries(els.map((e) => [e.name, e.kind]));
      expect(kinds["Auditable"]).toBe("interface");
      expect(kinds["User"]).toBe("class");
      expect(kinds["Role"]).toBe("enum");
    });
  });

  it("captures implements/extends references", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([{ targetName: "Auditable", kind: "implements" }]),
    );
    const user = els.find((e) => e.name === "User")!;
    expect(user.references).toEqual(
      expect.arrayContaining([
        { targetName: "Serializable", kind: "implements" },
      ]),
    );
  });

  it("records public methods and fields on UserService", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    const memberNames = (svc.members ?? []).map((m) => m.name).sort();
    expect(memberNames).toEqual(
      expect.arrayContaining(["findByName", "getAuditLog"]),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/java-code.test.ts`
Expected: FAIL — `extractJavaCode` not found.

- [ ] **Step 4: Create the tree-sitter query**

Create `src/analyzers/java/queries/code.scm`:

```scheme
;; Classes
(class_declaration
  name: (identifier) @class.name
  (superclass (type_identifier) @class.extends)?
  (super_interfaces (type_list (type_identifier) @class.implements))?) @class.decl

;; Interfaces
(interface_declaration
  name: (identifier) @interface.name
  (extends_interfaces (type_list (type_identifier) @interface.extends))?) @interface.decl

;; Enums
(enum_declaration
  name: (identifier) @enum.name) @enum.decl

;; Public methods inside classes or interfaces
(method_declaration
  (modifiers)? @method.modifiers
  type: (_) @method.return
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.decl

;; Fields
(field_declaration
  (modifiers)? @field.modifiers
  type: (_) @field.type
  declarator: (variable_declarator name: (identifier) @field.name)) @field.decl
```

- [ ] **Step 5: Implement `src/analyzers/java/code.ts`**

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember, RawCodeReference } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuery: string | null = null;
async function getQuery(): Promise<string> {
  if (cachedQuery) return cachedQuery;
  cachedQuery = await fs.readFile(
    path.join(__dirname, "queries", "code.scm"),
    "utf-8",
  );
  return cachedQuery;
}

export async function extractJavaCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("java", source, query);

  // Group captures by their declaration node id to assemble one RawCodeElement per decl.
  const byDecl = new Map<
    number,
    { kind: string; captures: (typeof matches)[0]["captures"] }
  >();

  for (const m of matches) {
    const decl = m.captures.find(
      (c) =>
        c.name === "class.decl" ||
        c.name === "interface.decl" ||
        c.name === "enum.decl",
    );
    if (!decl) continue;
    const kind =
      decl.name === "class.decl"
        ? "class"
        : decl.name === "interface.decl"
          ? "interface"
          : "enum";
    byDecl.set(decl.node.id, { kind, captures: m.captures });
  }

  // Members attach to their enclosing class/interface declaration by ancestor walk.
  const elements: RawCodeElement[] = [];
  for (const [, entry] of byDecl) {
    const nameCap = entry.captures.find((c) => c.name.endsWith(".name"));
    if (!nameCap) continue;
    const declCap = entry.captures.find((c) => c.name.endsWith(".decl"))!;
    const id = nameCap.node.text;

    const references: RawCodeReference[] = [];
    for (const c of entry.captures) {
      if (c.name === "class.extends") {
        references.push({ targetName: c.node.text, kind: "extends" });
      } else if (
        c.name === "class.implements" ||
        c.name === "interface.extends"
      ) {
        references.push({
          targetName: c.node.text,
          kind: c.name === "interface.extends" ? "extends" : "implements",
        });
      }
    }

    const members = collectMembers(declCap.node);
    const element: RawCodeElement = {
      id,
      name: id,
      kind: entry.kind,
      visibility: inferVisibility(declCap.node),
      members: members.length > 0 ? members : undefined,
      references: references.length > 0 ? references : undefined,
      location: {
        file: filePath,
        line: declCap.node.startPosition.row + 1,
      },
    };
    elements.push(element);
  }
  return elements;
}

function collectMembers(declNode: any): CodeMember[] {
  const members: CodeMember[] = [];
  // Walk direct children; for each method_declaration / field_declaration record a CodeMember.
  for (const child of declNode.namedChildren ?? []) {
    if (child.type === "class_body" || child.type === "interface_body") {
      for (const bodyChild of child.namedChildren ?? []) {
        if (bodyChild.type === "method_declaration") {
          const name = bodyChild.childForFieldName("name")?.text ?? "?";
          const params =
            bodyChild.childForFieldName("parameters")?.text ?? "()";
          const ret = bodyChild.childForFieldName("type")?.text ?? "void";
          members.push({
            name,
            kind: "method",
            signature: `${name}${params}: ${ret}`,
            visibility: inferVisibility(bodyChild),
          });
        } else if (bodyChild.type === "field_declaration") {
          const declarator = bodyChild.childForFieldName("declarator");
          const fieldName = declarator?.childForFieldName("name")?.text ?? "?";
          const type = bodyChild.childForFieldName("type")?.text ?? "?";
          members.push({
            name: fieldName,
            kind: "field",
            signature: `${fieldName}: ${type}`,
            visibility: inferVisibility(bodyChild),
          });
        }
      }
    }
  }
  return members;
}

function inferVisibility(node: any): "public" | "internal" | "private" {
  const modText =
    (node.namedChildren ?? []).find((c: any) => c.type === "modifiers")?.text ??
    "";
  if (modText.includes("public")) return "public";
  if (modText.includes("private")) return "private";
  return "internal";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/java-code.test.ts`
Expected: PASS on all four tests. If the tree-sitter query text is rejected, inspect the error and correct the query syntax — tree-sitter query errors come back with a line/column offset.

- [ ] **Step 7: Commit**

```bash
git add src/analyzers/java/code.ts src/analyzers/java/queries/code.scm tests/analyzers/java-code.test.ts tests/fixtures/code-level/java/
git commit -m "feat: extract Java code elements via tree-sitter"
```

---

### Task 7: TypeScript code extraction

**Files:**

- Create: `src/analyzers/typescript/queries/code.scm`
- Create: `src/analyzers/typescript/code.ts`
- Create: `tests/analyzers/typescript-code.test.ts`
- Create: `tests/fixtures/code-level/typescript/user.ts`

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/code-level/typescript/user.ts`:

```typescript
export interface Auditable {
  getAuditLog(): string;
}

export type Id = string;

export class User {
  constructor(private readonly name: string) {}
  getName(): string {
    return this.name;
  }
}

export class UserService implements Auditable {
  private users: User[] = [];
  public findByName(name: string): User | undefined {
    return undefined;
  }
  getAuditLog(): string {
    return "";
  }
}

export function formatUser(u: User): string {
  return u.getName();
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/analyzers/typescript-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractTypeScriptCode } from "../../src/analyzers/typescript/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/typescript/user.ts",
);

describe("typescript code extraction", () => {
  it("extracts classes, interfaces, type aliases, and module-level functions", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractTypeScriptCode(FIXTURE, source);
    const names = els.map((e) => e.name).sort();
    expect(names).toEqual([
      "Auditable",
      "Id",
      "User",
      "UserService",
      "formatUser",
    ]);
  });

  it("tags kinds correctly", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractTypeScriptCode(FIXTURE, source);
    const kinds = Object.fromEntries(els.map((e) => [e.name, e.kind]));
    expect(kinds).toMatchObject({
      Auditable: "interface",
      Id: "type",
      User: "class",
      UserService: "class",
      formatUser: "function",
    });
  });

  it("captures implements edges", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractTypeScriptCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([{ targetName: "Auditable", kind: "implements" }]),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/typescript-code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create the tree-sitter query**

Create `src/analyzers/typescript/queries/code.scm`:

```scheme
(class_declaration
  name: (type_identifier) @class.name
  (class_heritage
    (extends_clause (type_identifier) @class.extends)?
    (implements_clause (type_identifier) @class.implements)?)?) @class.decl

(interface_declaration
  name: (type_identifier) @interface.name
  (extends_type_clause (type_identifier) @interface.extends)?) @interface.decl

(type_alias_declaration
  name: (type_identifier) @type.name) @type.decl

(function_declaration
  name: (identifier) @fn.name
  parameters: (formal_parameters) @fn.params
  return_type: (type_annotation)? @fn.return) @fn.decl
```

- [ ] **Step 5: Implement `src/analyzers/typescript/code.ts`**

Mirror the Java code structure (imports, `getQuery()`, match grouping). Key differences:

- Supported kinds: `class`, `interface`, `type`, `function`.
- Module-level `function_declaration` → top-level `RawCodeElement` with kind `"function"` and no `parentId`.
- Access modifiers (`public`/`protected`/`private`) come from member-level `accessibility_modifier` syntax nodes rather than class-level modifiers.
- Strip generics from signatures by using `childForFieldName("parameters")` and return type nodes without their type parameters.

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember, RawCodeReference } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuery: string | null = null;
async function getQuery(): Promise<string> {
  if (cachedQuery) return cachedQuery;
  cachedQuery = await fs.readFile(
    path.join(__dirname, "queries", "code.scm"),
    "utf-8",
  );
  return cachedQuery;
}

export async function extractTypeScriptCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("typescript", source, query);

  const elements: RawCodeElement[] = [];

  for (const m of matches) {
    const decl = m.captures.find((c) => c.name.endsWith(".decl"));
    if (!decl) continue;

    const kindMap: Record<string, string> = {
      "class.decl": "class",
      "interface.decl": "interface",
      "type.decl": "type",
      "fn.decl": "function",
    };
    const kind = kindMap[decl.name];
    const nameCap = m.captures.find((c) => c.name.endsWith(".name"));
    if (!nameCap) continue;
    const name = nameCap.node.text;

    const references: RawCodeReference[] = [];
    for (const c of m.captures) {
      if (c.name === "class.extends" || c.name === "interface.extends") {
        references.push({ targetName: c.node.text, kind: "extends" });
      } else if (c.name === "class.implements") {
        references.push({ targetName: c.node.text, kind: "implements" });
      }
    }

    const members =
      kind === "class" || kind === "interface"
        ? collectTsMembers(decl.node)
        : [];

    elements.push({
      id: name,
      name,
      kind,
      visibility: "public", // exported elements; access modifiers tracked per-member
      members: members.length > 0 ? members : undefined,
      references: references.length > 0 ? references : undefined,
      location: { file: filePath, line: decl.node.startPosition.row + 1 },
    });
  }
  return elements;
}

function collectTsMembers(node: any): CodeMember[] {
  const members: CodeMember[] = [];
  const body = node.namedChildren?.find(
    (c: any) =>
      c.type === "class_body" ||
      c.type === "interface_body" ||
      c.type === "object_type",
  );
  if (!body) return members;

  for (const child of body.namedChildren ?? []) {
    if (
      child.type === "method_definition" ||
      child.type === "method_signature"
    ) {
      const name = child.childForFieldName("name")?.text ?? "?";
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const ret = child.childForFieldName("return_type")?.text ?? "";
      members.push({
        name,
        kind: "method",
        signature: `${name}${params}${ret}`,
        visibility: tsVisibility(child),
      });
    } else if (
      child.type === "public_field_definition" ||
      child.type === "property_signature"
    ) {
      const name = child.childForFieldName("name")?.text ?? "?";
      const type = child.childForFieldName("type")?.text ?? "";
      members.push({
        name,
        kind: "field",
        signature: type ? `${name}${type}` : name,
        visibility: tsVisibility(child),
      });
    }
  }
  return members;
}

function tsVisibility(node: any): "public" | "internal" | "private" {
  const modifier = (node.namedChildren ?? []).find(
    (c: any) => c.type === "accessibility_modifier",
  )?.text;
  if (modifier === "private") return "private";
  if (modifier === "protected") return "internal";
  return "public";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/typescript-code.test.ts`
Expected: PASS. If the tree-sitter TypeScript grammar's `class_heritage` node shape differs (between v0.20.x and v0.21.x), adjust the query by inspecting `grammar.nodeTypeCount` output from a REPL.

- [ ] **Step 7: Commit**

```bash
git add src/analyzers/typescript/ tests/analyzers/typescript-code.test.ts tests/fixtures/code-level/typescript/
git commit -m "feat: extract TypeScript code elements via tree-sitter"
```

---

### Task 8: Python code extraction

**Files:**

- Create: `src/analyzers/python/queries/code.scm`
- Create: `src/analyzers/python/code.ts`
- Create: `tests/analyzers/python-code.test.ts`
- Create: `tests/fixtures/code-level/python/user_service.py`

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/code-level/python/user_service.py`:

```python
from typing import List

class User:
    def __init__(self, name: str):
        self.name = name
    def get_name(self) -> str:
        return self.name

class UserService(User):
    def __init__(self, users: List[User]):
        self.users = users
    def find_by_name(self, name: str) -> User:
        return None

def format_user(u: User) -> str:
    return u.get_name()

def _internal_helper():
    pass
```

- [ ] **Step 2: Write the failing test**

Create `tests/analyzers/python-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractPythonCode } from "../../src/analyzers/python/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/python/user_service.py",
);

describe("python code extraction", () => {
  it("extracts classes and module-level functions", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const names = els.map((e) => e.name).sort();
    expect(names).toEqual([
      "User",
      "UserService",
      "_internal_helper",
      "format_user",
    ]);
  });

  it("captures base-class references as extends", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([{ targetName: "User", kind: "extends" }]),
    );
  });

  it("marks leading-underscore names as private", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const helper = els.find((e) => e.name === "_internal_helper")!;
    expect(helper.visibility).toBe("private");
  });

  it("captures typed method signatures on classes", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const user = els.find((e) => e.name === "User")!;
    const memberNames = (user.members ?? []).map((m) => m.name).sort();
    expect(memberNames).toEqual(
      expect.arrayContaining(["__init__", "get_name"]),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/python-code.test.ts`
Expected: FAIL.

- [ ] **Step 4: Create the tree-sitter query**

Create `src/analyzers/python/queries/code.scm`:

```scheme
(class_definition
  name: (identifier) @class.name
  superclasses: (argument_list (identifier) @class.base)?) @class.decl

(module
  (function_definition
    name: (identifier) @fn.name
    parameters: (parameters) @fn.params
    return_type: (type)? @fn.return) @fn.decl)
```

- [ ] **Step 5: Implement `src/analyzers/python/code.ts`**

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember, RawCodeReference } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuery: string | null = null;
async function getQuery(): Promise<string> {
  if (cachedQuery) return cachedQuery;
  cachedQuery = await fs.readFile(
    path.join(__dirname, "queries", "code.scm"),
    "utf-8",
  );
  return cachedQuery;
}

export async function extractPythonCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("python", source, query);

  const elements: RawCodeElement[] = [];
  for (const m of matches) {
    const decl = m.captures.find(
      (c) => c.name === "class.decl" || c.name === "fn.decl",
    );
    if (!decl) continue;
    const nameCap = m.captures.find(
      (c) => c.name === "class.name" || c.name === "fn.name",
    );
    if (!nameCap) continue;
    const name = nameCap.node.text;
    const kind = decl.name === "class.decl" ? "class" : "function";

    const references: RawCodeReference[] = [];
    for (const c of m.captures) {
      if (c.name === "class.base") {
        references.push({ targetName: c.node.text, kind: "extends" });
      }
    }

    const members = kind === "class" ? collectPythonMembers(decl.node) : [];

    elements.push({
      id: name,
      name,
      kind,
      visibility: name.startsWith("_") ? "private" : "public",
      members: members.length > 0 ? members : undefined,
      references: references.length > 0 ? references : undefined,
      location: { file: filePath, line: decl.node.startPosition.row + 1 },
    });
  }
  return elements;
}

function collectPythonMembers(classNode: any): CodeMember[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];
  const members: CodeMember[] = [];
  for (const child of body.namedChildren ?? []) {
    if (child.type === "function_definition") {
      const name = child.childForFieldName("name")?.text ?? "?";
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const ret = child.childForFieldName("return_type")?.text;
      members.push({
        name,
        kind: "method",
        signature: ret ? `${name}${params} -> ${ret}` : `${name}${params}`,
        visibility: name.startsWith("_") ? "private" : "public",
      });
    }
  }
  return members;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/python-code.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/analyzers/python/ tests/analyzers/python-code.test.ts tests/fixtures/code-level/python/
git commit -m "feat: extract Python code elements via tree-sitter"
```

---

### Task 9: C code extraction

**Files:**

- Create: `src/analyzers/c/queries/code.scm`
- Create: `src/analyzers/c/code.ts`
- Create: `tests/analyzers/c-code.test.ts`
- Create: `tests/fixtures/code-level/c/hash_table.h`
- Create: `tests/fixtures/code-level/c/hash_table.c`

- [ ] **Step 1: Create fixtures**

Create `tests/fixtures/code-level/c/hash_table.h`:

```c
#ifndef HASH_TABLE_H
#define HASH_TABLE_H

#include <stddef.h>

typedef struct hash_entry hash_entry_t;
typedef struct hash_table hash_table_t;

struct hash_entry {
    const char *key;
    void *value;
    hash_entry_t *next;
};

struct hash_table {
    hash_entry_t **entries;
    size_t count;
    size_t capacity;
};

hash_table_t *hash_create(size_t capacity);
void hash_insert(hash_table_t *t, const char *key, void *value);
void *hash_lookup(hash_table_t *t, const char *key);
void hash_destroy(hash_table_t *t);

#endif
```

Create `tests/fixtures/code-level/c/hash_table.c`:

```c
#include "hash_table.h"
#include <stdlib.h>
#include <string.h>

static size_t bucket_index(hash_table_t *t, const char *key) {
    return strlen(key) % t->capacity;
}

static void rehash(hash_table_t *t) {
    /* ... */
}

hash_table_t *hash_create(size_t capacity) { return NULL; }
void hash_insert(hash_table_t *t, const char *key, void *value) { (void)rehash; (void)bucket_index; }
void *hash_lookup(hash_table_t *t, const char *key) { return NULL; }
void hash_destroy(hash_table_t *t) { }
```

- [ ] **Step 2: Write the failing test**

Create `tests/analyzers/c-code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractCCode } from "../../src/analyzers/c/code.js";

const H = path.resolve(__dirname, "../fixtures/code-level/c/hash_table.h");
const C = path.resolve(__dirname, "../fixtures/code-level/c/hash_table.c");

describe("c code extraction", () => {
  it("extracts structs, typedefs, and functions from a header", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const names = els.map((e) => e.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "hash_entry",
        "hash_table",
        "hash_create",
        "hash_destroy",
        "hash_insert",
        "hash_lookup",
      ]),
    );
  });

  it("marks static functions as private", async () => {
    const els = await extractCCode(C, fs.readFileSync(C, "utf-8"));
    const rehash = els.find((e) => e.name === "rehash")!;
    expect(rehash.visibility).toBe("private");
  });

  it("marks extern (non-static) functions as public", async () => {
    const els = await extractCCode(C, fs.readFileSync(C, "utf-8"));
    const insert = els.find((e) => e.name === "hash_insert")!;
    expect(insert.visibility).toBe("public");
  });

  it("records struct fields as members", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const table = els.find(
      (e) => e.name === "hash_table" && e.kind === "struct",
    )!;
    const fieldNames = (table.members ?? []).map((m) => m.name).sort();
    expect(fieldNames).toEqual(["capacity", "count", "entries"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/analyzers/c-code.test.ts`
Expected: FAIL.

- [ ] **Step 4: Create the tree-sitter query**

Create `src/analyzers/c/queries/code.scm`:

```scheme
(struct_specifier
  name: (type_identifier) @struct.name
  body: (field_declaration_list)) @struct.decl

(type_definition
  declarator: (type_identifier) @typedef.name) @typedef.decl

(function_definition
  (storage_class_specifier)? @fn.storage
  declarator: (function_declarator
    declarator: (identifier) @fn.name)) @fn.decl

(declaration
  declarator: (function_declarator
    declarator: (identifier) @decl.name)) @decl.fn
```

- [ ] **Step 5: Implement `src/analyzers/c/code.ts`**

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuery: string | null = null;
async function getQuery(): Promise<string> {
  if (cachedQuery) return cachedQuery;
  cachedQuery = await fs.readFile(
    path.join(__dirname, "queries", "code.scm"),
    "utf-8",
  );
  return cachedQuery;
}

export async function extractCCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("c", source, query);

  const seen = new Map<string, RawCodeElement>();
  for (const m of matches) {
    const structDecl = m.captures.find((c) => c.name === "struct.decl");
    const typedefDecl = m.captures.find((c) => c.name === "typedef.decl");
    const fnDef = m.captures.find((c) => c.name === "fn.decl");
    const fnPrototype = m.captures.find((c) => c.name === "decl.fn");

    if (structDecl) {
      const nameCap = m.captures.find((c) => c.name === "struct.name")!;
      const name = nameCap.node.text;
      if (seen.has(name)) continue;
      seen.set(name, {
        id: name,
        name,
        kind: "struct",
        visibility: "public",
        members: collectStructFields(structDecl.node),
        location: {
          file: filePath,
          line: structDecl.node.startPosition.row + 1,
        },
      });
    } else if (typedefDecl) {
      const name = m.captures.find((c) => c.name === "typedef.name")!.node.text;
      if (seen.has(name)) continue;
      seen.set(name, {
        id: name,
        name,
        kind: "typedef",
        visibility: "public",
        location: {
          file: filePath,
          line: typedefDecl.node.startPosition.row + 1,
        },
      });
    } else if (fnDef) {
      const name = m.captures.find((c) => c.name === "fn.name")!.node.text;
      const storageCap = m.captures.find((c) => c.name === "fn.storage");
      const isStatic = storageCap?.node.text === "static";
      const existing = seen.get(name);
      // A static definition overrides any earlier non-static prototype in the same file.
      if (!existing || (existing.visibility === "public" && isStatic)) {
        seen.set(name, {
          id: name,
          name,
          kind: "function",
          visibility: isStatic ? "private" : "public",
          location: { file: filePath, line: fnDef.node.startPosition.row + 1 },
        });
      }
    } else if (fnPrototype) {
      const name = m.captures.find((c) => c.name === "decl.name")!.node.text;
      if (!seen.has(name)) {
        seen.set(name, {
          id: name,
          name,
          kind: "function",
          visibility: "public",
          location: {
            file: filePath,
            line: fnPrototype.node.startPosition.row + 1,
          },
        });
      }
    }
  }

  return Array.from(seen.values());
}

function collectStructFields(structNode: any): CodeMember[] {
  const body = structNode.childForFieldName("body");
  if (!body) return [];
  const members: CodeMember[] = [];
  for (const child of body.namedChildren ?? []) {
    if (child.type !== "field_declaration") continue;
    const declarator = child.childForFieldName("declarator");
    const name = declarator?.text?.replace(/^\*+/, "") ?? "?";
    const type = child.childForFieldName("type")?.text ?? "?";
    members.push({ name, kind: "field", signature: `${name}: ${type}` });
  }
  return members;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/analyzers/c-code.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/analyzers/c/ tests/analyzers/c-code.test.ts tests/fixtures/code-level/c/
git commit -m "feat: extract C code elements via tree-sitter"
```

---

## Phase 4: Analyzer wiring

### Task 10: Wire `extractCode()` calls into each analyzer's `analyze()` method

**Files:**

- Modify: `src/analyzers/java/index.ts` (lines around 73–112)
- Modify: `src/analyzers/typescript/index.ts` (lines around 111–172)
- Modify: `src/analyzers/python/index.ts` (lines around 86–123)
- Modify: `src/analyzers/c/index.ts` (lines around 37–82)
- Test: `tests/analyzers/java.test.ts` (add code-level assertion)
- Test: `tests/analyzers/typescript.test.ts` (add code-level assertion)
- Test: `tests/analyzers/python.test.ts` (add code-level assertion)
- Test: `tests/analyzers/c.test.ts` (add code-level assertion)

- [ ] **Step 1: Write the failing test (Java)**

Add to `tests/analyzers/java.test.ts`:

```typescript
it("populates codeElements on each module when levels.code is on", async () => {
  const result = await javaAnalyzer.analyze(FIXTURES, {
    ...defaultConfig,
    levels: { context: true, container: true, component: true, code: true },
    code: { includePrivate: false, includeMembers: true, minElements: 2 },
  });
  const anyModuleHasCode = result.modules.some(
    (m) => m.codeElements && m.codeElements.length > 0,
  );
  expect(anyModuleHasCode).toBe(true);
});

it("omits codeElements when levels.code is off", async () => {
  const result = await javaAnalyzer.analyze(FIXTURES, defaultConfig);
  for (const m of result.modules) {
    expect(m.codeElements).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/analyzers/java.test.ts`
Expected: FAIL — `codeElements` undefined when `levels.code: true`.

- [ ] **Step 3: Modify `src/analyzers/java/index.ts`**

At the top:

```typescript
import { extractJavaCode } from "./code.js";
```

Inside `analyze()`, after each `ScannedModule` is fully constructed and before `modules.push(module)`:

```typescript
if (config.levels?.code) {
  const allElements: RawCodeElement[] = [];
  for (const file of module.files.filter((f) => f.endsWith(".java"))) {
    const source = await fs.promises.readFile(file, "utf-8");
    const elements = await extractJavaCode(file, source);
    allElements.push(...elements);
  }
  if (allElements.length > 0) module.codeElements = allElements;
}
```

(Import `RawCodeElement` from `../types.js` and `fs` at the top if not already.)

- [ ] **Step 4: Apply the same pattern to TypeScript, Python, C analyzers**

For each analyzer, the call site and imports are:

- `src/analyzers/typescript/index.ts`: import `extractTypeScriptCode`; filter files by `.ts|.tsx` (exclude `.d.ts`).
- `src/analyzers/python/index.ts`: import `extractPythonCode`; filter files by `.py`.
- `src/analyzers/c/index.ts`: import `extractCCode`; filter files by `.c|.h`; **deduplicate by name within a module** to collapse `.h`/`.c` pairs (last write wins via map).

Dedup snippet for C (after collecting `allElements`):

```typescript
const dedup = new Map<string, RawCodeElement>();
for (const e of allElements) dedup.set(e.name, e);
if (dedup.size > 0) module.codeElements = Array.from(dedup.values());
```

- [ ] **Step 5: Run all analyzer tests**

Run: `npx vitest run tests/analyzers/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/analyzers/ tests/analyzers/
git commit -m "feat: gate code extraction on config.levels.code in all analyzers"
```

---

## Phase 5: Model building

### Task 11: Implement `buildCodeModel()` — collection + qualified IDs

**Files:**

- Create: `src/core/code-model.ts`
- Test: `tests/core/code-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/code-model.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";
import type {
  RawStructure,
  Component,
  Config,
} from "../../src/analyzers/types.js";

const baseConfig: Pick<Config, "levels" | "code"> = {
  levels: { context: true, container: true, component: true, code: true },
  code: { includePrivate: false, includeMembers: true, minElements: 2 },
};

const raw: RawStructure = {
  applications: [
    {
      id: "api",
      name: "api",
      language: "java",
      path: "/tmp/api",
      modules: [
        {
          id: "users",
          path: "/tmp/api/users",
          name: "users",
          files: ["UserService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "UserService",
              name: "UserService",
              kind: "class",
              visibility: "public",
              references: [{ targetName: "Auditable", kind: "implements" }],
              location: { file: "UserService.java", line: 1 },
            },
            {
              id: "Auditable",
              name: "Auditable",
              kind: "interface",
              visibility: "public",
              location: { file: "UserService.java", line: 1 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;

const components: Component[] = [
  {
    id: "users",
    containerId: "api",
    name: "users",
    description: "",
    technology: "",
    moduleIds: ["users"],
  } as any,
];

describe("buildCodeModel", () => {
  it("assigns qualified IDs rooted in containerId.componentId", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig as any);
    const ids = codeElements.map((e) => e.id).sort();
    expect(ids).toEqual(["api.users.Auditable", "api.users.UserService"]);
  });

  it("preserves componentId reference", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig as any);
    for (const el of codeElements) expect(el.componentId).toBe("users");
  });

  it("resolves same-component references into codeRelationships", () => {
    const { codeRelationships } = buildCodeModel(
      raw,
      components,
      baseConfig as any,
    );
    expect(codeRelationships).toEqual([
      {
        sourceId: "api.users.UserService",
        targetId: "api.users.Auditable",
        kind: "implements",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/core/code-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/code-model.ts`**

```typescript
import type {
  RawStructure,
  Component,
  Config,
  CodeElement,
  CodeRelationship,
  RawCodeElement,
  RawCodeReference,
} from "../analyzers/types.js";

export interface BuildCodeModelResult {
  codeElements: CodeElement[];
  codeRelationships: CodeRelationship[];
}

export function buildCodeModel(
  raw: RawStructure,
  components: Component[],
  config: Pick<Config, "levels" | "code">,
): BuildCodeModelResult {
  if (!config.levels?.code) {
    return { codeElements: [], codeRelationships: [] };
  }

  const includePrivate = config.code?.includePrivate ?? false;
  const minElements = config.code?.minElements ?? 2;

  // module.id -> { containerId, componentId }
  const moduleOwnership = new Map<
    string,
    { containerId: string; componentId: string }
  >();
  for (const comp of components) {
    for (const moduleId of comp.moduleIds ?? []) {
      moduleOwnership.set(moduleId, {
        containerId: comp.containerId,
        componentId: comp.id,
      });
    }
  }

  const elements: CodeElement[] = [];
  const rawByLocal = new Map<
    string,
    { qualified: string; componentId: string }
  >();

  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        if (!includePrivate && re.visibility !== "public") continue;
        const qualified = `${owner.containerId}.${owner.componentId}.${re.id}`;
        elements.push({
          id: qualified,
          componentId: owner.componentId,
          kind: re.kind,
          name: re.name,
          visibility: re.visibility,
          parentElementId: re.parentId
            ? `${owner.containerId}.${owner.componentId}.${re.parentId}`
            : undefined,
          members: includePrivate
            ? re.members
            : re.members?.filter((m) => m.visibility !== "private"),
          tags: re.tags,
        });
        rawByLocal.set(`${owner.componentId}:${re.name}`, {
          qualified,
          componentId: owner.componentId,
        });
      }
    }
  }

  // Apply minElements threshold per component.
  const countByComponent = new Map<string, number>();
  for (const el of elements) {
    countByComponent.set(
      el.componentId,
      (countByComponent.get(el.componentId) ?? 0) + 1,
    );
  }
  const filteredElements = elements.filter(
    (el) => (countByComponent.get(el.componentId) ?? 0) >= minElements,
  );
  const keepIds = new Set(filteredElements.map((e) => e.id));

  // Resolve references.
  const relationships: CodeRelationship[] = [];
  for (const app of raw.applications) {
    for (const mod of app.modules) {
      const owner = moduleOwnership.get(mod.id);
      if (!owner) continue;
      for (const re of mod.codeElements ?? []) {
        const sourceQualified = `${owner.containerId}.${owner.componentId}.${re.id}`;
        if (!keepIds.has(sourceQualified)) continue;
        for (const ref of re.references ?? []) {
          const resolved = resolveReference(ref, owner, elements);
          if (!resolved) continue;
          relationships.push({
            sourceId: sourceQualified,
            targetId: resolved,
            kind: mapReferenceKind(ref.kind),
          });
        }
      }
    }
  }

  return {
    codeElements: filteredElements,
    codeRelationships: relationships,
  };
}

function resolveReference(
  ref: RawCodeReference,
  owner: { containerId: string; componentId: string },
  allElements: CodeElement[],
): string | null {
  // Same-component match first.
  const sameComponent = allElements.find(
    (e) => e.componentId === owner.componentId && e.name === ref.targetName,
  );
  if (sameComponent) return sameComponent.id;
  // Cross-component same-container match next.
  const sameContainer = allElements.find(
    (e) =>
      e.id.startsWith(`${owner.containerId}.`) && e.name === ref.targetName,
  );
  if (sameContainer) return sameContainer.id;
  return null;
}

function mapReferenceKind(
  k: RawCodeReference["kind"],
): CodeRelationship["kind"] {
  switch (k) {
    case "extends":
      return "inherits";
    case "implements":
      return "implements";
    case "uses":
      return "uses";
    case "contains":
      return "contains";
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run tests/core/code-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/code-model.ts tests/core/code-model.test.ts
git commit -m "feat: build code model with qualified IDs and relationship resolution"
```

---

### Task 12: Wire `buildCodeModel()` into `buildModel()`

**Files:**

- Modify: `src/core/model-builder.ts`
- Test: `tests/core/model-builder.test.ts` (add case)

- [ ] **Step 1: Extract the fixture from `code-model.test.ts` into a shared helper**

Create `tests/core/fixtures/code-model-fixture.ts`:

```typescript
import type {
  RawStructure,
  Component,
  Config,
} from "../../../src/analyzers/types.js";

export const codeFixture: RawStructure = {
  applications: [
    {
      id: "api",
      name: "api",
      language: "java",
      path: "/tmp/api",
      modules: [
        {
          id: "users",
          path: "/tmp/api/users",
          name: "users",
          files: ["UserService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "UserService",
              name: "UserService",
              kind: "class",
              visibility: "public",
              references: [{ targetName: "Auditable", kind: "implements" }],
              location: { file: "UserService.java", line: 1 },
            },
            {
              id: "Auditable",
              name: "Auditable",
              kind: "interface",
              visibility: "public",
              location: { file: "UserService.java", line: 1 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;

export const codeFixtureComponents: Component[] = [
  {
    id: "users",
    containerId: "api",
    name: "users",
    description: "",
    technology: "",
    moduleIds: ["users"],
  } as any,
];

export function makeConfig(codeOn: boolean): Config {
  return {
    system: { name: "s", description: "" },
    levels: { context: true, container: true, component: true, code: codeOn },
    code: { includePrivate: false, includeMembers: true, minElements: 2 },
    abstraction: { granularity: "balanced", excludePatterns: [] },
    // Fill remaining required fields by matching the actual Config shape at review time.
  } as any;
}
```

Update `tests/core/code-model.test.ts` to import `codeFixture`, `codeFixtureComponents`, and `makeConfig` from this helper instead of defining them inline. Run its tests and confirm PASS.

- [ ] **Step 2: Write the failing tests**

Add to `tests/core/model-builder.test.ts`:

```typescript
import {
  codeFixture,
  codeFixtureComponents,
  makeConfig,
} from "./fixtures/code-model-fixture.js";

it("attaches codeElements and codeRelationships when levels.code is on", () => {
  const model = buildModel({
    config: makeConfig(true),
    rawStructure: codeFixture,
  });
  expect(model.codeElements).toBeDefined();
  expect(model.codeElements!.length).toBeGreaterThan(0);
  expect(model.codeRelationships!.length).toBeGreaterThan(0);
});

it("does not populate codeElements when levels.code is off", () => {
  const model = buildModel({
    config: makeConfig(false),
    rawStructure: codeFixture,
  });
  expect(model.codeElements ?? []).toEqual([]);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/core/model-builder.test.ts -t "code"`
Expected: FAIL.

- [ ] **Step 4: Modify `src/core/model-builder.ts`**

At the top:

```typescript
import { buildCodeModel } from "./code-model.js";
```

In `buildModel()`, after the component-building loop completes and before the return statement, add:

```typescript
const { codeElements, codeRelationships } = buildCodeModel(
  rawStructure,
  components,
  { levels: config.levels, code: config.code },
);
```

In the returned `ArchitectureModel`, add the two new fields:

```typescript
return {
  // ... existing fields
  codeElements: codeElements.length > 0 ? codeElements : undefined,
  codeRelationships:
    codeRelationships.length > 0 ? codeRelationships : undefined,
};
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/core/model-builder.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/model-builder.ts tests/core/
git commit -m "feat: attach code-level data to ArchitectureModel in buildModel"
```

---

## Phase 6: Generator

### Task 13: Generator skeleton + `LanguageRenderingProfile` interface

**Files:**

- Create: `src/generator/d2/code.ts`
- Create: `src/generator/d2/code-profiles.ts`
- Test: `tests/generator/d2/code.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/generator/d2/code.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateCodeDiagram } from "../../../src/generator/d2/code.js";
import { getProfileForLanguage } from "../../../src/generator/d2/code-profiles.js";
import type {
  ArchitectureModel,
  Component,
} from "../../../src/analyzers/types.js";

const component: Component = {
  id: "users",
  containerId: "api",
  name: "users",
  description: "",
  technology: "",
  moduleIds: ["users"],
} as any;

const model: ArchitectureModel = {
  version: 1,
  system: { name: "s", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "api",
      applicationId: "api",
      name: "api",
      description: "",
      technology: "java",
    } as any,
  ],
  components: [component],
  relationships: [],
  codeElements: [
    {
      id: "api.users.User",
      componentId: "users",
      kind: "class",
      name: "User",
      visibility: "public",
    },
    {
      id: "api.users.UserService",
      componentId: "users",
      kind: "class",
      name: "UserService",
      visibility: "public",
    },
    {
      id: "api.users.Auditable",
      componentId: "users",
      kind: "interface",
      name: "Auditable",
      visibility: "public",
    },
  ],
  codeRelationships: [
    {
      sourceId: "api.users.UserService",
      targetId: "api.users.Auditable",
      kind: "implements",
    },
  ],
} as any;

describe("generateCodeDiagram", () => {
  it("renders a D2 diagram containing element names and relationships", () => {
    const d2 = generateCodeDiagram(
      model,
      component,
      getProfileForLanguage("java"),
    );
    expect(d2).toContain("User");
    expect(d2).toContain("UserService");
    expect(d2).toContain("Auditable");
    expect(d2).toContain("implements");
  });

  it("produces byte-identical output on repeat invocation (stability)", () => {
    const a = generateCodeDiagram(
      model,
      component,
      getProfileForLanguage("java"),
    );
    const b = generateCodeDiagram(
      model,
      component,
      getProfileForLanguage("java"),
    );
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/generator/d2/code.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the skeleton in `src/generator/d2/code.ts`**

```typescript
import { D2Writer } from "./writer.js";
import { toD2Id, sortById, sortRelationships } from "./stability.js";
import type {
  ArchitectureModel,
  Component,
  CodeElement,
  CodeRelationship,
} from "../../analyzers/types.js";

export interface LanguageRenderingProfile {
  renderHeader(w: D2Writer, component: Component): void;
  renderElements(w: D2Writer, elements: CodeElement[]): void;
  renderExternalRefs(
    w: D2Writer,
    externalRels: CodeRelationship[],
    elements: CodeElement[],
  ): void;
  renderRelationships(w: D2Writer, relationships: CodeRelationship[]): void;
}

export function generateCodeDiagram(
  model: ArchitectureModel,
  component: Component,
  profile: LanguageRenderingProfile,
): string {
  const w = new D2Writer();
  const elements = sortById(
    (model.codeElements ?? []).filter((e) => e.componentId === component.id),
  );
  const elementIds = new Set(elements.map((e) => e.id));
  const rels = sortRelationships(model.codeRelationships ?? []);
  const internal: CodeRelationship[] = [];
  const external: CodeRelationship[] = [];
  for (const r of rels) {
    if (!elementIds.has(r.sourceId)) continue;
    if (elementIds.has(r.targetId)) internal.push(r);
    else external.push(r);
  }

  w.comment(`C4 Code-level diagram for component '${component.name}'`);
  w.comment("Generated by diagram-docs — do not edit");
  w.blank();
  profile.renderHeader(w, component);
  profile.renderElements(w, elements);
  profile.renderExternalRefs(w, external, elements);
  profile.renderRelationships(w, [...internal, ...external]);
  return w.toString();
}

// Re-export toD2Id for profiles to use for D2-safe identifiers.
export { toD2Id };
```

- [ ] **Step 4: Implement minimum profile in `src/generator/d2/code-profiles.ts`**

Start with a placeholder profile that compiles and produces names:

```typescript
import { D2Writer } from "./writer.js";
import { toD2Id } from "./stability.js";
import type {
  Component,
  CodeElement,
  CodeRelationship,
} from "../../analyzers/types.js";
import type { LanguageRenderingProfile } from "./code.js";

export type ProfileLanguage = "java" | "typescript" | "python" | "c";

export function getProfileForLanguage(
  lang: ProfileLanguage,
): LanguageRenderingProfile {
  return lang === "c" ? cProfile : javaTsPyProfile;
}

const javaTsPyProfile: LanguageRenderingProfile = {
  renderHeader(w, component) {
    w.comment(`Component: ${component.name}`);
    w.blank();
  },
  renderElements(w, elements) {
    for (const el of elements) {
      w.shape(toD2Id(el.id), el.name, { shape: "class" });
      // Members will be added in Task 14.
    }
  },
  renderExternalRefs(w, externalRels, elements) {
    const seen = new Set<string>();
    for (const r of externalRels) {
      if (seen.has(r.targetId)) continue;
      seen.add(r.targetId);
      w.shape(toD2Id(r.targetId), r.targetId.split(".").pop() ?? r.targetId, {
        style: "dashed",
      });
    }
  },
  renderRelationships(w, rels) {
    for (const r of rels) {
      w.connection(toD2Id(r.sourceId), toD2Id(r.targetId), r.kind);
    }
  },
};

const cProfile: LanguageRenderingProfile = javaTsPyProfile; // replaced in Task 15
```

- [ ] **Step 5: Run test to verify pass**

Run: `npx vitest run tests/generator/d2/code.test.ts`
Expected: PASS on both tests (the second verifies determinism).

- [ ] **Step 6: Commit**

```bash
git add src/generator/d2/code.ts src/generator/d2/code-profiles.ts tests/generator/d2/code.test.ts
git commit -m "feat: add code-level D2 generator skeleton with profile interface"
```

---

### Task 14: Render class members inside `shape: class` nodes (JavaTsPy profile)

**Files:**

- Modify: `src/generator/d2/code-profiles.ts`
- Modify: `src/generator/d2/writer.ts` — add helper if needed to render class-shape with fields
- Test: add a case to `tests/generator/d2/code.test.ts`

- [ ] **Step 1: Decide on the D2 syntax for classes-with-members**

D2's `shape: class` accepts method/field sub-keys of the form:

```d2
UserService: {
  shape: class
  "findByName(name: String): User"
  "users: List<User>"
}
```

Each string inside the scope is rendered as a row in the class box. Labels can be methods (with parens) or fields (with `: Type`). Use the existing `D2Writer.container()` + `D2Writer.raw()` to emit this pattern — no new writer API needed.

- [ ] **Step 2: Write the failing test**

Add to `tests/generator/d2/code.test.ts`:

```typescript
it("emits class members inside shape:class containers", () => {
  const modelWithMembers: ArchitectureModel = {
    ...model,
    codeElements: [
      {
        id: "api.users.UserService",
        componentId: "users",
        kind: "class",
        name: "UserService",
        visibility: "public",
        members: [
          { name: "users", kind: "field", signature: "users: List<User>" },
          {
            name: "findByName",
            kind: "method",
            signature: "findByName(name: String): User",
          },
        ],
      },
    ],
    codeRelationships: [],
  } as any;
  const d2 = generateCodeDiagram(
    modelWithMembers,
    component,
    getProfileForLanguage("java"),
  );
  expect(d2).toContain("shape: class");
  expect(d2).toContain("findByName(name: String): User");
  expect(d2).toContain("users: List<User>");
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/generator/d2/code.test.ts -t "members"`
Expected: FAIL — current rendering uses `w.shape()` which doesn't emit members.

- [ ] **Step 4: Update `javaTsPyProfile.renderElements` in `code-profiles.ts`**

Replace with:

```typescript
renderElements(w, elements) {
  for (const el of elements) {
    if ((el.kind === "class" || el.kind === "interface" || el.kind === "enum" || el.kind === "type")
        && (el.members?.length ?? 0) > 0) {
      w.container(toD2Id(el.id), el.name, () => {
        w.raw("shape: class");
        for (const m of el.members ?? []) {
          w.raw(`"${escapeLabel(m.signature ?? m.name)}"`);
        }
      });
    } else {
      const shape = el.kind === "function" ? undefined : "class";
      w.shape(toD2Id(el.id), el.name, shape ? { shape } : undefined);
    }
  }
},
```

Add helper:

```typescript
function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"');
}
```

- [ ] **Step 5: Run test + all existing generator tests**

Run: `npx vitest run tests/generator/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/generator/d2/code-profiles.ts tests/generator/d2/code.test.ts
git commit -m "feat: render class members inside shape:class nodes"
```

---

### Task 15: Implement C-specific rendering profile (3 sub-scopes)

**Files:**

- Modify: `src/generator/d2/code-profiles.ts`
- Test: add a case to `tests/generator/d2/code.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/generator/d2/code.test.ts`:

```typescript
it("C profile groups types, public functions, and internal functions", () => {
  const cComponent: Component = { ...component, id: "ht" } as any;
  const cModel: ArchitectureModel = {
    ...model,
    codeElements: [
      {
        id: "lib.ht.hash_table",
        componentId: "ht",
        kind: "struct",
        name: "hash_table",
        visibility: "public",
        members: [
          {
            name: "entries",
            kind: "field",
            signature: "entries: hash_entry**",
          },
          { name: "count", kind: "field", signature: "count: size_t" },
        ],
      },
      {
        id: "lib.ht.hash_insert",
        componentId: "ht",
        kind: "function",
        name: "hash_insert",
        visibility: "public",
      },
      {
        id: "lib.ht.rehash",
        componentId: "ht",
        kind: "function",
        name: "rehash",
        visibility: "private",
      },
    ],
    codeRelationships: [],
  } as any;
  const d2 = generateCodeDiagram(
    cModel,
    cComponent,
    getProfileForLanguage("c"),
  );
  expect(d2).toMatch(/types: \{/);
  expect(d2).toMatch(/public: \{/);
  expect(d2).toMatch(/internal: \{/);
  expect(d2).toContain("hash_table");
  expect(d2).toContain("hash_insert");
  expect(d2).toContain("rehash");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/generator/d2/code.test.ts -t "C profile"`
Expected: FAIL.

- [ ] **Step 3: Implement `cProfile` in `code-profiles.ts`**

```typescript
const cProfile: LanguageRenderingProfile = {
  renderHeader(w, component) {
    w.comment(`Component: ${component.name}`);
    w.blank();
  },
  renderElements(w, elements) {
    const types = elements.filter(
      (e) => e.kind === "struct" || e.kind === "typedef",
    );
    const publicFns = elements.filter(
      (e) => e.kind === "function" && e.visibility !== "private",
    );
    const internalFns = elements.filter(
      (e) => e.kind === "function" && e.visibility === "private",
    );

    if (types.length > 0) {
      w.container("types", "Types", () => {
        for (const el of types) {
          w.container(toD2Id(el.id), el.name, () => {
            w.raw("shape: class");
            for (const m of el.members ?? []) {
              w.raw(`"${(m.signature ?? m.name).replace(/"/g, '\\"')}"`);
            }
          });
        }
      });
    }
    if (publicFns.length > 0) {
      w.container("public", "Public API", () => {
        for (const el of publicFns) w.shape(toD2Id(el.id), el.name);
      });
    }
    if (internalFns.length > 0) {
      w.container("internal", "Internal", () => {
        for (const el of internalFns) w.shape(toD2Id(el.id), el.name);
      });
    }
  },
  renderExternalRefs(w, externalRels) {
    const seen = new Set<string>();
    for (const r of externalRels) {
      if (seen.has(r.targetId)) continue;
      seen.add(r.targetId);
      w.shape(toD2Id(r.targetId), r.targetId.split(".").pop() ?? r.targetId, {
        style: "dashed",
      });
    }
  },
  renderRelationships(w, rels) {
    for (const r of rels) {
      if (r.kind === "inherits" || r.kind === "implements") continue; // C has neither
      w.connection(toD2Id(r.sourceId), toD2Id(r.targetId), r.kind);
    }
  },
};
```

Replace the old `cProfile = javaTsPyProfile` reference with the new object.

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/generator/d2/code.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/generator/d2/code-profiles.ts tests/generator/d2/code.test.ts
git commit -m "feat: add C-specific rendering profile with types/public/internal scopes"
```

---

### Task 16: Profile selection logic with documented tiebreak

**Files:**

- Modify: `src/generator/d2/code-profiles.ts`
- Test: add a case to `tests/generator/d2/code.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/generator/d2/code.test.ts`:

```typescript
import { selectProfileForComponent } from "../../../src/generator/d2/code-profiles.js";

it("selectProfileForComponent picks C when most files are .c/.h", () => {
  const result = selectProfileForComponent({
    java: 1,
    c: 5,
    python: 0,
    typescript: 0,
  });
  expect(result).toBe("c");
});

it("selectProfileForComponent applies tiebreak Java > TS > Python > C", () => {
  const r1 = selectProfileForComponent({
    java: 3,
    typescript: 3,
    python: 0,
    c: 0,
  });
  expect(r1).toBe("java");
  const r2 = selectProfileForComponent({
    typescript: 3,
    python: 3,
    java: 0,
    c: 0,
  });
  expect(r2).toBe("typescript");
  const r3 = selectProfileForComponent({
    python: 3,
    c: 3,
    java: 0,
    typescript: 0,
  });
  expect(r3).toBe("python");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/generator/d2/code.test.ts -t "Profile"`
Expected: FAIL.

- [ ] **Step 3: Implement `selectProfileForComponent` in `code-profiles.ts`**

```typescript
export function selectProfileForComponent(
  fileCountsByLanguage: Record<ProfileLanguage, number>,
): ProfileLanguage {
  const order: ProfileLanguage[] = ["java", "typescript", "python", "c"];
  let winner: ProfileLanguage = "java";
  let winnerCount = -1;
  for (const lang of order) {
    const count = fileCountsByLanguage[lang] ?? 0;
    if (count > winnerCount) {
      winner = lang;
      winnerCount = count;
    }
  }
  return winner;
}
```

The `order` array's top-down iteration gives Java > TypeScript > Python > C ties automatically because `count > winnerCount` doesn't update for equal counts.

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/generator/d2/code.test.ts -t "Profile"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/d2/code-profiles.ts tests/generator/d2/code.test.ts
git commit -m "feat: select language profile for component by dominant file count"
```

---

## Phase 7: CLI integration

### Task 17: Scaffold writer for `c4-code.d2` user-facing files

**Files:**

- Create: `src/generator/d2/code-scaffold.ts`
- Test: `tests/generator/d2/code-scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/generator/d2/code-scaffold.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scaffoldCodeFile } from "../../../src/generator/d2/code-scaffold.js";

describe("scaffoldCodeFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-test-"));
  });

  it("creates the file on first run with import directives", () => {
    const target = path.join(tmp, "c4-code.d2");
    scaffoldCodeFile(target, { containerName: "api", componentName: "users" });
    expect(fs.existsSync(target)).toBe(true);
    const content = fs.readFileSync(target, "utf-8");
    expect(content).toContain("@_generated/c4-code.d2");
    expect(content).toContain("users");
  });

  it("preserves user edits on subsequent runs", () => {
    const target = path.join(tmp, "c4-code.d2");
    scaffoldCodeFile(target, { containerName: "api", componentName: "users" });
    const customized = fs.readFileSync(target, "utf-8") + "\n# my note\n";
    fs.writeFileSync(target, customized);
    scaffoldCodeFile(target, { containerName: "api", componentName: "users" });
    const after = fs.readFileSync(target, "utf-8");
    expect(after).toContain("# my note");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/generator/d2/code-scaffold.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/generator/d2/code-scaffold.ts`**

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

export interface ScaffoldOptions {
  containerName: string;
  componentName: string;
}

export function scaffoldCodeFile(
  targetPath: string,
  opts: ScaffoldOptions,
): void {
  if (fs.existsSync(targetPath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const contents = [
    `# C4 Code Diagram — ${opts.containerName} / ${opts.componentName}`,
    `...@_generated/c4-code.d2`,
    `...@../../../../styles.d2`,
    ``,
    `# Add your customizations below this line`,
    ``,
  ].join("\n");
  fs.writeFileSync(targetPath, contents, "utf-8");
}
```

Note: the `...@../../../../styles.d2` path depends on the directory depth — verify against the actual output tree: `docs/architecture/containers/{cId}/components/{compId}/c4-code.d2` needs to reach `docs/architecture/styles.d2`. That's 4 levels up. Adjust if the styles file lives elsewhere (check `src/generator/d2/scaffold.ts` for the canonical path.)

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/generator/d2/code-scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generator/d2/code-scaffold.ts tests/generator/d2/code-scaffold.test.ts
git commit -m "feat: scaffold user-facing c4-code.d2 files with preserve-on-rerun"
```

---

### Task 18: Wire L4 generation into `generate` command

**Files:**

- Modify: `src/cli/commands/generate.ts` (add branch after existing L3 block around line 151)
- Test: extend `tests/integration/pipeline.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/pipeline.test.ts`:

```typescript
it("generates c4-code.d2 files per component when levels.code is on", async () => {
  // Use or extend the existing monorepo fixture with levels.code: true.
  // After running the full pipeline, assert:
  //   docs/architecture/containers/{cId}/components/{compId}/_generated/c4-code.d2 exists
  //   docs/architecture/containers/{cId}/components/{compId}/c4-code.d2 exists
  // for at least one component where element count >= minElements.
});
```

Use the existing pipeline test harness; enable `levels.code: true` via the test's config. Include in the fixture a component with ≥2 classes so the threshold doesn't skip it.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/pipeline.test.ts -t "c4-code"`
Expected: FAIL — files not generated.

- [ ] **Step 3: Modify `src/cli/commands/generate.ts`**

At the top add imports:

```typescript
import { generateCodeDiagram } from "../../generator/d2/code.js";
import {
  getProfileForLanguage,
  selectProfileForComponent,
  type ProfileLanguage,
} from "../../generator/d2/code-profiles.js";
import { scaffoldCodeFile } from "../../generator/d2/code-scaffold.js";
```

After the existing L3 block (around line 151), add:

```typescript
// L4: Code-level diagrams (one per component)
if (config.levels.code) {
  for (const container of model.containers) {
    const components = model.components.filter(
      (c) => c.containerId === container.id,
    );
    for (const component of components) {
      const elementCount = (model.codeElements ?? []).filter(
        (e) => e.componentId === component.id,
      ).length;
      if (elementCount < config.code.minElements) continue;

      const compDir = path.join(
        outputDir,
        "containers",
        container.id,
        "components",
        component.id,
      );
      const generatedDir = path.join(compDir, "_generated");
      fs.mkdirSync(generatedDir, { recursive: true });

      const lang = dominantLanguageForComponent(component, model, rawStructure);
      const profile = getProfileForLanguage(lang);
      const d2 = generateCodeDiagram(model, component, profile);
      if (writeIfChanged(path.join(generatedDir, "c4-code.d2"), d2))
        filesWritten++;
      else filesUnchanged++;

      scaffoldCodeFile(path.join(compDir, "c4-code.d2"), {
        containerName: container.name,
        componentName: component.name,
      });
    }
  }
}
```

Add the helper function (above or below the main command):

```typescript
function dominantLanguageForComponent(
  component: Component,
  model: ArchitectureModel,
  rawStructure: RawStructure,
): ProfileLanguage {
  const counts: Record<ProfileLanguage, number> = {
    java: 0,
    typescript: 0,
    python: 0,
    c: 0,
  };
  for (const app of rawStructure.applications) {
    for (const mod of app.modules) {
      if (!component.moduleIds.includes(mod.id)) continue;
      const lang = normalizeLanguage(app.language);
      if (lang) counts[lang] += mod.files.length;
    }
  }
  return selectProfileForComponent(counts);
}

function normalizeLanguage(raw: string): ProfileLanguage | null {
  if (raw === "java") return "java";
  if (raw === "typescript") return "typescript";
  if (raw === "python") return "python";
  if (raw === "c") return "c";
  return null;
}
```

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run tests/integration/pipeline.test.ts -t "c4-code"`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/generate.ts tests/integration/pipeline.test.ts
git commit -m "feat: wire L4 code-level generation into generate command"
```

---

### Task 19: Integrate drift detection for code-level scaffold files

**Files:**

- Modify: `src/generator/d2/drift.ts` — extend `checkDrift` to walk code-level scaffold files too
- Test: add case to `tests/quality/drift.test.ts`

- [ ] **Step 1: Inspect the existing drift-detection extraction logic**

Open `src/generator/d2/drift.ts` and locate the helper that pulls identifier references out of D2 source (the function that feeds the C3 drift check). Name it `extractReferencedIds` below even if the current helper has a different name — use the existing one verbatim, or factor it out and rename if it's currently inlined.

- [ ] **Step 2: Write the failing test**

Add to `tests/quality/drift.test.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkDrift } from "../../src/generator/d2/drift.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

it("reports drift when user-edited c4-code.d2 references a removed code element", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drift-l4-"));
  const compDir = path.join(tmp, "containers", "api", "components", "users");
  fs.mkdirSync(compDir, { recursive: true });
  // Write a scaffold that references a vanished element.
  fs.writeFileSync(
    path.join(compDir, "c4-code.d2"),
    [`...@_generated/c4-code.d2`, `api_users_OldClass.label: "Ghost"`].join(
      "\n",
    ),
  );
  const model: ArchitectureModel = {
    version: 1,
    system: { name: "s", description: "" },
    actors: [],
    externalSystems: [],
    containers: [],
    components: [],
    relationships: [],
    codeElements: [
      {
        id: "api.users.UserService",
        componentId: "users",
        kind: "class",
        name: "UserService",
      },
    ],
  } as any;
  const warnings = checkDrift(tmp, model);
  expect(warnings.some((w) => w.id.includes("OldClass"))).toBe(true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/quality/drift.test.ts -t "c4-code"`
Expected: FAIL — drift walker does not traverse into `components/{id}/` directories.

- [ ] **Step 4: Extend `checkDrift` in `src/generator/d2/drift.ts`**

Examine the existing glob or walk logic for scaffold files. Add traversal of `containers/*/components/*/c4-code.d2` when comparing referenced IDs against `model.codeElements`. Identifier comparison should use `toD2Id(codeElement.id)` to match what scaffolds reference.

Sketch (verify against actual `drift.ts` structure):

```typescript
// Inside checkDrift, after existing checks:
if (model.codeElements) {
  const codeIds = new Set(model.codeElements.map((e) => toD2Id(e.id)));
  const scaffoldFiles = glob.sync(
    path.join(outputDir, "containers/*/components/*/c4-code.d2"),
  );
  for (const f of scaffoldFiles) {
    const contents = fs.readFileSync(f, "utf-8");
    // parse identifier references (same extraction logic used for C3)
    for (const { id, line } of extractReferencedIds(contents)) {
      if (!codeIds.has(id)) {
        warnings.push({
          file: f,
          line,
          id,
          message: `Reference to unknown code element '${id}'`,
        });
      }
    }
  }
}
```

Reuse any existing identifier-extraction helper if present; otherwise copy the regex pattern used by the C3 drift check.

- [ ] **Step 5: Run test**

Run: `npx vitest run tests/quality/drift.test.ts -t "c4-code"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/generator/d2/drift.ts tests/quality/drift.test.ts
git commit -m "feat: extend drift detection to c4-code scaffolds"
```

---

## Phase 8: Quality + benchmarks

### Task 20: Integration test end-to-end against the monorepo fixture

**Files:**

- Create: `tests/integration/code-level.test.ts`

- [ ] **Step 1: Extend the monorepo fixture**

If the existing `tests/fixtures/monorepo/services/user-api` doesn't already have multiple Java classes, add one more class (e.g., `UserRepository.java`) so that the component has ≥2 code elements.

- [ ] **Step 2: Write the integration test**

Create `tests/integration/code-level.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scan } from "../../src/core/scan.js";
import { buildModel } from "../../src/core/model-builder.js";
import { runGenerate } from "../../src/cli/commands/generate.js";
import { loadConfig } from "../../src/config/loader.js";
// If runGenerate is not exported, refactor the command in generate.ts to export a
// named function (e.g., extract the body into an exported `runGenerate({rootDir, model, config})`)
// that both the CLI and this test call. That refactor is part of this task.

const FIXTURE = path.resolve(__dirname, "../fixtures/monorepo");

async function runPipeline(workDir: string): Promise<void> {
  const config = await loadConfig(workDir);
  const rawStructure = await scan({ rootDir: workDir, config });
  const model = buildModel({ config, rawStructure });
  await runGenerate({ rootDir: workDir, model, config });
}

describe("c4-code integration", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-l4-"));
    fs.cpSync(FIXTURE, workDir, { recursive: true });

    // Overlay diagram-docs.yaml to enable L4.
    const configPath = path.join(workDir, "diagram-docs.yaml");
    const existing = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, "utf-8")
      : "";
    fs.writeFileSync(
      configPath,
      existing + "\nlevels:\n  code: true\ncode:\n  minElements: 2\n",
    );
    await runPipeline(workDir);
  });

  afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("creates _generated/c4-code.d2 for at least one component", () => {
    const matches = findFilesRecursive(
      path.join(workDir, "docs", "architecture"),
      "c4-code.d2",
    );
    const generated = matches.filter((p) => p.includes("/_generated/"));
    expect(generated.length).toBeGreaterThan(0);
  });

  it("creates a user-facing scaffold at containers/.../components/.../c4-code.d2", () => {
    const matches = findFilesRecursive(
      path.join(workDir, "docs", "architecture"),
      "c4-code.d2",
    );
    const scaffolds = matches.filter((p) => !p.includes("/_generated/"));
    expect(scaffolds.length).toBeGreaterThan(0);
  });

  it("preserves user edits on re-run", async () => {
    const matches = findFilesRecursive(
      path.join(workDir, "docs", "architecture"),
      "c4-code.d2",
    );
    const scaffold = matches.find((p) => !p.includes("/_generated/"))!;
    const marker = "# USER-EDIT-SENTINEL";
    fs.appendFileSync(scaffold, `\n${marker}\n`);
    await runPipeline(workDir);
    expect(fs.readFileSync(scaffold, "utf-8")).toContain(marker);
  });
});

function findFilesRecursive(dir: string, name: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) out.push(full);
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
```

If `loadConfig` or `scan` or `runGenerate` are not exported with these exact names, inspect `src/config/loader.ts`, `src/core/scan.ts`, and `src/cli/commands/generate.ts` and adapt the imports. If `runGenerate` does not currently exist as an exported function, extract it from the Commander action handler in `generate.ts` as part of this task — both the CLI and this test should share the same entry point.

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run tests/integration/code-level.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/code-level.test.ts tests/fixtures/monorepo/
git commit -m "test: integration test for c4-code generation on monorepo fixture"
```

---

### Task 21: Benchmark code extraction overhead

**Files:**

- Create: `tests/bench/code-extraction.bench.ts`

- [ ] **Step 1: Write the benchmark**

Create `tests/bench/code-extraction.bench.ts`:

```typescript
import { bench, describe } from "vitest";
import * as path from "node:path";
import { javaAnalyzer } from "../../src/analyzers/java/index.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/monorepo/services/user-api",
);

describe("scan performance with and without code level", () => {
  bench("baseline (levels.code: false)", async () => {
    await javaAnalyzer.analyze(FIXTURE, {
      exclude: [],
      abstraction: { granularity: "balanced", excludePatterns: [] },
      levels: { context: true, container: true, component: true, code: false },
    } as any);
  });

  bench("with code extraction (levels.code: true)", async () => {
    await javaAnalyzer.analyze(FIXTURE, {
      exclude: [],
      abstraction: { granularity: "balanced", excludePatterns: [] },
      levels: { context: true, container: true, component: true, code: true },
      code: { includePrivate: false, includeMembers: true, minElements: 2 },
    } as any);
  });
});
```

- [ ] **Step 2: Run the benchmark**

Run: `npm run bench`
Expected: both bench cases report times. The ratio should be under 2× (the spec's target); if substantially higher, investigate query complexity or WASM cold-start cost.

- [ ] **Step 3: Commit**

```bash
git add tests/bench/code-extraction.bench.ts
git commit -m "test: benchmark for code-extraction overhead vs baseline scan"
```

---

### Task 22: Quality test — ground-truth precision/recall for code elements

**Files:**

- Modify: `tests/quality/fixtures/java-spring/expected.json` — add a `codeElements` section with expected extractions
- Modify: `tests/quality/fixtures/python-fastapi/expected.json` — same
- Modify: `tests/quality/fixtures/typescript-express/expected.json` — same
- Modify: `tests/quality/fixtures/c-cmake/expected.json` — same
- Modify: `tests/quality/correctness.test.ts` — add code-element precision/recall assertions

- [ ] **Step 1: Run the scan against one fixture to capture ground truth**

For each language fixture (`java-spring`, `typescript-express`, `python-fastapi`, `c-cmake`), run the scan with `levels.code: true` and record what elements were extracted. This is the starting point for the `codeElements` ground truth.

Example one-off capture command (adapt per fixture):

```bash
npx tsx -e "
  import('./src/cli/commands/scan.js').then(async (m) => {
    const result = await m.runScan('tests/quality/fixtures/java-spring', { levels: { code: true }, code: { includePrivate: false, includeMembers: true, minElements: 1 } });
    console.log(JSON.stringify(result.applications.flatMap(a => a.modules.flatMap(mod => mod.codeElements ?? [])).map(e => ({ name: e.name, kind: e.kind })), null, 2));
  });
"
```

(If `runScan` is not exported, call the analyzer's `analyze()` directly as done in the analyzer unit tests.)

Review the output and remove any noise (generated classes, anonymous inner classes, etc.) to produce the ground truth list.

- [ ] **Step 2: Extend each `expected.json` with a `codeElements` section**

Add to each of the four `expected.json` files:

```json
{
  "existingFields": "...",
  "codeElements": [
    { "name": "UserController", "kind": "class" },
    { "name": "UserRepository", "kind": "interface" }
  ]
}
```

Use the cleaned-up output from Step 1 as the authoritative list per fixture. Do not include `visibility` or `members` in the ground truth — keep it name+kind to avoid brittle signature-level matching.

- [ ] **Step 3: Read `tests/quality/correctness.test.ts` to understand the existing metric pattern**

Locate the existing precision/recall helper (likely imported from `tests/quality/helpers/metrics.ts`). Note the function signature so the new test can reuse it.

- [ ] **Step 4: Extend `tests/quality/correctness.test.ts`**

Add a new `describe` block that iterates over all four fixtures. For each:

```typescript
import { computePrecisionRecall } from "./helpers/metrics.js";

describe("code-element precision/recall", () => {
  const fixtures = [
    "java-spring",
    "typescript-express",
    "python-fastapi",
    "c-cmake",
  ];

  for (const fixture of fixtures) {
    it(`${fixture}: extracted code elements match ground truth`, async () => {
      const fixturePath = `tests/quality/fixtures/${fixture}`;
      const expected = JSON.parse(
        fs.readFileSync(`${fixturePath}/expected.json`, "utf-8"),
      );
      const config = {
        exclude: [],
        abstraction: { granularity: "balanced", excludePatterns: [] },
        levels: { context: true, container: true, component: true, code: true },
        code: { includePrivate: false, includeMembers: true, minElements: 1 },
      };
      // Pick the analyzer that matches the fixture — mirror the pattern already in correctness.test.ts.
      const analyzer = pickAnalyzerForFixture(fixture); // existing helper or inline lookup
      const result = await analyzer.analyze(fixturePath, config as any);
      const actualElements = result.modules
        .flatMap((m) => m.codeElements ?? [])
        .map((e) => ({ name: e.name, kind: e.kind }));

      const { precision, recall } = computePrecisionRecall(
        actualElements,
        expected.codeElements ?? [],
        (a, b) => a.name === b.name && a.kind === b.kind,
      );
      expect(precision).toBeGreaterThanOrEqual(0.8);
      expect(recall).toBeGreaterThanOrEqual(0.8);
    });
  }
});
```

If `computePrecisionRecall` has a different signature, adapt the call to match. If a matcher function isn't supported, pre-stringify both arrays and use set arithmetic.

- [ ] **Step 5: Run correctness tests**

Run: `npm run test:correctness`
Expected: all four fixtures pass precision ≥ 0.8 and recall ≥ 0.8. If one fails, inspect the diff between actual and expected — either adjust the tree-sitter query for that language or revise the ground truth if the scan found something legitimate that wasn't recorded.

- [ ] **Step 6: Commit**

```bash
git add tests/quality/
git commit -m "test: add code-element precision/recall for all language fixtures"
```

---

## Phase 9: Finishing

### Task 23: Documentation and README update

**Files:**

- Modify: `README.md` — add a section describing L4 support
- Modify: `CLAUDE.md` if the project structure notes need updates (they do — new `src/generator/d2/code.ts` etc.)

- [ ] **Step 1: Update `README.md`**

Add a section "C4 Code-Level Diagrams" explaining:

- What L4 is (link to the C4 spec)
- How to enable it (`levels.code: true`)
- Configuration options (`includePrivate`, `includeMembers`, `minElements`)
- Output file locations
- Supported languages and any per-language notes

- [ ] **Step 2: Update `CLAUDE.md`**

Under "Key Modules," add a line for `src/generator/d2/code.ts` and tree-sitter; note the `assets/tree-sitter/` folder. Update the Output Structure section to mention `containers/{id}/components/{id}/` subdirectories.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document C4 code-level diagrams and configuration"
```

---

### Task 24: Final full-suite verification + lint + format

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Run correctness + drift + tokens suites**

Run: `npm run test:correctness && npm run test:drift && npm run test:tokens`
Expected: all pass.

- [ ] **Step 3: Run benchmarks and record output**

Run: `npm run bench`
Expected: all bench cases complete; code-extraction overhead <2×.

- [ ] **Step 4: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Format**

Run: `npx prettier --write .`
Expected: either no changes or cosmetic adjustments.

- [ ] **Step 6: Final commit (only if format adjusted anything)**

```bash
git add -A
git commit -m "chore: format after C4 code-level feature"
```

---

## Summary of Commits

A clean implementation produces roughly one commit per task:

1. `feat: add levels.code and code config section for L4 diagrams`
2. `feat: add code-level types to analyzer and model interfaces`
3. `feat: extend JSON schemas with code-level fields`
4. `chore: add web-tree-sitter and bundle language grammars`
5. `feat: add shared tree-sitter loader and query runner`
6. `feat: extract Java code elements via tree-sitter`
7. `feat: extract TypeScript code elements via tree-sitter`
8. `feat: extract Python code elements via tree-sitter`
9. `feat: extract C code elements via tree-sitter`
10. `feat: gate code extraction on config.levels.code in all analyzers`
11. `feat: build code model with qualified IDs and relationship resolution`
12. `feat: attach code-level data to ArchitectureModel in buildModel`
13. `feat: add code-level D2 generator skeleton with profile interface`
14. `feat: render class members inside shape:class nodes`
15. `feat: add C-specific rendering profile with types/public/internal scopes`
16. `feat: select language profile for component by dominant file count`
17. `feat: scaffold user-facing c4-code.d2 files with preserve-on-rerun`
18. `feat: wire L4 code-level generation into generate command`
19. `feat: extend drift detection to c4-code scaffolds`
20. `test: integration test for c4-code generation on monorepo fixture`
21. `test: benchmark for code-extraction overhead vs baseline scan`
22. `test: add code-element precision/recall for all language fixtures`
23. `docs: document C4 code-level diagrams and configuration`
24. `chore: format after C4 code-level feature` (if needed)
