import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { collectRemovePaths, removePath } from "../../src/core/remove.js";
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
