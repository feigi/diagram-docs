import { bench, describe } from "vitest";
import * as path from "node:path";
import { javaAnalyzer } from "../../src/analyzers/java/index.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/monorepo/services/user-api",
);

describe("scan performance with and without code level", () => {
  bench("baseline (levels.code: false)", async () => {
    await javaAnalyzer.analyze(FIXTURE, {
      exclude: [],
      abstraction: { granularity: "balanced", excludePatterns: [] },
      levels: { context: true, container: true, component: true, code: false },
    } as any);
  });

  bench("with code extraction (levels.code: true)", async () => {
    await javaAnalyzer.analyze(FIXTURE, {
      exclude: [],
      abstraction: { granularity: "balanced", excludePatterns: [] },
      levels: { context: true, container: true, component: true, code: true },
      code: { includePrivate: false, includeMembers: true, minElements: 2 },
    } as any);
  });
});
