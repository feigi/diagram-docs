import { bench, describe } from "vitest";
import * as path from "node:path";
import { javaAnalyzer } from "../../src/analyzers/java/index.js";
import { pythonAnalyzer } from "../../src/analyzers/python/index.js";
import { cAnalyzer } from "../../src/analyzers/c/index.js";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";

const MONOREPO = path.resolve(__dirname, "../fixtures/monorepo");
const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");

const defaultConfig = {
  exclude: ["**/test/**", "**/tests/**"],
  abstraction: { granularity: "balanced" as const, excludePatterns: [] },
};

describe("Analyzer performance", () => {
  bench("Java analyzer", async () => {
    await javaAnalyzer.analyze(
      path.resolve(MONOREPO, "services/user-api"),
      defaultConfig,
    );
  });

  bench("Python analyzer", async () => {
    await pythonAnalyzer.analyze(
      path.resolve(MONOREPO, "services/order-service"),
      defaultConfig,
    );
  });

  bench("C analyzer", async () => {
    await cAnalyzer.analyze(
      path.resolve(MONOREPO, "libs/mathlib"),
      defaultConfig,
    );
  });
});

describe("D2 generator performance", () => {
  const model = loadModel(MODEL_PATH);

  bench("Context diagram generation", () => {
    generateContextDiagram(model);
  });

  bench("Container diagram generation", () => {
    generateContainerDiagram(model);
  });

  bench("Component diagram generation (user-api)", () => {
    generateComponentDiagram(model, "user-api");
  });
});
