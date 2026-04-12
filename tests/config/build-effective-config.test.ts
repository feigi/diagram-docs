import { describe, it, expect } from "vitest";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";
import type { LanguageAnalyzer } from "../../src/analyzers/types.js";

const stubAnalyzer = (
  id: string,
  defaultExcludes: string[],
): LanguageAnalyzer =>
  ({
    id,
    buildFilePatterns: [],
    defaultExcludes,
  }) as unknown as LanguageAnalyzer;

describe("buildEffectiveConfig", () => {
  it("merges user excludes with analyzer defaults, honoring forceInclude", () => {
    const config = configSchema.parse({
      scan: {
        exclude: ["custom/**"],
        forceInclude: ["node_modules/keep/**"],
      },
    });
    const analyzers = [
      stubAnalyzer("java", ["target/**", "node_modules/**"]),
      stubAnalyzer("python", ["venv/**", "node_modules/keep/**"]),
    ];

    const effective = buildEffectiveConfig(config, analyzers);

    expect(effective.scan.exclude).toEqual(
      expect.arrayContaining(["custom/**", "target/**", "venv/**"]),
    );
    expect(effective.scan.exclude).toContain("node_modules/**");
    expect(effective.scan.exclude).not.toContain("node_modules/keep/**");
  });

  it("preserves the rest of config.scan (include, forceInclude)", () => {
    const config = configSchema.parse({
      scan: { include: ["src/**"], forceInclude: ["**/keepme/**"] },
    });
    const effective = buildEffectiveConfig(config);
    expect(effective.scan.include).toEqual(["src/**"]);
    expect(effective.scan.forceInclude).toEqual(["**/keepme/**"]);
  });

  it("preserves top-level config fields unchanged", () => {
    const config = configSchema.parse({});
    const effective = buildEffectiveConfig(config);
    expect(effective.system).toEqual(config.system);
    expect(effective.abstraction).toEqual(config.abstraction);
    expect(effective.output).toEqual(config.output);
  });

  it("does not mutate the input config", () => {
    const config = configSchema.parse({});
    const originalExclude = [...config.scan.exclude];
    buildEffectiveConfig(config);
    expect(config.scan.exclude).toEqual(originalExclude);
  });
});
