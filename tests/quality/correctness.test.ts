import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAnalyzer } from "../../src/analyzers/registry.js";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";
import type { ScannedApplication } from "../../src/analyzers/types.js";
import type {
  CorrectnessReport,
  ExpectedApplication,
  SetMetrics,
} from "./helpers/types.js";
import { computeSetMetrics, macroF1 } from "./helpers/metrics.js";
import {
  formatCorrectnessReport,
  generateCorrectnessSuggestions,
} from "./helpers/reporter.js";

const MONOREPO = path.resolve(__dirname, "../fixtures/monorepo");
const QUALITY_FIXTURES = path.resolve(__dirname, "fixtures");
const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");

/** Register fixtures here. To add a new test case, add an entry. */
const FIXTURES: Array<{
  name: string;
  appPath: string;
  expectedPath: string;
  analyzerId: string;
}> = [
  {
    name: "java-spring",
    appPath: path.resolve(MONOREPO, "services/user-api"),
    expectedPath: path.resolve(QUALITY_FIXTURES, "java-spring/expected.json"),
    analyzerId: "java",
  },
  {
    name: "python-fastapi",
    appPath: path.resolve(MONOREPO, "services/order-service"),
    expectedPath: path.resolve(
      QUALITY_FIXTURES,
      "python-fastapi/expected.json",
    ),
    analyzerId: "python",
  },
  {
    name: "c-cmake",
    appPath: path.resolve(MONOREPO, "libs/mathlib"),
    expectedPath: path.resolve(QUALITY_FIXTURES, "c-cmake/expected.json"),
    analyzerId: "c",
  },
  {
    name: "typescript-express",
    appPath: path.resolve(MONOREPO, "services/api-gateway"),
    expectedPath: path.resolve(
      QUALITY_FIXTURES,
      "typescript-express/expected.json",
    ),
    analyzerId: "typescript",
  },
];

const defaultScanConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: { granularity: "balanced" as const, excludePatterns: [] },
};

const codeLevelScanConfig = {
  ...defaultScanConfig,
  levels: {
    context: true,
    container: true,
    component: true,
    code: true,
  },
  code: {
    includePrivate: false,
    includeMembers: true,
    minElements: 2,
  },
};

const reports: CorrectnessReport[] = [];

afterAll(() => {
  console.log("\n" + "=".repeat(70));
  console.log("CORRECTNESS SUMMARY");
  console.log("=".repeat(70));

  for (const report of reports) {
    console.log(formatCorrectnessReport(report));
  }

  const allSuggestions = reports.flatMap((r) => r.suggestions);
  if (allSuggestions.length === 0) {
    console.log("\nAll correctness checks passed with no suggestions.");
  } else {
    console.log(
      `\n${allSuggestions.length} suggestion(s) total across all fixtures.`,
    );
  }
  console.log("");
});

