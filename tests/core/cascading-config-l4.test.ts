import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfig } from "../../src/core/cascading-config.js";

describe("resolveConfig × levels.code", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-l4-config-"));
    // Ensure the walker stops at the fixture root rather than wandering
    // into the real repo's config.
    fs.mkdirSync(path.join(tmp, ".git"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeConfig(dir: string, body: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "diagram-docs.yaml"), body, "utf-8");
  }

  it("submodule override can turn levels.code off when root enables it", () => {
    writeConfig(tmp, "levels:\n  code: true\n");
    const subDir = path.join(tmp, "services", "api");
    writeConfig(subDir, "levels:\n  code: false\n");

    const rootCfg = resolveConfig(tmp, tmp);
    const subCfg = resolveConfig(subDir, tmp);
    expect(rootCfg.levels.code).toBe(true);
    expect(subCfg.levels.code).toBe(false);
  });

  it("submodule override can turn levels.code on when root disables it", () => {
    writeConfig(tmp, "levels:\n  code: false\n");
    const subDir = path.join(tmp, "services", "api");
    writeConfig(subDir, "levels:\n  code: true\n");

    const rootCfg = resolveConfig(tmp, tmp);
    const subCfg = resolveConfig(subDir, tmp);
    expect(rootCfg.levels.code).toBe(false);
    expect(subCfg.levels.code).toBe(true);
  });

  it("default is false when no config mentions levels.code", () => {
    writeConfig(tmp, "system:\n  name: Test\n");
    const cfg = resolveConfig(tmp, tmp);
    expect(cfg.levels.code).toBe(false);
  });
});
