import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../../src/config/loader.js";
import { loadModel } from "../../src/core/model.js";
import { buildModel } from "../../src/core/model-builder.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateSubmoduleDocs } from "../../src/generator/d2/submodule-scaffold.js";
import { configSchema } from "../../src/config/schema.js";
import { resolveConfig } from "../../src/core/cascading-config.js";
import { collectRemovePaths, removePath } from "../../src/core/remove.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { getAnalyzer } from "../../src/analyzers/registry.js";
import type {
  RawStructure,
  ScannedApplication,
} from "../../src/analyzers/types.js";

const MONOREPO = path.resolve(__dirname, "../fixtures/monorepo");
const CONFIG_PATH = path.join(MONOREPO, "diagram-docs.yaml");
const OUTPUT_DIR = path.join(MONOREPO, "test-submodule-output");

// Track created dirs for cleanup
const createdDirs: string[] = [];

function trackDir(dir: string) {
  createdDirs.push(dir);
}

describe("Integration: Submodule per-folder docs", () => {
  afterAll(() => {
    for (const dir of [OUTPUT_DIR, ...createdDirs]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    }
  });

  it("full pipeline: scan → model → generate with submodules", async () => {
    // 1. Scan
    const { config: baseConfig } = loadConfig(CONFIG_PATH);
    const discovered = await discoverApplications(MONOREPO, baseConfig);
    const applications: ScannedApplication[] = [];

    for (const app of discovered) {
      const analyzer = getAnalyzer(app.analyzerId);
      const result = await analyzer!.analyze(path.resolve(MONOREPO, app.path), {
        exclude: baseConfig.scan.exclude,
        abstraction: baseConfig.abstraction,
      });
      result.path = app.path;
      applications.push(result);
    }

    const rawStructure: RawStructure = {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum: "test",
      applications,
    };

    expect(rawStructure.applications.length).toBeGreaterThan(0);

    // 2. Build model
    const config = configSchema.parse({
      ...baseConfig,
      submodules: { enabled: true },
    });
    const model = buildModel({ config, rawStructure });

    expect(model.containers.length).toBeGreaterThan(0);
    expect(model.components.length).toBeGreaterThan(0);

    // Verify containers have paths
    for (const container of model.containers) {
      expect(container.path).toBeTruthy();
    }

    // 3. Generate root docs
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const d2 = generateContainerDiagram(model, {
      componentLinks: true,
      format: "svg",
      submoduleLinkResolver: (containerId) => {
        const container = model.containers.find((c) => c.id === containerId);
        if (!container) return null;
        const appPath = container.path ?? containerId;
        return `../../${appPath}/docs/architecture/component.svg`;
      },
    });

    expect(d2).toContain("link:");
    expect(d2).toContain("docs/architecture/component.svg");

    // 4. Generate per-folder submodule docs
    // Snapshot which stub paths are absent before generation so cleanup only
    // removes stubs this test created — not pre-existing committed fixtures
    // (e.g. services/api-gateway/diagram-docs.yaml is tracked in git).
    const preexistingStubs = new Set(
      model.containers
        .map((c) => {
          const appPath = c.path ?? c.applicationId.replace(/-/g, "/");
          return path.join(MONOREPO, appPath, "diagram-docs.yaml");
        })
        .filter((p) => fs.existsSync(p)),
    );

    const subResults = generateSubmoduleDocs(
      MONOREPO,
      OUTPUT_DIR,
      model,
      config,
    );

    expect(subResults.length).toBeGreaterThan(0);

    // Track for cleanup (both the docs subtree and the new app-root stub).
    // rmSync with { recursive: true } handles single files too.
    // Skip stub cleanup for pre-existing files (committed fixtures must survive).
    for (const sub of subResults) {
      trackDir(path.join(MONOREPO, sub.applicationPath, "docs"));
      const stubPath = path.join(
        MONOREPO,
        sub.applicationPath,
        "diagram-docs.yaml",
      );
      if (!preexistingStubs.has(stubPath)) {
        trackDir(stubPath);
      }
    }

    // Verify per-folder docs were created
    for (const sub of subResults) {
      expect(fs.existsSync(sub.outputDir)).toBe(true);

      // Check generated c3-component.d2 exists
      const genDir = path.join(sub.outputDir, "_generated");
      expect(fs.existsSync(path.join(genDir, "c3-component.d2"))).toBe(true);

      // Check styles.d2 exists
      expect(fs.existsSync(path.join(sub.outputDir, "styles.d2"))).toBe(true);

      // Check user-facing c3-component.d2 with breadcrumb
      const userD2Path = path.join(sub.outputDir, "c3-component.d2");
      expect(fs.existsSync(userD2Path)).toBe(true);
      const userD2 = fs.readFileSync(userD2Path, "utf-8");
      expect(userD2).toContain("System diagrams:");
      expect(userD2).toContain("...@_generated/c3-component.d2");
      expect(userD2).toContain("...@styles.d2");

      // Check model fragment
      const fragmentPath = path.join(sub.outputDir, "architecture-model.yaml");
      expect(fs.existsSync(fragmentPath)).toBe(true);
    }
  });

  it("respects submodule overrides to exclude apps", async () => {
    const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
    const model = loadModel(MODEL_PATH);

    // Use a temp dir to avoid creating dirs in the fixture tree
    const tmpRoot = path.join(MONOREPO, "test-submodule-exclude");
    trackDir(tmpRoot);

    const config = configSchema.parse({
      submodules: {
        enabled: true,
        overrides: {
          "services-order-service": { exclude: true },
        },
      },
    });

    const subResults = generateSubmoduleDocs(
      tmpRoot,
      OUTPUT_DIR,
      model,
      config,
    );

    // Track for cleanup
    for (const sub of subResults) {
      trackDir(path.join(tmpRoot, sub.applicationPath, "docs"));
    }

    // order-service should be excluded
    expect(subResults.some((s) => s.containerId === "order-service")).toBe(
      false,
    );
    // user-api should still be included
    expect(subResults.some((s) => s.containerId === "user-api")).toBe(true);
  });

  it("scaffolds a commented-out diagram-docs.yaml at each submodule root", () => {
    const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
    const model = loadModel(MODEL_PATH);

    const tmpRoot = path.join(MONOREPO, "test-submodule-stub");
    trackDir(tmpRoot);

    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { context: true, container: true, component: true },
    });

    const subResults = generateSubmoduleDocs(
      tmpRoot,
      OUTPUT_DIR,
      model,
      config,
    );
    expect(subResults.length).toBeGreaterThan(0);

    for (const sub of subResults) {
      const stubPath = path.join(
        tmpRoot,
        sub.applicationPath,
        "diagram-docs.yaml",
      );
      expect(fs.existsSync(stubPath)).toBe(true);

      const content = fs.readFileSync(stubPath, "utf-8");

      // Header references the humanized submodule name
      const expectedName = sub.applicationPath
        .split("/")
        .pop()!
        .replace(/[-_]/g, " ")
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      expect(content).toMatch(
        new RegExp(`^# diagram-docs\\.yaml for ${expectedName}`),
      );

      // Every body line must be a comment — parsing yields null (inert stub)
      const parsed = parseYaml(content);
      expect(parsed).toBeNull();

      // `parsed ?? {}` (what cascading-config.ts uses) must schema-validate,
      // so an untouched stub contributes nothing to the merged config.
      expect(() => configSchema.parse(parsed ?? {})).not.toThrow();

      // The stub must mention the top-level keys so users can find them
      for (const key of [
        "system:",
        "scan:",
        "levels:",
        "abstraction:",
        "output:",
        "llm:",
      ]) {
        expect(content).toContain(`# ${key}`);
      }
    }
  });

  it("preserves an existing diagram-docs.yaml at a submodule root", () => {
    const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
    const model = loadModel(MODEL_PATH);

    const tmpRoot = path.join(MONOREPO, "test-submodule-stub-preserve");
    trackDir(tmpRoot);

    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { context: true, container: true, component: true },
    });

    // Pre-create a populated stub for one submodule
    const appPath = "services/user/api";
    const stubPath = path.join(tmpRoot, appPath, "diagram-docs.yaml");
    fs.mkdirSync(path.dirname(stubPath), { recursive: true });
    const userContent = "system:\n  name: My Custom Name\n";
    fs.writeFileSync(stubPath, userContent, "utf-8");

    generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

    expect(fs.readFileSync(stubPath, "utf-8")).toBe(userContent);
  });

  it("does not scaffold submodule stubs when component diagrams are disabled", () => {
    const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
    const model = loadModel(MODEL_PATH);

    const tmpRoot = path.join(MONOREPO, "test-submodule-stub-nocomponent");
    trackDir(tmpRoot);

    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { context: true, container: true, component: false },
    });

    generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

    for (const container of model.containers) {
      const appPath =
        container.path ?? container.applicationId.replace(/-/g, "/");
      const stubPath = path.join(tmpRoot, appPath, "diagram-docs.yaml");
      expect(fs.existsSync(stubPath)).toBe(false);
    }
  });

  it("does not scaffold a stub for a submodule excluded via override", () => {
    const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
    const model = loadModel(MODEL_PATH);

    const tmpRoot = path.join(MONOREPO, "test-submodule-stub-exclude");
    trackDir(tmpRoot);

    const config = configSchema.parse({
      submodules: {
        enabled: true,
        overrides: {
          "services-order-service": { exclude: true },
        },
      },
      levels: { context: true, container: true, component: true },
    });

    generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

    const excludedAppPath = "services/order/service";
    const excludedStub = path.join(
      tmpRoot,
      excludedAppPath,
      "diagram-docs.yaml",
    );
    expect(fs.existsSync(excludedStub)).toBe(false);

    const includedStub = path.join(
      tmpRoot,
      "services/user/api",
      "diagram-docs.yaml",
    );
    expect(fs.existsSync(includedStub)).toBe(true);
  });

  it("uncommenting a key in a scaffolded stub overrides the root config", () => {
    // Hermetic tmpRoot with a .git sentinel so resolveConfig's upward walk
    // stops here instead of climbing into the enclosing worktree.
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "diagram-docs-roundtrip-"),
    );
    try {
      fs.mkdirSync(path.join(tmpRoot, ".git"), { recursive: true });

      // Root config sets system.name to a sentinel the cascade should see
      // everywhere EXCEPT the submodule whose stub we edit.
      const rootConfigPath = path.join(tmpRoot, "diagram-docs.yaml");
      fs.writeFileSync(
        rootConfigPath,
        "system:\n  name: Root System\n",
        "utf-8",
      );

      const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
      const model = loadModel(MODEL_PATH);
      const config = configSchema.parse({
        submodules: { enabled: true },
        levels: { context: true, container: true, component: true },
      });

      generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config);

      // Pick the first container and uncomment `system:` + `  name: ...` in
      // its stub, rewriting the value so the assertion can recognize it.
      const target = model.containers[0]!;
      const appPath = target.path ?? target.applicationId.replace(/-/g, "/");
      const stubPath = path.join(tmpRoot, appPath, "diagram-docs.yaml");
      const stubContent = fs.readFileSync(stubPath, "utf-8");
      // Commented lines are `# ` + the original YAML line. `system:` sits at
      // column 0; `name:` is indented 2 spaces under it, so after the `# `
      // prefix it reads `#   name: …` (three spaces).
      const uncommented = stubContent
        .replace(/^# (system:)$/m, "$1")
        .replace(/^#   name: .+$/m, "  name: SUBMODULE_OVERRIDE");
      fs.writeFileSync(stubPath, uncommented, "utf-8");

      // Sanity: edited stub parses and schema-validates by itself.
      const parsedStub = parseYaml(uncommented) as Record<string, unknown>;
      expect(parsedStub).not.toBeNull();

      // Other containers still see the root value; this container sees the override.
      const sibling = model.containers.find((c) => c.id !== target.id)!;
      const siblingAppPath =
        sibling.path ?? sibling.applicationId.replace(/-/g, "/");
      fs.mkdirSync(path.join(tmpRoot, siblingAppPath), { recursive: true });

      expect(resolveConfig(path.join(tmpRoot, appPath)).system.name).toBe(
        "SUBMODULE_OVERRIDE",
      );
      expect(
        resolveConfig(path.join(tmpRoot, siblingAppPath)).system.name,
      ).toBe("Root System");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("emits drill-down links to L4 in per-submodule C3 when codeLinks supplied", () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-codelinks");
    trackDir(tmpRoot);
    fs.mkdirSync(tmpRoot, { recursive: true });

    const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { component: true, code: true },
    });
    const codeLinks = new Set(model.components.map((c) => c.id));

    generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, { codeLinks });

    // Find any per-app c3-component generated file and assert it has links.
    const subDirs = fs
      .readdirSync(tmpRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(tmpRoot, e.name));

    const sampleGenerated = subDirs
      .map((d) => {
        function find(dir: string): string | null {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const inner = find(full);
              if (inner) return inner;
            } else if (
              entry.name === "c3-component.d2" &&
              full.includes("_generated")
            ) {
              return full;
            }
          }
          return null;
        }
        return find(d);
      })
      .find((p): p is string => p !== null);

    expect(sampleGenerated).toBeTruthy();
    const content = fs.readFileSync(sampleGenerated!, "utf-8");
    expect(content).toMatch(/link:\s*"?\.\/components\/[^/]+\/c4-code\.svg/);
  });

  it("generate-then-remove cleans up all files generate created", async () => {
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "diagram-docs-symmetry-"),
    );
    try {
      const rootConfigPath = path.join(tmpRoot, "diagram-docs.yaml");
      fs.writeFileSync(
        rootConfigPath,
        "submodules:\n  enabled: true\n",
        "utf-8",
      );

      const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
      const model = loadModel(MODEL_PATH);
      const modelPath = path.join(tmpRoot, "architecture-model.yaml");
      fs.writeFileSync(modelPath, stringifyYaml(model), "utf-8");

      const config = configSchema.parse({
        submodules: { enabled: true },
        levels: { context: true, container: true, component: true },
      });

      const rootOutputDir = path.join(tmpRoot, "docs/architecture");
      fs.mkdirSync(rootOutputDir, { recursive: true });
      generateSubmoduleDocs(tmpRoot, rootOutputDir, model, config);

      // Catalogue what generate produced so we can assert all of it is gone.
      const createdPaths: string[] = [];
      for (const container of model.containers) {
        const appPath =
          container.path ?? container.applicationId.replace(/-/g, "/");
        const stub = path.join(tmpRoot, appPath, "diagram-docs.yaml");
        const archDir = path.join(tmpRoot, appPath, "docs/architecture");
        if (fs.existsSync(stub)) createdPaths.push(stub);
        if (fs.existsSync(archDir)) createdPaths.push(archDir);
      }
      expect(createdPaths.length).toBeGreaterThan(0);

      const toRemove = await collectRemovePaths(
        tmpRoot,
        rootConfigPath,
        config,
        true,
      );
      for (const p of toRemove) removePath(p);

      for (const p of createdPaths) {
        expect(fs.existsSync(p)).toBe(false);
      }
      expect(fs.existsSync(rootConfigPath)).toBe(false);
      expect(fs.existsSync(modelPath)).toBe(false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
