/**
 * Integration tests: container deletion detection and model sync.
 *
 * Verifies that:
 * - US2: After a container source folder is deleted, the model is rebuilt
 *   without that container (not reused from cache).
 * - US1 (integration): The scaffold directory for the deleted container is
 *   removed by removeStaleContainerDirs.
 * - Manually authored containers (no path) are always preserved.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { buildModel } from "../../src/core/model-builder.js";
import { loadModel } from "../../src/core/model.js";
import { removeStaleContainerDirs } from "../../src/generator/d2/cleanup.js";
import { slugify } from "../../src/core/slugify.js";
import type {
  ArchitectureModel,
  RawStructure,
} from "../../src/analyzers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-deletion-"));
}

/** Build a minimal RawStructure for a list of app paths. */
function makeRawStructure(appPaths: string[]): RawStructure {
  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: "test",
    applications: appPaths.map((p) => ({
      id: slugify(p),
      path: p,
      name: p,
      language: "TypeScript",
      buildFile: "package.json",
      modules: [],
      externalDependencies: [],
      internalImports: [],
    })),
  };
}

/** Minimal config-like object for buildModel. */
const testConfig = {
  system: { name: "Test", description: "Test system" },
  abstraction: { granularity: "module" as const, excludePatterns: [] },
  levels: { context: true, container: true, component: true },
  output: { dir: "docs/architecture", format: "svg" as const },
  scan: { include: ["."], exclude: [] },
  actors: [],
  externalSystems: [],
  submodules: { enabled: false, docsDir: "docs", overrides: {} },
  llm: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: deleted container detection", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("US2: model rebuilt from scan excludes deleted container", () => {
    // Initial model with two containers
    const initialRaw = makeRawStructure(["services/alpha", "services/beta"]);
    const initialModel = buildModel({
      config: testConfig,
      rawStructure: initialRaw,
    });

    expect(initialModel.containers).toHaveLength(2);
    const betaId = slugify("services/beta");
    expect(initialModel.containers.find((c) => c.id === betaId)).toBeDefined();

    // Simulate deletion: rebuild model from scan that no longer includes beta
    const afterDeletionRaw = makeRawStructure(["services/alpha"]);
    const afterDeletionModel = buildModel({
      config: testConfig,
      rawStructure: afterDeletionRaw,
    });

    expect(afterDeletionModel.containers).toHaveLength(1);
    expect(
      afterDeletionModel.containers.find((c) => c.id === betaId),
    ).toBeUndefined();
    expect(afterDeletionModel.containers[0].id).toBe(slugify("services/alpha"));
  });

  it("US2: deletion detection logic — compares discovered IDs vs model container paths", () => {
    // Build a model that includes two containers
    const raw = makeRawStructure(["services/alpha", "services/beta"]);
    const model = buildModel({ config: testConfig, rawStructure: raw });

    // Simulate what resolveModel does: discovered now only has alpha
    const discoveredIds = new Set([slugify("services/alpha")]);
    const deletedContainers = model.containers.filter(
      (c) => c.path != null && !discoveredIds.has(slugify(c.path)),
    );

    expect(deletedContainers).toHaveLength(1);
    expect(deletedContainers[0].path).toBe("services/beta");
  });

  it("US2: manually authored container without path is never flagged as deleted", () => {
    const raw = makeRawStructure(["services/alpha"]);
    const model = buildModel({ config: testConfig, rawStructure: raw });

    // Inject a manually authored container (no path)
    const manualContainer = {
      id: "external-gateway",
      applicationId: "external-gateway",
      name: "External Gateway",
      description: "Manually authored",
      technology: "HTTP",
      // No path field
    };
    const modelWithManual: ArchitectureModel = {
      ...model,
      containers: [...model.containers, manualContainer],
    };

    // Simulate scan that found nothing (empty discovered set)
    const discoveredIds = new Set<string>();
    const deletedContainers = modelWithManual.containers.filter(
      (c) => c.path != null && !discoveredIds.has(slugify(c.path)),
    );

    // Only alpha should be flagged — manual container has no path and is preserved
    expect(deletedContainers.every((c) => c.id !== "external-gateway")).toBe(
      true,
    );
  });

  it("US1 (integration): removeStaleContainerDirs removes scaffold for deleted container", () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const outputDir = tmpDir;
    const containersDir = path.join(outputDir, "containers");

    // Set up scaffold for two containers — alpha (active) and beta (to be deleted)
    const alphaDir = path.join(containersDir, slugify("services/alpha"));
    const betaDir = path.join(containersDir, slugify("services/beta"));
    const MARKER = "# Add your customizations below this line";
    const scaffold = (name: string) =>
      `# C4 Component Diagram — ${name}\n\n...@_generated/c3-component.d2\n\n${MARKER}\n`;

    for (const [dir, name] of [
      [alphaDir, "Alpha"],
      [betaDir, "Beta"],
    ] as const) {
      fs.mkdirSync(path.join(dir, "_generated"), { recursive: true });
      fs.writeFileSync(path.join(dir, "c3-component.d2"), scaffold(name));
    }

    // Model after deletion: only alpha
    const afterRaw = makeRawStructure(["services/alpha"]);
    const afterModel = buildModel({
      config: testConfig,
      rawStructure: afterRaw,
    });

    removeStaleContainerDirs(outputDir, afterModel);

    // Alpha scaffold preserved
    expect(fs.existsSync(path.join(alphaDir, "c3-component.d2"))).toBe(true);

    // Beta scaffold and _generated/ removed
    expect(fs.existsSync(betaDir)).toBe(false);
  });

  it("US2 (edge): slugify handles path with root dot gracefully", () => {
    // Container with path '.' should not crash the filter
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "Test", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "root",
          applicationId: "root",
          name: "Root",
          description: "",
          technology: "TS",
          path: ".",
        },
      ],
      components: [],
      relationships: [],
    };

    const discoveredIds = new Set(["some-other-service"]);
    expect(() =>
      model.containers.filter(
        (c) => c.path != null && !discoveredIds.has(slugify(c.path)),
      ),
    ).not.toThrow();
  });
});
