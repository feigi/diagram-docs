import { describe, it, expect } from "vitest";
import {
  buildEffectiveConfig,
  computeEffectiveExcludes,
} from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";
import { getRegistry } from "../../src/analyzers/registry.js";

describe("buildEffectiveConfig", () => {
  it("returns a config whose scan.exclude equals computeEffectiveExcludes", () => {
    const config = configSchema.parse({});
    const effective = buildEffectiveConfig(config);
    expect(effective.scan.exclude).toEqual(
      computeEffectiveExcludes(config, getRegistry()),
    );
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
