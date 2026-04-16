import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverApplications } from "../../src/core/discovery.js";
import { getAnalyzer } from "../../src/analyzers/registry.js";
import { slugify } from "../../src/core/slugify.js";
import { buildModel } from "../../src/core/model-builder.js";
import { loadConfig, buildEffectiveConfig } from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";
import { generateCodeLevelDiagrams } from "../../src/cli/commands/generate.js";
import { scaffoldUserFiles } from "../../src/generator/d2/scaffold.js";
import type {
  RawStructure,
  ScannedApplication,
  ArchitectureModel,
} from "../../src/analyzers/types.js";
import type { Config } from "../../src/config/schema.js";

const FIXTURE = path.resolve(__dirname, "../fixtures/monorepo");

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

/**
 * Runs scan (via analyzer registry) + buildModel + generateCodeLevelDiagrams
 * against a workspace directory, mirroring the composition the `generate`
 * command uses. Kept local to the test since there's no single `runGenerate`
 * export.
 */
async function runPipeline(workDir: string): Promise<{
  model: ArchitectureModel;
  config: Config;
  outputDir: string;
}> {
  const configPath = path.join(workDir, "diagram-docs.yaml");
  const { config: baseConfig } = loadConfig(configPath);
  // Force L4 on + overview granularity (one component per container) so the
  // user-api container clears the `minElements: 2` threshold with its two
  // Java classes (UserController + UserRepository).
  const merged = configSchema.parse({
    ...baseConfig,
    levels: { ...baseConfig.levels, code: true },
    code: { includePrivate: false, includeMembers: true, minElements: 2 },
    abstraction: { ...baseConfig.abstraction, granularity: "overview" },
  });
  const config = buildEffectiveConfig(merged);

  const discovered = await discoverApplications(workDir, config);
  const applications: ScannedApplication[] = [];
  for (const app of discovered) {
    const analyzer = getAnalyzer(app.analyzerId);
    if (!analyzer) continue;
    const result = await analyzer.analyze(path.resolve(workDir, app.path), {
      exclude: config.scan.exclude,
      abstraction: config.abstraction,
      levels: config.levels,
      code: config.code,
    });
    const relativeId = slugify(app.path);
    const absolutePrefix = slugify(path.resolve(workDir, app.path));
    result.path = app.path;
    result.id = relativeId;
    for (const mod of result.modules) {
      if (mod.id.startsWith(absolutePrefix)) {
        mod.id = relativeId + mod.id.slice(absolutePrefix.length);
      }
    }
    applications.push(result);
  }

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: "test",
    applications,
  };

  const model = buildModel({ config, rawStructure });

  const outputDir = path.resolve(workDir, config.output.dir);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, "_generated"), { recursive: true });

  generateCodeLevelDiagrams({ model, config, outputDir, rawStructure });
  // Scaffold user-facing files last — matches the order in generate.ts.
  scaffoldUserFiles(outputDir, model, config);

  return { model, config, outputDir };
}

