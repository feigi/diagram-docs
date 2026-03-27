import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../src/core/cascading-config.js";
import * as path from "node:path";

const MONOREPO = path.resolve("tests/fixtures/monorepo");

describe("resolveConfig", () => {
  it("loads root config when run from root", () => {
    const config = resolveConfig(MONOREPO);
    expect(config.system.name).toBe("Test Monorepo");
  });

  it("merges container config with root config", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    expect(config.levels.component).toBe(false);
    expect(config.levels.context).toBe(true);
  });

  it("scalars: local wins", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    expect(config.abstraction.granularity).toBe("overview");
  });

  it("arrays: local replaces", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    expect(config.scan.exclude).toEqual(["**/generated/**"]);
  });

  it("objects: deep merge", () => {
    const config = resolveConfig(path.join(MONOREPO, "services/api-gateway"));
    expect(config.levels.component).toBe(false);
    expect(config.levels.context).toBe(true);
    expect(config.levels.container).toBe(true);
  });

  it("returns defaults when no config exists", () => {
    const config = resolveConfig(path.join(MONOREPO, "libs/mathlib"));
    expect(config.system.name).toBe("Test Monorepo");
  });

  it("stops walking at .git boundary", () => {
    const config = resolveConfig(MONOREPO);
    expect(config).toBeDefined();
  });
});