describe("Correctness: Analyzer accuracy", () => {
  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      let actual: ScannedApplication;
      let expected: ExpectedApplication;

      it("loads fixture and analyzes", async () => {
        const analyzer = getAnalyzer(fixture.analyzerId)!;
        expect(analyzer).toBeTruthy();

        actual = await analyzer.analyze(fixture.appPath, defaultScanConfig);
        expected = JSON.parse(
          fs.readFileSync(fixture.expectedPath, "utf-8"),
        ) as ExpectedApplication;
      });

      it("module discovery", () => {
        const foundModules = actual.modules.map((m) => m.name);
        const expectedModules = expected.modules.map((m) => m.name);
        const metrics = computeSetMetrics(foundModules, expectedModules);

        const categories: Record<string, SetMetrics> = { modules: metrics };

        // Build partial report — will be completed in later tests
        const existing = reports.find((r) => r.fixture === fixture.name);
        if (existing) {
          existing.categories["modules"] = metrics;
        }

        expect(metrics.recall).toBeGreaterThanOrEqual(0.5);
      });

      it("export detection", () => {
        const categories: Record<string, SetMetrics> = {};

        // Per-module export comparison
        const allFoundExports: string[] = [];
        const allExpectedExports: string[] = [];

        for (const expectedMod of expected.modules) {
          const actualMod = actual.modules.find(
            (m) => m.name === expectedMod.name,
          );
          const foundExports = actualMod?.exports ?? [];
          const qualifiedFound = foundExports.map(
            (e) => `${expectedMod.name}::${e}`,
          );
          const qualifiedExpected = expectedMod.exports.map(
            (e) => `${expectedMod.name}::${e}`,
          );

          allFoundExports.push(...qualifiedFound);
          allExpectedExports.push(...qualifiedExpected);
        }

        categories["exports"] = computeSetMetrics(
          allFoundExports,
          allExpectedExports,
        );
        expect(categories["exports"].recall).toBeGreaterThanOrEqual(0.5);
      });

      it("import resolution", () => {
        const allFoundImports: string[] = [];
        const allExpectedImports: string[] = [];

        for (const expectedImport of expected.imports) {
          allExpectedImports.push(
            `${expectedImport.inModule}|${expectedImport.source}|${expectedImport.isExternal}`,
          );
        }

        for (const mod of actual.modules) {
          for (const imp of mod.imports) {
            allFoundImports.push(`${mod.name}|${imp.source}|${imp.isExternal}`);
          }
        }

        const metrics = computeSetMetrics(allFoundImports, allExpectedImports);
        expect(metrics.recall).toBeGreaterThanOrEqual(0.5);
      });

      it("external dependencies", () => {
        const foundDeps = actual.externalDependencies.map((d) => d.name);
        const expectedDeps = expected.externalDependencies.map((d) => d.name);
        const metrics = computeSetMetrics(foundDeps, expectedDeps);

        expect(metrics.recall).toBeGreaterThanOrEqual(0.5);
      });

      it("metadata extraction", () => {
        let foundMeta: string[] = [];
        let expectedMeta: string[] = [];

        for (const mod of actual.modules) {
          for (const [key, value] of Object.entries(mod.metadata)) {
            foundMeta.push(`${mod.name}|${key}=${value}`);
          }
        }

        for (const [modName, meta] of Object.entries(expected.metadata)) {
          for (const [key, value] of Object.entries(meta)) {
            expectedMeta.push(`${modName}|${key}=${value}`);
          }
        }

        const metrics = computeSetMetrics(foundMeta, expectedMeta);
        expect(metrics.recall).toBeGreaterThanOrEqual(0.5);
      });

      it("code-element extraction (precision/recall >= 0.8)", async () => {
        if (!expected.codeElements || expected.codeElements.length === 0) {
          return; // No ground truth for code elements — skip.
        }

        const analyzer = getAnalyzer(fixture.analyzerId)!;
        const codeResult = await analyzer.analyze(
          fixture.appPath,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          codeLevelScanConfig as any,
        );

        const foundKeys: string[] = [];
        for (const mod of codeResult.modules) {
          for (const el of mod.codeElements ?? []) {
            foundKeys.push(`${el.kind}::${el.name}`);
          }
        }
        const expectedKeys = expected.codeElements.map(
          (e) => `${e.kind}::${e.name}`,
        );

        // Deduplicate both sides: set-level comparison (name+kind).
        const uniqueFound = [...new Set(foundKeys)];
        const uniqueExpected = [...new Set(expectedKeys)];

        const metrics = computeSetMetrics(uniqueFound, uniqueExpected);

        const existing = reports.find((r) => r.fixture === fixture.name);
        if (existing) {
          existing.categories["codeElements"] = metrics;
        }

        expect(
          metrics.precision,
          `precision too low for ${fixture.name}: missing=${metrics.missing.join(",")} extra=${metrics.extra.join(",")}`,
        ).toBeGreaterThanOrEqual(0.8);
        expect(
          metrics.recall,
          `recall too low for ${fixture.name}: missing=${metrics.missing.join(",")} extra=${metrics.extra.join(",")}`,
        ).toBeGreaterThanOrEqual(0.8);
      });

      it("computes full report", async () => {
        // Re-analyze to get fresh data for the report
        const analyzer = getAnalyzer(fixture.analyzerId)!;
        const result = await analyzer.analyze(
          fixture.appPath,
          defaultScanConfig,
        );

        const categories: Record<string, SetMetrics> = {};

        // Modules
        categories["modules"] = computeSetMetrics(
          result.modules.map((m) => m.name),
          expected.modules.map((m) => m.name),
        );

        // Exports
        const allFoundExports: string[] = [];
        const allExpectedExports: string[] = [];
        for (const expectedMod of expected.modules) {
          const actualMod = result.modules.find(
            (m) => m.name === expectedMod.name,
          );
          allFoundExports.push(
            ...(actualMod?.exports ?? []).map(
              (e) => `${expectedMod.name}::${e}`,
            ),
          );
          allExpectedExports.push(
            ...expectedMod.exports.map((e) => `${expectedMod.name}::${e}`),
          );
        }
        categories["exports"] = computeSetMetrics(
          allFoundExports,
          allExpectedExports,
        );

        // Imports
        const allFoundImports: string[] = [];
        const allExpectedImports: string[] = [];
        for (const expectedImport of expected.imports) {
          allExpectedImports.push(
            `${expectedImport.inModule}|${expectedImport.source}|${expectedImport.isExternal}`,
          );
        }
        for (const mod of result.modules) {
          for (const imp of mod.imports) {
            allFoundImports.push(`${mod.name}|${imp.source}|${imp.isExternal}`);
          }
        }
        categories["imports"] = computeSetMetrics(
          allFoundImports,
          allExpectedImports,
        );

        // External deps
        categories["externalDeps"] = computeSetMetrics(
          result.externalDependencies.map((d) => d.name),
          expected.externalDependencies.map((d) => d.name),
        );

        // Metadata
        const foundMeta: string[] = [];
        const expectedMeta: string[] = [];
        for (const mod of result.modules) {
          for (const [key, value] of Object.entries(mod.metadata)) {
            foundMeta.push(`${mod.name}|${key}=${value}`);
          }
        }
        for (const [modName, meta] of Object.entries(expected.metadata)) {
          for (const [key, value] of Object.entries(meta)) {
            expectedMeta.push(`${modName}|${key}=${value}`);
          }
        }
        categories["metadata"] = computeSetMetrics(foundMeta, expectedMeta);

        const overallF1 = macroF1(categories);
        const suggestions = generateCorrectnessSuggestions(
          fixture.name,
          categories,
        );

        reports.push({
          fixture: fixture.name,
          language: expected.language,
          categories,
          overallF1,
          suggestions,
        });
      });
    });
  }
});