describe("c4-code integration", () => {
  let workDir: string;
  let outputDir: string;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-l4-"));
    fs.cpSync(FIXTURE, workDir, { recursive: true });

    // Clear any pre-existing docs/ tree inherited from the fixture so the
    // "creates scaffold" and "preserves user edits" checks observe a clean run.
    const existingDocs = path.join(workDir, "docs", "architecture");
    if (fs.existsSync(existingDocs)) {
      fs.rmSync(existingDocs, { recursive: true, force: true });
    }

    const result = await runPipeline(workDir);
    outputDir = result.outputDir;
  });

  afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("creates _generated/c4-code.d2 for at least one component", () => {
    const matches = findFilesRecursive(outputDir, "c4-code.d2");
    const generated = matches.filter((p) =>
      p.includes(`${path.sep}_generated${path.sep}`),
    );
    expect(generated.length).toBeGreaterThan(0);
  });

  it("creates a user-facing scaffold at containers/.../components/.../c4-code.d2", () => {
    const matches = findFilesRecursive(outputDir, "c4-code.d2");
    const scaffolds = matches.filter(
      (p) => !p.includes(`${path.sep}_generated${path.sep}`),
    );
    expect(scaffolds.length).toBeGreaterThan(0);
    // Sanity: scaffolded file sits under containers/<id>/components/<id>/
    expect(scaffolds[0]).toMatch(
      /containers\/[^/]+\/components\/[^/]+\/c4-code\.d2$/,
    );
  });

  it("preserves user edits on re-run", async () => {
    const matches = findFilesRecursive(outputDir, "c4-code.d2");
    const scaffold = matches.find(
      (p) => !p.includes(`${path.sep}_generated${path.sep}`),
    );
    expect(scaffold).toBeDefined();

    const marker = "# USER-EDIT-SENTINEL";
    fs.appendFileSync(scaffold!, `\n${marker}\n`);

    // Re-run the full pipeline — scaffold must NOT be overwritten.
    await runPipeline(workDir);

    const after = fs.readFileSync(scaffold!, "utf-8");
    expect(after).toContain(marker);
  });

  it("preserves user edits when the _generated sibling changes", async () => {
    const matches = findFilesRecursive(outputDir, "c4-code.d2");
    const scaffold = matches.find(
      (p) => !p.includes(`${path.sep}_generated${path.sep}`),
    );
    expect(scaffold).toBeDefined();
    const generated = path.join(
      path.dirname(scaffold!),
      "_generated",
      "c4-code.d2",
    );
    expect(fs.existsSync(generated)).toBe(true);

    const marker = "# KEEP-EDIT-AFTER-GEN-CHANGES";
    fs.appendFileSync(scaffold!, `\n${marker}\n`);

    // Mutate the generated file directly to simulate a scan/model change
    // upstream of the scaffold — the scaffold contract is that user edits
    // stay intact regardless of generated-sibling churn.
    const before = fs.readFileSync(generated, "utf-8");
    fs.writeFileSync(generated, before + "\n# generated-mutated\n");

    await runPipeline(workDir);

    const scaffoldAfter = fs.readFileSync(scaffold!, "utf-8");
    expect(scaffoldAfter).toContain(marker);
  });
});

