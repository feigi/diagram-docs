import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
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
    const subResults = generateSubmoduleDocs(
      MONOREPO,
      OUTPUT_DIR,
      model,
      config,
    );

    expect(subResults.length).toBeGreaterThan(0);

    // Track for cleanup
    for (const sub of subResults) {
      trackDir(path.join(MONOREPO, sub.applicationPath, "docs"));
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
});
