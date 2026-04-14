import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../../src/config/loader.js";
import { loadModel } from "../../src/core/model.js";
import { buildModel } from "../../src/core/model-builder.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateSubmoduleDocs } from "../../src/generator/d2/submodule-scaffold.js";
import { configSchema } from "../../src/config/schema.js";
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
});
