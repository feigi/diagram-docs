import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../../src/config/loader.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { getAnalyzer } from "../../src/analyzers/registry.js";
import { slugify } from "../../src/core/slugify.js";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";
import type { RawStructure, ScannedApplication } from "../../src/analyzers/types.js";

const MONOREPO = path.resolve(__dirname, "../fixtures/monorepo");
const CONFIG_PATH = path.join(MONOREPO, "diagram-docs.yaml");
const OUTPUT_DIR = path.join(MONOREPO, "test-output");

describe("Integration: Scan → Generate pipeline", () => {
  let rawStructure: RawStructure;

  afterAll(() => {
    // Clean up test output
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it("discovers all applications in the monorepo", async () => {
    const { config } = loadConfig(CONFIG_PATH);
    const apps = await discoverApplications(MONOREPO, config);

    expect(apps.length).toBe(3);
    expect(apps.some((a) => a.language === "java")).toBe(true);
    expect(apps.some((a) => a.language === "python")).toBe(true);
    expect(apps.some((a) => a.language === "c")).toBe(true);
  });

  it("scans all applications", async () => {
    const { config } = loadConfig(CONFIG_PATH);
    const discovered = await discoverApplications(MONOREPO, config);

    const applications: ScannedApplication[] = [];
    for (const app of discovered) {
      const analyzer = getAnalyzer(app.analyzerId);
      expect(analyzer).toBeTruthy();

      const result = await analyzer!.analyze(
        path.resolve(MONOREPO, app.path),
        {
          exclude: config.scan.exclude,
          abstraction: config.abstraction,
        },
      );
      // Normalize IDs the same way the scan command does
      const relativeId = slugify(app.path);
      const absolutePrefix = slugify(path.resolve(MONOREPO, app.path));
      result.path = app.path;
      result.id = relativeId;
      for (const mod of result.modules) {
        if (mod.id.startsWith(absolutePrefix)) {
          mod.id = relativeId + mod.id.slice(absolutePrefix.length);
        }
      }

      applications.push(result);
    }

    rawStructure = {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum: "test",
      applications,
    };

    expect(rawStructure.applications.length).toBe(3);

    // Java app should have modules
    const javaApp = rawStructure.applications.find(
      (a) => a.language === "java",
    );
    expect(javaApp!.modules.length).toBeGreaterThan(0);

    // Python app should have modules
    const pyApp = rawStructure.applications.find(
      (a) => a.language === "python",
    );
    expect(pyApp!.modules.length).toBeGreaterThan(0);

    // C app should have modules
    const cApp = rawStructure.applications.find((a) => a.language === "c");
    expect(cApp!.modules.length).toBeGreaterThan(0);
  });

  it("generates all D2 diagram levels from a model", () => {
    const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");
    const model = loadModel(MODEL_PATH);

    // Generate all levels
    const context = generateContextDiagram(model);
    const container = generateContainerDiagram(model);
    const component = generateComponentDiagram(model, "user-api");

    // Verify each is valid D2 (non-empty, has expected markers)
    expect(context).toContain("# C4 Context Diagram");
    expect(container).toContain("# C4 Container Diagram");
    expect(component).toContain("# C4 Component Diagram");

    // Write to output dir for manual inspection
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, "context.d2"), context);
    fs.writeFileSync(path.join(OUTPUT_DIR, "container.d2"), container);
    const componentDir = path.join(OUTPUT_DIR, "containers", "user-api");
    fs.mkdirSync(componentDir, { recursive: true });
    fs.writeFileSync(path.join(componentDir, "component.d2"), component);
  });

  it("scan output is valid JSON matching the schema", () => {
    // Verify the raw structure matches expected shape
    expect(rawStructure.version).toBe(1);
    expect(typeof rawStructure.scannedAt).toBe("string");

    // IDs must be relative, not contain the absolute fixture path
    const absoluteSlug = slugify(MONOREPO);

    for (const app of rawStructure.applications) {
      expect(typeof app.id).toBe("string");
      expect(typeof app.path).toBe("string");
      expect(["java", "python", "c"]).toContain(app.language);
      expect(Array.isArray(app.modules)).toBe(true);
      expect(Array.isArray(app.externalDependencies)).toBe(true);
      expect(Array.isArray(app.internalImports)).toBe(true);

      // Regression: app IDs must not contain the absolute path
      expect(app.id).not.toContain(absoluteSlug);

      for (const mod of app.modules) {
        expect(typeof mod.id).toBe("string");
        expect(Array.isArray(mod.files)).toBe(true);
        expect(Array.isArray(mod.exports)).toBe(true);
        expect(Array.isArray(mod.imports)).toBe(true);

        // Regression: module IDs must not contain the absolute path
        expect(mod.id).not.toContain(absoluteSlug);
      }
    }
  });
});

describe("Integration: Post-scan cross-app coordinate matching", () => {
  it("promotes matching external deps to internalImports", async () => {
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

  it("does not create self-referencing imports", async () => {
    const apps: ScannedApplication[] = [
      {
        id: "self-ref",
        path: "self-ref",
        name: "self-ref",
        language: "java",
        buildFile: "build.gradle",
        modules: [],
        externalDependencies: [
          { name: "com.example:self-ref", version: "1.0.0" },
        ],
        internalImports: [],
        publishedAs: "com.example:self-ref",
      },
    ];

    const { matchCrossAppCoordinates } = await import("../../src/cli/commands/scan.js");
    matchCrossAppCoordinates(apps);

    expect(apps[0].internalImports).toHaveLength(0);
    expect(apps[0].externalDependencies).toHaveLength(1);
  });
});
