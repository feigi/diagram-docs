import { describe, it, expect, afterAll } from "vitest";
import { resolveSubmoduleLink } from "../../src/cli/commands/generate.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../../src/config/loader.js";
import { loadModel } from "../../src/core/model.js";
import { buildModel } from "../../src/core/model-builder.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateSubmoduleDocs } from "../../src/generator/d2/submodule-scaffold.js";
import { removeStaleSubmoduleDirs } from "../../src/generator/d2/cleanup.js";
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

// CI runners don't install the `d2` CLI, so a missing-d2 exit=1 is expected
// and acceptable for generate-pipeline integration tests — the assertion
// intent is "model + scaffolds were written", not "SVGs rendered".
function expectGenerateOk(result: {
  status: number | null;
  stderr: string | null;
}): void {
  const stderr = result.stderr ?? "";
  if (result.status === 0) return;
  if (result.status === 1 && stderr.includes("d2 CLI not found")) return;
  expect(result.status, stderr).toBe(0);
}

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
    ).outputs;

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
    ).outputs;

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
    ).outputs;
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

  it("skips aggregator containers whose path is an ancestor of another container", () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-aggregator");
    trackDir(tmpRoot);

    const model: import("../../src/analyzers/types.js").ArchitectureModel = {
      version: 1,
      system: { name: "T", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "Charging App",
          description: "",
          technology: "Java / Spring Boot",
          path: "los-cha/app",
        },
      ],
      components: [],
      relationships: [],
    };

    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { context: true, container: true, component: true },
    });

    const subResults = generateSubmoduleDocs(
      tmpRoot,
      OUTPUT_DIR,
      model,
      config,
    ).outputs;

    // Aggregator skipped, leaf kept.
    expect(subResults.map((s) => s.containerId).sort()).toEqual([
      "los-cha-app",
    ]);

    // No docs dir scaffolded at the aggregator path.
    expect(fs.existsSync(path.join(tmpRoot, "los-cha", "docs"))).toBe(false);
    // No stub diagram-docs.yaml scaffolded at aggregator path.
    expect(
      fs.existsSync(path.join(tmpRoot, "los-cha", "diagram-docs.yaml")),
    ).toBe(false);

    // Leaf subproject site created as usual.
    expect(
      fs.existsSync(
        path.join(tmpRoot, "los-cha/app/docs/architecture/c3-component.d2"),
      ),
    ).toBe(true);
  });

  it("skips aggregator + cleans a pre-existing aggregator site", () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-aggregator-cleanup");
    trackDir(tmpRoot);

    // Simulate a prior run that scaffolded a site at the aggregator path.
    const archDir = path.join(tmpRoot, "los-cha/docs/architecture");
    fs.mkdirSync(path.join(archDir, "_generated"), { recursive: true });
    fs.writeFileSync(
      path.join(archDir, "c3-component.d2"),
      "# C4 Component Diagram — Los Cha\n\n...@_generated/c3-component.d2\n...@styles.d2\n\n# Add your customizations below this line\n",
    );
    fs.writeFileSync(
      path.join(archDir, "_generated", "c3-component.d2"),
      "los_cha: {}\n",
    );
    fs.writeFileSync(
      path.join(tmpRoot, "los-cha", "diagram-docs.yaml"),
      "# diagram-docs.yaml for Los Cha\n# system:\n#   name: Los Cha\n",
    );

    const model: import("../../src/analyzers/types.js").ArchitectureModel = {
      version: 1,
      system: { name: "T", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "Charging App",
          description: "",
          technology: "Java / Spring Boot",
          path: "los-cha/app",
        },
      ],
      components: [],
      relationships: [],
    };

    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpRoot, model, config);
    const subResults = generateSubmoduleDocs(
      tmpRoot,
      OUTPUT_DIR,
      model,
      config,
    ).outputs;

    // Aggregator docs/architecture gone (Task 5 deletes only the architecture
    // subtree). The parent `docs/` directory may linger empty — that's fine.
    expect(fs.existsSync(path.join(tmpRoot, "los-cha/docs/architecture"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpRoot, "los-cha/diagram-docs.yaml"))).toBe(
      false,
    );

    // Leaf site present.
    expect(subResults.map((s) => s.containerId)).toEqual(["los-cha-app"]);
    expect(
      fs.existsSync(
        path.join(tmpRoot, "los-cha/app/docs/architecture/c3-component.d2"),
      ),
    ).toBe(true);
  });

  function resolveSubmoduleLinkForTest(
    containerId: string,
    model: import("../../src/analyzers/types.js").ArchitectureModel,
    config: import("../../src/config/schema.js").Config,
  ): string | null {
    return resolveSubmoduleLink(
      containerId,
      model,
      config,
      path.join(MONOREPO, "docs", "architecture"),
    );
  }

  it("returns null drill-down link for aggregator containers in C2", () => {
    const model: import("../../src/analyzers/types.js").ArchitectureModel = {
      version: 1,
      system: { name: "T", description: "" },
      actors: [{ id: "user", name: "User", description: "" }],
      externalSystems: [],
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "Charging App",
          description: "",
          technology: "Java / Spring Boot",
          path: "los-cha/app",
        },
      ],
      components: [],
      relationships: [
        {
          sourceId: "user",
          targetId: "los-cha",
          label: "uses",
        },
        {
          sourceId: "user",
          targetId: "los-cha-app",
          label: "uses",
        },
      ],
    };

    const config = configSchema.parse({ submodules: { enabled: true } });

    const d2 = generateContainerDiagram(model, {
      componentLinks: true,
      format: "svg",
      submoduleLinkResolver: (containerId) =>
        resolveSubmoduleLinkForTest(containerId, model, config),
    });

    // Leaf gets a link; aggregator does not.
    expect(d2).toContain("los-cha/app/docs/architecture/c3-component.svg");
    // The aggregator box should not carry a link attribute pointing to a los-cha/docs path.
    expect(d2).not.toMatch(/los-cha\/docs\/architecture\/c3-component\.svg/);
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

  it("writes L4 diagrams under {appPath}/{docsDir}/architecture/components/<compId>/", () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-l4");
    trackDir(tmpRoot);
    fs.mkdirSync(tmpRoot, { recursive: true });

    const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { component: true, code: true },
      code: { minElements: 1, includePrivate: false, includeMembers: true },
    });

    const compId = model.components[0].id;
    const containerId = model.components[0].containerId;
    model.codeElements = [
      {
        id: `${compId}__synth1`,
        componentId: compId,
        containerId,
        kind: "class",
        name: "Synth1",
      },
    ];

    const codeLinks = new Set([compId]);
    const results = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, {
      codeLinks,
    }).outputs;

    const target = results.find((r) => r.containerId === containerId);
    expect(target).toBeTruthy();
    const expectedGen = path.join(
      target!.outputDir,
      "components",
      compId,
      "_generated",
      "c4-code.d2",
    );
    const expectedScaffold = path.join(
      target!.outputDir,
      "components",
      compId,
      "c4-code.d2",
    );
    expect(fs.existsSync(expectedGen)).toBe(true);
    expect(fs.existsSync(expectedScaffold)).toBe(true);

    const scaffold = fs.readFileSync(expectedScaffold, "utf-8");
    expect(scaffold).toContain("...@_generated/c4-code.d2");
  });

  it("skips L4 components below code.minElements", () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-l4-skip");
    trackDir(tmpRoot);
    fs.mkdirSync(tmpRoot, { recursive: true });

    const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
    const compId = model.components[0].id;
    const containerId = model.components[0].containerId;
    model.codeElements = [
      {
        id: `${compId}__only`,
        componentId: compId,
        containerId,
        kind: "class",
        name: "Only",
      },
    ];

    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { component: true, code: true },
      code: { minElements: 5, includePrivate: false, includeMembers: true },
    });

    const codeLinks = new Set<string>();
    const results = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, {
      codeLinks,
    }).outputs;

    const target = results.find((r) => r.containerId === containerId);
    expect(target).toBeTruthy();
    const componentsDir = path.join(target!.outputDir, "components");
    expect(fs.existsSync(componentsDir)).toBe(false);
  });

  it("skips L4 generation for containers with override.exclude: true", () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-l4-exclude");
    trackDir(tmpRoot);
    fs.mkdirSync(tmpRoot, { recursive: true });

    const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
    const compId = model.components[0].id;
    const containerId = model.components[0].containerId;
    const applicationId = model.containers.find(
      (c) => c.id === containerId,
    )!.applicationId;
    model.codeElements = [
      {
        id: `${compId}__only`,
        componentId: compId,
        containerId,
        kind: "class",
        name: "Only",
      },
    ];

    const config = configSchema.parse({
      submodules: {
        enabled: true,
        overrides: { [applicationId]: { exclude: true } },
      },
      levels: { component: true, code: true },
      code: { minElements: 1, includePrivate: false, includeMembers: true },
    });

    const codeLinks = new Set([compId]);
    const results = generateSubmoduleDocs(tmpRoot, OUTPUT_DIR, model, config, {
      codeLinks,
    }).outputs;

    // Excluded container should produce no result
    expect(results.find((r) => r.containerId === containerId)).toBeUndefined();
  });

  it("does not write root containers/<cid>/components/ tree when submodules enabled", async () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-no-root-l4");
    const tmpOutput = path.join(MONOREPO, "test-submodule-no-root-l4-output");
    trackDir(tmpRoot);
    trackDir(tmpOutput);
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.mkdirSync(tmpOutput, { recursive: true });

    const model = loadModel(path.join(MONOREPO, "architecture-model.yaml"));
    const compId = model.components[0].id;
    const containerId = model.components[0].containerId;
    model.codeElements = [
      {
        id: `${compId}__a`,
        componentId: compId,
        containerId,
        kind: "class",
        name: "A",
      },
      {
        id: `${compId}__b`,
        componentId: compId,
        containerId,
        kind: "class",
        name: "B",
      },
    ];

    generateSubmoduleDocs(
      tmpRoot,
      tmpOutput,
      model,
      configSchema.parse({
        submodules: { enabled: true },
        levels: { component: true, code: true },
        code: { minElements: 1, includePrivate: false, includeMembers: true },
      }),
      { codeLinks: new Set([compId]) },
    );

    const rootComponentsDir = path.join(
      tmpOutput,
      "containers",
      containerId,
      "components",
    );
    expect(fs.existsSync(rootComponentsDir)).toBe(false);
  });

  it(
    "`generate --submodules --deterministic` does not create root L4 dirs",
    { timeout: 60000 },
    async () => {
      const tmpRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "diagram-docs-cli-submodule-"),
      );
      try {
        fs.cpSync(MONOREPO, tmpRoot, {
          recursive: true,
          filter: (src) => !src.includes("test-"),
        });
        const cfgPath = path.join(tmpRoot, "diagram-docs.yaml");
        const raw = fs.readFileSync(cfgPath, "utf-8");
        const cfg = parseYaml(raw) ?? {};
        cfg.levels = { ...(cfg.levels ?? {}), code: true };
        cfg.code = {
          minElements: 1,
          includePrivate: false,
          includeMembers: true,
        };
        fs.writeFileSync(cfgPath, stringifyYaml(cfg), "utf-8");

        const { spawnSync } = await import("node:child_process");
        const cliCwd = path.resolve(__dirname, "../..");
        const result = spawnSync(
          "npm",
          [
            "run",
            "dev",
            "--",
            "generate",
            "--submodules",
            "--deterministic",
            "-c",
            cfgPath,
          ],
          { cwd: cliCwd, encoding: "utf-8" },
        );
        expectGenerateOk(result);

        const rootContainers = path.join(
          tmpRoot,
          "docs/architecture/containers",
        );
        if (fs.existsSync(rootContainers)) {
          for (const entry of fs.readdirSync(rootContainers)) {
            const componentsDir = path.join(
              rootContainers,
              entry,
              "components",
            );
            expect(
              fs.existsSync(componentsDir),
              `unexpected: ${componentsDir}`,
            ).toBe(false);
          }
        }
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    },
  );

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

  it('skips containers whose path === "." to avoid clobbering root site', () => {
    const tmpRoot = path.join(MONOREPO, "test-submodule-dot-path");
    trackDir(tmpRoot);

    const model: import("../../src/analyzers/types.js").ArchitectureModel = {
      version: 1,
      system: { name: "T", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "root",
          applicationId: "root",
          name: "Root",
          description: "",
          technology: "Java",
          path: ".",
        },
      ],
      components: [],
      relationships: [],
    };

    const config = configSchema.parse({ submodules: { enabled: true } });

    const subResults = generateSubmoduleDocs(
      tmpRoot,
      OUTPUT_DIR,
      model,
      config,
    ).outputs;

    // The root-pathed container must not produce a submodule site.
    expect(subResults).toEqual([]);
    expect(
      fs.existsSync(
        path.join(tmpRoot, "docs/architecture/_generated/c3-component.d2"),
      ),
    ).toBe(false);
  });

  it("end-to-end: submodule mode + L4 — generate, mutate scaffold, regenerate, preserve edits", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-submodule-l4-"));
    try {
      fs.cpSync(MONOREPO, tmp, {
        recursive: true,
        filter: (src) => !src.includes("test-"),
      });

      // Force levels.code on + minElements low enough to trigger L4
      const cfgPath = path.join(tmp, "diagram-docs.yaml");
      const cfg = parseYaml(fs.readFileSync(cfgPath, "utf-8")) ?? {};
      cfg.levels = { ...(cfg.levels ?? {}), code: true };
      cfg.code = {
        minElements: 1,
        includePrivate: false,
        includeMembers: true,
      };
      cfg.submodules = { ...(cfg.submodules ?? {}), enabled: true };
      cfg.output = { ...(cfg.output ?? {}), generators: ["d2"] };
      fs.writeFileSync(cfgPath, stringifyYaml(cfg), "utf-8");

      const { spawnSync } = await import("node:child_process");
      // The CLI's npm run dev script lives in the worktree, not in the tmp fixture
      // copy. Run from the worktree root and pass the tmp config explicitly.
      const cliCwd = path.resolve(__dirname, "../..");

      // First generate
      let result = spawnSync(
        "npm",
        ["run", "dev", "--", "generate", "--deterministic", "-c", cfgPath],
        { cwd: cliCwd, encoding: "utf-8" },
      );
      expectGenerateOk(result);

      // Find at least one submodule L4 scaffold
      function findScaffolds(dir: string, out: string[]): string[] {
        if (!fs.existsSync(dir)) return out;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) findScaffolds(full, out);
          else if (
            entry.name === "c4-code.d2" &&
            full.includes("/architecture/components/") &&
            !full.includes("/_generated/")
          ) {
            out.push(full);
          }
        }
        return out;
      }
      const scaffolds = findScaffolds(tmp, []);
      expect(scaffolds.length).toBeGreaterThan(0);

      // Append a user marker line
      const target = scaffolds[0];
      const userMark = "user_marker_42.style.fill: hotpink";
      fs.appendFileSync(target, `\n${userMark}\n`, "utf-8");

      // Second generate
      result = spawnSync(
        "npm",
        ["run", "dev", "--", "generate", "--deterministic", "-c", cfgPath],
        { cwd: cliCwd, encoding: "utf-8" },
      );
      expectGenerateOk(result);

      // User content preserved
      const after = fs.readFileSync(target, "utf-8");
      expect(after).toContain(userMark);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 120000);
});
