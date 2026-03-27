import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { encode } from "gpt-tokenizer";
import { getAnalyzer } from "../../src/analyzers/registry.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { loadConfig } from "../../src/config/loader.js";
import type {
  RawStructure,
  ScannedApplication,
} from "../../src/analyzers/types.js";
import type { TokenReport } from "./helpers/types.js";
import {
  formatTokenReport,
  generateTokenSuggestions,
} from "./helpers/reporter.js";

const MONOREPO = path.resolve(__dirname, "../fixtures/monorepo");
const CONFIG_PATH = path.join(MONOREPO, "diagram-docs.yaml");

const reports: TokenReport[] = [];

afterAll(() => {
  console.log("\n" + "=".repeat(70));
  console.log("TOKEN EFFICIENCY SUMMARY");
  console.log("=".repeat(70));

  for (const report of reports) {
    console.log(formatTokenReport(report));
  }

  const allSuggestions = reports.flatMap((r) => r.suggestions);
  if (allSuggestions.length === 0) {
    console.log("\nToken efficiency is within acceptable bounds.");
  } else {
    console.log(`\n${allSuggestions.length} suggestion(s) total.`);
  }
  console.log("");
});

function countEntities(structure: RawStructure): number {
  let count = 0;
  for (const app of structure.applications) {
    count += app.modules.length;
    count += app.externalDependencies.length;
    for (const mod of app.modules) {
      count += mod.imports.length;
    }
  }
  return count;
}

/**
 * Measure token breakdown by section to identify what's most expensive.
 */
function tokenBreakdown(structure: RawStructure): Record<string, number> {
  const breakdown: Record<string, number> = {};

  // Measure each field's contribution
  for (const app of structure.applications) {
    const appKey = `app:${app.name}`;

    // Files arrays
    let filesJson = "";
    for (const mod of app.modules) {
      filesJson += JSON.stringify(mod.files);
    }
    breakdown[`${appKey}/files`] = encode(filesJson).length;

    // Imports
    let importsJson = "";
    for (const mod of app.modules) {
      importsJson += JSON.stringify(mod.imports);
    }
    breakdown[`${appKey}/imports`] = encode(importsJson).length;

    // Exports
    let exportsJson = "";
    for (const mod of app.modules) {
      exportsJson += JSON.stringify(mod.exports);
    }
    breakdown[`${appKey}/exports`] = encode(exportsJson).length;

    // External deps
    breakdown[`${appKey}/externalDeps`] = encode(
      JSON.stringify(app.externalDependencies),
    ).length;

    // Metadata
    let metaJson = "";
    for (const mod of app.modules) {
      metaJson += JSON.stringify(mod.metadata);
    }
    breakdown[`${appKey}/metadata`] = encode(metaJson).length;
  }

  return breakdown;
}

describe("Token Efficiency: raw-structure.json", () => {
  let rawStructure: RawStructure;

  it("scans the monorepo fixture", async () => {
    const { config } = loadConfig(CONFIG_PATH);
    const discovered = await discoverApplications(MONOREPO, config);

    const applications: ScannedApplication[] = [];
    for (const app of discovered) {
      const analyzer = getAnalyzer(app.analyzerId)!;
      const result = await analyzer.analyze(path.resolve(MONOREPO, app.path), {
        exclude: config.scan.exclude,
        abstraction: config.abstraction,
      });
      result.path = app.path;
      applications.push(result);
    }

    rawStructure = {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum: "test",
      applications,
    };
  });

  it("measures pretty vs compact token counts", () => {
    const pretty = JSON.stringify(rawStructure, null, 2);
    const compact = JSON.stringify(rawStructure);

    const prettyTokens = encode(pretty).length;
    const compactTokens = encode(compact).length;
    const entityCount = countEntities(rawStructure);
    const compactSavings = 1 - compactTokens / prettyTokens;

    const report: TokenReport = {
      fixture: "monorepo (3 apps)",
      prettyTokens,
      compactTokens,
      entityCount,
      tokensPerEntity: prettyTokens / Math.max(entityCount, 1),
      compactSavings,
      suggestions: [],
    };
    report.suggestions = generateTokenSuggestions(report);
    reports.push(report);

    // Sanity: compact should be strictly smaller
    expect(compactTokens).toBeLessThan(prettyTokens);
  });

  it("provides token breakdown by section", () => {
    const breakdown = tokenBreakdown(rawStructure);

    console.log("\n  Token breakdown by section:");
    const sorted = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
    for (const [section, tokens] of sorted) {
      console.log(`    ${section}: ${tokens} tokens`);
    }

    // The files[] arrays are typically the biggest contributor — flag it
    const filesTokens = Object.entries(breakdown)
      .filter(([k]) => k.endsWith("/files"))
      .reduce((sum, [, v]) => sum + v, 0);
    const totalTokens = encode(JSON.stringify(rawStructure, null, 2)).length;
    const filesFraction = filesTokens / totalTokens;

    if (filesFraction > 0.2) {
      console.log(
        `\n  [INFO] files[] arrays account for ${(filesFraction * 100).toFixed(0)}% of tokens`,
      );
    }
  });

  it("measures token cost of individual apps", () => {
    console.log("\n  Per-app token counts:");

    for (const app of rawStructure.applications) {
      const appOnly: RawStructure = {
        ...rawStructure,
        applications: [app],
      };
      const pretty = JSON.stringify(appOnly, null, 2);
      const tokens = encode(pretty).length;
      console.log(`    ${app.name} (${app.language}): ${tokens} tokens`);
    }
  });
});
