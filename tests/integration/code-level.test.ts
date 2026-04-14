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
 * export — Task 18 introduced `generateCodeLevelDiagrams` as the L4 helper
 * and we drive the rest by hand.
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
});