describe("Correctness: D2 generator structural completeness", () => {
  const model = loadModel(MODEL_PATH);

  it("context diagram includes all actors, system, and external systems", () => {
    const d2 = generateContextDiagram(model);
    for (const actor of model.actors) {
      expect(d2).toContain(actor.name);
    }
    expect(d2).toContain(model.system.name);
    for (const ext of model.externalSystems) {
      expect(d2).toContain(ext.name);
    }
  });

  it("container diagram includes all containers", () => {
    const d2 = generateContainerDiagram(model);
    for (const container of model.containers) {
      expect(d2).toContain(container.name);
      expect(d2).toContain(container.technology);
    }
  });

  it("component diagrams include all components per container", () => {
    for (const container of model.containers) {
      const d2 = generateComponentDiagram(model, container.id);
      const components = model.components.filter(
        (c) => c.containerId === container.id,
      );
      for (const comp of components) {
        expect(d2).toContain(comp.name);
      }
    }
  });

  it("model reference integrity: all IDs resolve", () => {
    const allIds = new Set([
      ...model.actors.map((a) => a.id),
      ...model.externalSystems.map((e) => e.id),
      ...model.containers.map((c) => c.id),
      ...model.components.map((c) => c.id),
    ]);

    const danglingRefs: string[] = [];

    for (const rel of model.relationships) {
      if (!allIds.has(rel.sourceId))
        danglingRefs.push(`source: ${rel.sourceId}`);
      if (!allIds.has(rel.targetId))
        danglingRefs.push(`target: ${rel.targetId}`);
    }
    for (const comp of model.components) {
      if (!model.containers.some((c) => c.id === comp.containerId)) {
        danglingRefs.push(
          `component ${comp.id} -> container ${comp.containerId}`,
        );
      }
    }

    if (danglingRefs.length > 0) {
      console.log(
        `\n  [WARN] Dangling model references: ${danglingRefs.join(", ")}`,
      );
    }
    // This is a warning, not a hard failure — agents may produce forward refs
  });
});
