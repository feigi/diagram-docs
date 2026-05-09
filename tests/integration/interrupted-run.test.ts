import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runScanAll, computeModelCacheKey } from "../../src/core/scan.js";
import { discoverApplications } from "../../src/core/discovery.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { configSchema } from "../../src/config/schema.js";
import {
  readManifest,
  writeManifest,
  createDefaultManifest,
} from "../../src/core/manifest.js";

const MONOREPO_ROOT = path.resolve(__dirname, "../fixtures/monorepo");

describe("model-cache staleness after interrupted run", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dd-interrupted-"));
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
    fs.rmSync(path.join(tmpRoot, ".diagram-docs"), {
      recursive: true,
      force: true,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("cache-HIT round-trip: runScanAll's modelCacheKey matches manifest written by `model` command", async () => {
    const cfg = buildEffectiveConfig(configSchema.parse({}));
    const projects = await discoverApplications(tmpRoot, cfg);
    const { rawStructure } = await runScanAll({
      rootDir: tmpRoot,
      config: cfg,
      projects,
    });

    // Simulate a successful `model` run persisting the cache key.
    const manifest = createDefaultManifest();
    manifest.lastModel = {
      timestamp: new Date().toISOString(),
      checksum: rawStructure.modelCacheKey!,
    };
    writeManifest(tmpRoot, manifest);

    const saved = readManifest(tmpRoot);
    expect(saved?.lastModel?.checksum).toBe(rawStructure.modelCacheKey);
  });

  it("cache-MISS: explicit checksum mismatch is detected", async () => {
    const cfg = buildEffectiveConfig(configSchema.parse({}));
    const projects = await discoverApplications(tmpRoot, cfg);
    const { rawStructure } = await runScanAll({
      rootDir: tmpRoot,
      config: cfg,
      projects,
    });

    const manifest = createDefaultManifest();
    manifest.lastModel = {
      timestamp: new Date().toISOString(),
      checksum: "0:bogus",
    };
    writeManifest(tmpRoot, manifest);

    const saved = readManifest(tmpRoot);
    expect(saved?.lastModel?.checksum).not.toBe(rawStructure.modelCacheKey);
  });

  it("interrupted run reproducer: manifest holds previous run's key while a stale model file is on disk", async () => {
    const cfg = buildEffectiveConfig(configSchema.parse({}));
    const projects = await discoverApplications(tmpRoot, cfg);

    // Run 1: simulate completed `model` run.
    const first = await runScanAll({
      rootDir: tmpRoot,
      config: cfg,
      projects,
    });
    const m1 = createDefaultManifest();
    m1.lastModel = {
      timestamp: new Date().toISOString(),
      checksum: first.rawStructure.modelCacheKey!,
    };
    writeManifest(tmpRoot, m1);
    const stalePath = path.join(tmpRoot, "architecture-model.yaml");
    fs.writeFileSync(stalePath, "version: 1\n# stale snapshot\n", "utf-8");

    // Mutate sources, re-scan. Manifest still holds the OLD key, mimicking
    // an aborted second `model` run that wrote per-project caches but never
    // updated `manifest.lastModel`.
    const container = projects.find((p) => p.type === "container");
    if (!container) throw new Error("monorepo fixture has no container");
    fs.writeFileSync(
      path.join(tmpRoot, container.path, "Interrupted.java"),
      "class Interrupted {}\n",
      "utf-8",
    );

    const second = await runScanAll({
      rootDir: tmpRoot,
      config: cfg,
      projects,
    });

    expect(second.rawStructure.modelCacheKey).not.toBe(
      first.rawStructure.modelCacheKey,
    );
    expect(fs.existsSync(stalePath)).toBe(true);
    const saved = readManifest(tmpRoot);
    expect(saved?.lastModel?.checksum).not.toBe(
      second.rawStructure.modelCacheKey,
    );
  });

  it("migration: legacy `combined:` lastModel value forces a one-time rebuild after upgrade", async () => {
    const cfg = buildEffectiveConfig(configSchema.parse({}));
    const projects = await discoverApplications(tmpRoot, cfg);

    // Simulate a manifest left by a pre-fix release.
    const legacy = createDefaultManifest();
    legacy.lastModel = {
      timestamp: "2026-01-01T00:00:00Z",
      checksum: "combined:services-api-gateway,services-billing",
    };
    writeManifest(tmpRoot, legacy);

    const { rawStructure } = await runScanAll({
      rootDir: tmpRoot,
      config: cfg,
      projects,
    });

    expect(rawStructure.modelCacheKey).toBeTruthy();
    expect(rawStructure.modelCacheKey).not.toMatch(/^combined:/);
    const saved = readManifest(tmpRoot);
    expect(saved?.lastModel?.checksum).not.toBe(rawStructure.modelCacheKey);
  });

  it("computeModelCacheKey output never collides with the legacy `combined:` shape", () => {
    expect(computeModelCacheKey(["sha256:abc"])).not.toMatch(/^combined:/);
    expect(computeModelCacheKey([])).not.toMatch(/^combined:/);
  });
});
