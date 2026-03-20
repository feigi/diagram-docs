import { bench, describe } from "vitest";
import * as path from "node:path";
import { loadConfig } from "../../src/config/loader.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { getAnalyzer } from "../../src/analyzers/registry.js";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";
import type { ScannedApplication } from "../../src/analyzers/types.js";

const MONOREPO = path.resolve(__dirname, "../fixtures/monorepo");
const CONFIG_PATH = path.join(MONOREPO, "diagram-docs.yaml");
const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");

describe("End-to-end pipeline", () => {
  bench("Discovery: find all apps in monorepo", async () => {
    const { config } = loadConfig(CONFIG_PATH);
    await discoverApplications(MONOREPO, config);
  });

  bench("Full scan: discover + analyze all apps", async () => {
    const { config } = loadConfig(CONFIG_PATH);
    const discovered = await discoverApplications(MONOREPO, config);

    for (const app of discovered) {
      const analyzer = getAnalyzer(app.analyzerId)!;
      await analyzer.analyze(path.resolve(MONOREPO, app.path), {
        exclude: config.scan.exclude,
        abstraction: config.abstraction,
      });
    }
  });

  bench("Full generate: all C4 levels from model", () => {
    const model = loadModel(MODEL_PATH);
    generateContextDiagram(model);
    generateContainerDiagram(model);
    for (const container of model.containers) {
      generateComponentDiagram(model, container.id);
    }
  });
});
