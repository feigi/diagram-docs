import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runScanAll } from "../../src/core/scan.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";

const MONOREPO_ROOT = path.resolve(__dirname, "../fixtures/monorepo");

describe("levels.code toggle preserves L1-L3 model cache", () => {
  const tmpRoot = path.join(os.tmpdir(), `dd-l4-toggle-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("a prior run with levels.code=false followed by levels.code=true yields no modelStaleProjects", async () => {
    const off = buildEffectiveConfig(
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildEffectiveConfig(
      configSchema.parse({ levels: { code: true } }),
    );

    const projects = await discoverApplications(tmpRoot, off);
    await runScanAll({ rootDir: tmpRoot, config: off, projects });

    const second = await runScanAll({
      rootDir: tmpRoot,
      config: on,
      projects,
    });

    expect(second.modelStaleProjects).toEqual([]);
    expect(second.staleProjects.length).toBeGreaterThan(0);
  });
});
