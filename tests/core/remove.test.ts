import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  collectArchitectureDirs,
  collectRemovePaths,
  pruneEmptyAncestors,
  removePath,
} from "../../src/core/remove.js";
import { configSchema } from "../../src/config/schema.js";

function makeConfig(overrides = {}) {
  return configSchema.parse(overrides);
}

/** Create a temp dir, return its path. Auto-cleaned in afterEach. */
let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-remove-test-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function touch(rel: string): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "", "utf-8");
  return abs;
}

function mkdir(rel: string): string {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

// ---------------------------------------------------------------------------
// collectRemovePaths — default (no --all)
// ---------------------------------------------------------------------------

describe("collectRemovePaths — default (no --all)", () => {
  it("includes diagram-docs.yaml when it exists", async () => {
    const configPath = touch("diagram-docs.yaml");
    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toContain(configPath);
  });

  it("includes .diagram-docs/ dir when it exists", async () => {
    const configPath = touch("diagram-docs.yaml");
    const cacheDir = mkdir(".diagram-docs");
    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toContain(cacheDir);
  });

  it("includes architecture-model.yaml when it exists", async () => {
    const configPath = touch("diagram-docs.yaml");
    const modelPath = touch("architecture-model.yaml");
    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toContain(modelPath);
  });

  it("omits missing paths", async () => {
    // Nothing is created — all paths should be absent
    const configPath = path.join(tmpDir, "diagram-docs.yaml");
    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toHaveLength(0);
  });

  it("does not include output.dir even when it exists", async () => {
    const configPath = touch("diagram-docs.yaml");
    mkdir("docs/architecture");
    const config = makeConfig({ output: { dir: "docs/architecture" } });
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).not.toContain(path.join(tmpDir, "docs/architecture"));
  });

  it("includes submodule .diagram-docs dirs discovered from architecture-model.yaml", async () => {
    const configPath = touch("diagram-docs.yaml");

    const model = {
      version: 1,
      system: { name: "Test", description: "" },
      actors: [],
      containers: [
        {
          id: "svc-auth",
          applicationId: "svc-auth",
          name: "Auth",
          path: "services/auth",
          technology: "Node.js",
          description: "",
        },
      ],
    };
    touch("architecture-model.yaml");
    fs.writeFileSync(
      path.join(tmpDir, "architecture-model.yaml"),
      stringifyYaml(model),
      "utf-8",
    );

    const subCacheDir = mkdir("services/auth/.diagram-docs");

    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toContain(subCacheDir);
  });

  it("falls back to filesystem walk for submodule .diagram-docs dirs when model is absent", async () => {
    const configPath = touch("diagram-docs.yaml");
    const subCacheDir = mkdir("apps/worker/.diagram-docs");
    // Place a marker file so glob can discover it
    touch("apps/worker/.diagram-docs/raw-structure.json");

    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toContain(subCacheDir);
  });

  it("does not duplicate root .diagram-docs when submodule dirs also exist", async () => {
    const configPath = touch("diagram-docs.yaml");
    const rootCacheDir = mkdir(".diagram-docs");
    const subCacheDir = mkdir("apps/api/.diagram-docs");
    touch("apps/api/.diagram-docs/raw-structure.json");

    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, false);
    expect(result).toContain(rootCacheDir);
    expect(result).toContain(subCacheDir);
    // Root should appear exactly once (deduplication)
    expect(result.filter((p) => p === rootCacheDir)).toHaveLength(1);
  });

  it("includes submodule diagram-docs.yaml stubs discovered from architecture-model.yaml", async () => {
    const rootConfigPath = touch("diagram-docs.yaml");

    const model = {
      version: 1,
      system: { name: "Test", description: "" },
      actors: [],
      containers: [
        {
          id: "svc-auth",
          applicationId: "svc-auth",
          name: "Auth",
          path: "services/auth",
          technology: "Node.js",
          description: "",
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, "architecture-model.yaml"),
      stringifyYaml(model),
      "utf-8",
    );

    const subStub = touch("services/auth/diagram-docs.yaml");

    const config = makeConfig();
    const result = await collectRemovePaths(
      tmpDir,
      rootConfigPath,
      config,
      false,
    );
    expect(result).toContain(subStub);
    // Root config appears exactly once — it's a direct candidate, and the
    // glob fallback that would otherwise pick it up is only used when the
    // model is absent.
    expect(result.filter((p) => p === rootConfigPath)).toHaveLength(1);
  });

  it("falls back to filesystem walk for submodule stubs when model is absent", async () => {
    const rootConfigPath = touch("diagram-docs.yaml");
    const subStub = touch("apps/worker/diagram-docs.yaml");

    const config = makeConfig();
    const result = await collectRemovePaths(
      tmpDir,
      rootConfigPath,
      config,
      false,
    );
    expect(result).toContain(subStub);
    expect(result.filter((p) => p === rootConfigPath)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// collectRemovePaths — with --all
// ---------------------------------------------------------------------------

describe("collectRemovePaths — with --all", () => {
  it("includes output.dir when it exists", async () => {
    const configPath = touch("diagram-docs.yaml");
    const outputDir = mkdir("docs/architecture");
    const config = makeConfig({ output: { dir: "docs/architecture" } });
    const result = await collectRemovePaths(tmpDir, configPath, config, true);
    expect(result).toContain(outputDir);
  });

  it("discovers submodule dirs from architecture-model.yaml", async () => {
    const configPath = touch("diagram-docs.yaml");

    // Create a minimal architecture model
    const model = {
      version: 1,
      system: { name: "Test", description: "" },
      actors: [],
      containers: [
        {
          id: "svc-auth",
          applicationId: "svc-auth",
          name: "Auth",
          path: "services/auth",
          technology: "Node.js",
          description: "",
        },
      ],
    };
    touch("architecture-model.yaml");
    fs.writeFileSync(
      path.join(tmpDir, "architecture-model.yaml"),
      stringifyYaml(model),
      "utf-8",
    );

    // Create the submodule architecture dir
    const subDir = mkdir("services/auth/docs/architecture");

    const config = makeConfig({ submodules: { docsDir: "docs" } });
    const result = await collectRemovePaths(tmpDir, configPath, config, true);
    expect(result).toContain(subDir);
  });

  it("falls back to filesystem walk when model is absent", async () => {
    const configPath = touch("diagram-docs.yaml");
    // Create a submodule _generated dir (no model file)
    const subGenDir = mkdir("apps/worker/docs/architecture/_generated");
    touch("apps/worker/docs/architecture/_generated/c3-component.d2");
    const expectedArchDir = path.dirname(subGenDir);

    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, true);
    expect(result).toContain(expectedArchDir);
  });

  it("fallback discovers submodule dirs with only model fragment (no component diagram)", async () => {
    const configPath = touch("diagram-docs.yaml");
    // Submodule dir has only a model fragment — component diagrams disabled
    mkdir("apps/api/docs/architecture");
    touch("apps/api/docs/architecture/architecture-model.yaml");
    const expectedArchDir = path.join(tmpDir, "apps/api/docs/architecture");

    const config = makeConfig();
    const result = await collectRemovePaths(tmpDir, configPath, config, true);
    expect(result).toContain(expectedArchDir);
  });
});

// ---------------------------------------------------------------------------
// collectArchitectureDirs
// ---------------------------------------------------------------------------

describe("collectArchitectureDirs", () => {
  it("returns the root output dir bounded by configDir", async () => {
    const config = makeConfig({ output: { dir: "docs/architecture" } });
    const result = await collectArchitectureDirs(tmpDir, config);
    expect(result[0]).toEqual({
      archDir: path.join(tmpDir, "docs/architecture"),
      boundary: tmpDir,
    });
  });

  it("returns submodule entries from architecture-model.yaml bounded by appPath", async () => {
    const model = {
      version: 1,
      system: { name: "Test", description: "" },
      actors: [],
      containers: [
        {
          id: "svc-auth",
          applicationId: "svc-auth",
          name: "Auth",
          path: "services/auth",
          technology: "Node.js",
          description: "",
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, "architecture-model.yaml"),
      stringifyYaml(model),
      "utf-8",
    );

    const config = makeConfig({ submodules: { docsDir: "docs" } });
    const result = await collectArchitectureDirs(tmpDir, config);

    const appAbs = path.join(tmpDir, "services/auth");
    expect(result).toContainEqual({
      archDir: path.join(appAbs, "docs", "architecture"),
      boundary: appAbs,
    });
  });

  it("falls back to filesystem walk when model is absent", async () => {
    mkdir("apps/worker/docs/architecture/_generated");
    touch("apps/worker/docs/architecture/_generated/c3-component.d2");

    const config = makeConfig();
    const result = await collectArchitectureDirs(tmpDir, config);

    const archDir = path.join(tmpDir, "apps/worker/docs/architecture");
    expect(result).toContainEqual({
      archDir,
      boundary: path.dirname(archDir),
    });
  });
});

// ---------------------------------------------------------------------------
// pruneEmptyAncestors
// ---------------------------------------------------------------------------

describe("pruneEmptyAncestors", () => {
  it("returns [] when start's parent equals boundary", () => {
    const arch = mkdir("architecture");
    const removed = pruneEmptyAncestors(arch, tmpDir, new Set([arch]));
    expect(removed).toEqual([]);
  });

  it("returns one parent when it becomes empty after planned removal", () => {
    const arch = mkdir("docs/architecture");
    const removed = pruneEmptyAncestors(arch, tmpDir, new Set([arch]));
    expect(removed).toEqual([path.join(tmpDir, "docs")]);
  });

  it("walks multiple empty levels", () => {
    const arch = mkdir("a/b/c/architecture");
    const removed = pruneEmptyAncestors(arch, tmpDir, new Set([arch]));
    expect(removed).toEqual([
      path.join(tmpDir, "a/b/c"),
      path.join(tmpDir, "a/b"),
      path.join(tmpDir, "a"),
    ]);
  });

  it("stops at first non-empty parent", () => {
    const arch = mkdir("docs/architecture");
    touch("docs/README.md");
    const removed = pruneEmptyAncestors(arch, tmpDir, new Set([arch]));
    expect(removed).toEqual([]);
  });

  it("treats only-planned-siblings as empty", () => {
    const arch = mkdir("docs/architecture");
    const sibling = touch("docs/notes.md");
    const removed = pruneEmptyAncestors(arch, tmpDir, new Set([arch, sibling]));
    expect(removed).toEqual([path.join(tmpDir, "docs")]);
  });

  it("does not remove the boundary itself", () => {
    const arch = mkdir("docs/architecture");
    const removed = pruneEmptyAncestors(arch, tmpDir, new Set([arch]));
    expect(removed).not.toContain(tmpDir);
  });

  it("never crosses the boundary", () => {
    // arch lives outside boundary — walk should not happen
    const outsideBoundary = mkdir("only-this/dir");
    const arch = mkdir("other-tree/architecture");
    const removed = pruneEmptyAncestors(arch, outsideBoundary, new Set([arch]));
    expect(removed).toEqual([]);
  });

  it("handles non-existent parent gracefully", () => {
    const fakeStart = path.join(tmpDir, "ghost/architecture");
    const removed = pruneEmptyAncestors(
      fakeStart,
      tmpDir,
      new Set([fakeStart]),
    );
    expect(removed).toEqual([]);
  });

  it("converges across sibling arch dirs sharing a parent via shared planned set", () => {
    const arch1 = mkdir("services/auth/docs/architecture");
    const arch2 = mkdir("services/api/docs/architecture");
    const planned = new Set([arch1, arch2]);

    const boundary1 = path.join(tmpDir, "services/auth");
    const boundary2 = path.join(tmpDir, "services/api");

    const removed1 = pruneEmptyAncestors(arch1, boundary1, planned);
    const removed2 = pruneEmptyAncestors(arch2, boundary2, planned);

    expect(removed1).toEqual([path.join(tmpDir, "services/auth/docs")]);
    expect(removed2).toEqual([path.join(tmpDir, "services/api/docs")]);
  });
});

// ---------------------------------------------------------------------------
// removePath
// ---------------------------------------------------------------------------

describe("removePath", () => {
  it("removes a file", () => {
    const file = touch("some-file.txt");
    expect(fs.existsSync(file)).toBe(true);
    removePath(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("removes a directory recursively", () => {
    const dir = mkdir("nested/dir");
    touch("nested/dir/child.txt");
    expect(fs.existsSync(dir)).toBe(true);
    removePath(path.join(tmpDir, "nested"));
    expect(fs.existsSync(path.join(tmpDir, "nested"))).toBe(false);
  });

  it("does not throw for missing path", () => {
    const missing = path.join(tmpDir, "does-not-exist");
    expect(() => removePath(missing)).not.toThrow();
  });
});