describe("c4-code default-off", () => {
  it("does not emit c4-code.d2 files when levels.code is false", async () => {
    const workDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "diagram-docs-l4-off-"),
    );
    try {
      fs.cpSync(FIXTURE, workDir, { recursive: true });
      const existingDocs = path.join(workDir, "docs", "architecture");
      if (fs.existsSync(existingDocs)) {
        fs.rmSync(existingDocs, { recursive: true, force: true });
      }

      // Copy of runPipeline intentionally skipping the levels.code override.
      const { loadConfig: load } = await import("../../src/config/loader.js");
      const { configSchema: cs } = await import("../../src/config/schema.js");
      const { buildEffectiveConfig: eff } =
        await import("../../src/config/loader.js");
      const { buildModel } = await import("../../src/core/model-builder.js");
      const { generateCodeLevelDiagrams } =
        await import("../../src/cli/commands/generate.js");

      const configPath = path.join(workDir, "diagram-docs.yaml");
      const { config: baseConfig } = load(configPath);
      const merged = cs.parse({
        ...baseConfig,
        levels: { ...baseConfig.levels, code: false },
      });
      const config = eff(merged);

      const discovered = await discoverApplications(workDir, config);
      const applications: ScannedApplication[] = [];
      for (const app of discovered) {
        const analyzer = getAnalyzer(app.analyzerId);
        if (!analyzer) continue;
        const result = await analyzer.analyze(path.resolve(workDir, app.path), {
          exclude: config.scan.exclude,
          abstraction: config.abstraction,
          levels: config.levels,
          code: config.code,
        });
        applications.push(result);
      }
      const rawStructure: RawStructure = {
        version: 1,
        scannedAt: new Date().toISOString(),
        checksum: "test",
        applications,
      };
      const model = buildModel({ config, rawStructure });
      const outDir = path.resolve(workDir, config.output.dir);
      fs.mkdirSync(outDir, { recursive: true });

      // With levels.code: false the caller skips this helper entirely —
      // simulate by NOT calling it. Verify no c4-code.d2 appears and no
      // components/ tree is created.
      // (Belt-and-braces: even if we DID call it, the model has no
      // codeElements so nothing should be emitted.)
      generateCodeLevelDiagrams({
        model,
        config,
        outputDir: outDir,
        rawStructure,
      });

      const matches = findFilesRecursive(outDir, "c4-code.d2");
      expect(matches).toEqual([]);
      expect(model.codeElements ?? []).toEqual([]);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe("generateCodeLevelDiagrams profile fallback", () => {
  it("picks C profile from struct/typedef kinds when rawStructure is omitted", async () => {
    const workDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "diagram-docs-l4-nfs-"),
    );
    try {
      const outDir = path.join(workDir, "docs", "architecture");
      fs.mkdirSync(outDir, { recursive: true });
      const model: ArchitectureModel = {
        version: 1,
        system: { name: "s", description: "" },
        actors: [],
        externalSystems: [],
        containers: [
          {
            id: "lib",
            applicationId: "lib",
            name: "lib",
            description: "",
            technology: "c",
          } as any,
        ],
        components: [
          {
            id: "ht",
            containerId: "lib",
            name: "ht",
            description: "",
            technology: "c",
            moduleIds: ["ht"],
          } as any,
        ],
        relationships: [],
        codeElements: [
          {
            id: "lib.ht.hash_table",
            componentId: "ht",
            containerId: "lib",
            kind: "struct",
            name: "hash_table",
            visibility: "public",
          } as any,
          {
            id: "lib.ht.hash_entry",
            componentId: "ht",
            containerId: "lib",
            kind: "typedef",
            name: "hash_entry",
            visibility: "public",
          } as any,
        ],
        codeRelationships: [],
      };
      const config = configSchema.parse({
        levels: { code: true },
        code: { includePrivate: false, includeMembers: true, minElements: 1 },
      });
      const result = generateCodeLevelDiagrams({
        model,
        config: buildEffectiveConfig(config),
        outputDir: outDir,
      });
      expect(result.written).toBe(1);
      const out = fs.readFileSync(
        path.join(
          outDir,
          "containers",
          "lib",
          "components",
          "ht",
          "_generated",
          "c4-code.d2",
        ),
        "utf-8",
      );
      // C profile emits a `types: { ... Types` container — the Java/TS/Py
      // profile would not.
      expect(out).toMatch(/types:.*\{/);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe("generateCodeLevelDiagrams skipped count", () => {
  it("reports skipped for components below minElements", async () => {
    const workDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "diagram-docs-l4-skip-"),
    );
    try {
      fs.cpSync(FIXTURE, workDir, { recursive: true });
      const existingDocs = path.join(workDir, "docs", "architecture");
      if (fs.existsSync(existingDocs)) {
        fs.rmSync(existingDocs, { recursive: true, force: true });
      }
      const configPath = path.join(workDir, "diagram-docs.yaml");
      const { config: baseConfig } = loadConfig(configPath);
      // Require 99 elements per component so nothing qualifies.
      const merged = configSchema.parse({
        ...baseConfig,
        levels: { ...baseConfig.levels, code: true },
        code: { includePrivate: false, includeMembers: true, minElements: 99 },
        abstraction: { ...baseConfig.abstraction, granularity: "overview" },
      });
      const config = buildEffectiveConfig(merged);
      const discovered = await discoverApplications(workDir, config);
      const applications: ScannedApplication[] = [];
      for (const app of discovered) {
        const analyzer = getAnalyzer(app.analyzerId);
        if (!analyzer) continue;
        applications.push(
          await analyzer.analyze(path.resolve(workDir, app.path), {
            exclude: config.scan.exclude,
            abstraction: config.abstraction,
            levels: config.levels,
            code: config.code,
          }),
        );
      }
      const rawStructure: RawStructure = {
        version: 1,
        scannedAt: new Date().toISOString(),
        checksum: "test",
        applications,
      };
      const model = buildModel({ config, rawStructure });
      const outDir = path.resolve(workDir, config.output.dir);
      fs.mkdirSync(outDir, { recursive: true });

      const result = generateCodeLevelDiagrams({
        model,
        config,
        outputDir: outDir,
        rawStructure,
      });
      expect(result.written).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.skipped).toBeGreaterThan(0);
      const matches = findFilesRecursive(outDir, "c4-code.d2");
      expect(matches).toEqual([]);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
