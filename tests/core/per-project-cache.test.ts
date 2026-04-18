import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeProjectChecksum,
  computeProjectSourceHash,
  mixFingerprint,
} from "../../src/core/checksum.js";
import {
  readProjectCache,
  writeProjectScan,
  writeProjectModel,
  isScanStale,
  isModelStale,
} from "../../src/core/per-project-cache.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MONOREPO_ROOT = path.resolve("tests/fixtures/monorepo");

describe("computeProjectChecksum", () => {
  it("computes checksum for a single project directory", async () => {
    const checksum = await computeProjectChecksum(
      path.join(MONOREPO_ROOT, "services/api-gateway"),
      [],
    );
    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces different checksums for different projects", async () => {
    const checksumA = await computeProjectChecksum(
      path.join(MONOREPO_ROOT, "services/api-gateway"),
      [],
    );
    const checksumB = await computeProjectChecksum(
      path.join(MONOREPO_ROOT, "libs/mathlib"),
      [],
    );
    expect(checksumA).not.toBe(checksumB);
  });

  it("includes config fingerprint in checksum", async () => {
    const base = path.join(MONOREPO_ROOT, "services/api-gateway");
    const without = await computeProjectChecksum(base, []);
    const with_ = await computeProjectChecksum(base, [], "fingerprint-a");
    expect(without).not.toBe(with_);
  });

  it("is deterministic", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const a = await computeProjectChecksum(dir, []);
    const b = await computeProjectChecksum(dir, []);
    expect(a).toBe(b);
  });
});

describe("computeProjectSourceHash", () => {
  it("hashes only source files (no fingerprint mixed in)", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const srcA = await computeProjectSourceHash(dir, []);
    const srcB = await computeProjectSourceHash(dir, []);
    expect(srcA).toBe(srcB);
    expect(srcA).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is independent of any fingerprint", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const src = await computeProjectSourceHash(dir, []);
    const ck = await computeProjectChecksum(dir, [], "fingerprint-a");
    expect(src).not.toBe(ck);
  });
});

describe("mixFingerprint", () => {
  it("is deterministic", () => {
    expect(mixFingerprint("sha256:abc", "fp")).toBe(
      mixFingerprint("sha256:abc", "fp"),
    );
  });

  it("produces different checksums for different fingerprints", () => {
    const a = mixFingerprint("sha256:abc", "fp-a");
    const b = mixFingerprint("sha256:abc", "fp-b");
    expect(a).not.toBe(b);
  });

  it("produces different checksums for different source hashes", () => {
    const a = mixFingerprint("sha256:aaa", "fp");
    const b = mixFingerprint("sha256:bbb", "fp");
    expect(a).not.toBe(b);
  });

  it("matches computeProjectChecksum when composed", async () => {
    const dir = path.join(MONOREPO_ROOT, "services/api-gateway");
    const src = await computeProjectSourceHash(dir, []);
    const combined = await computeProjectChecksum(dir, [], "fp-x");
    expect(mixFingerprint(src, "fp-x")).toBe(combined);
  });
});

describe("per-project cache", () => {
  const tmpDir = path.join(os.tmpdir(), `diagram-docs-test-${Date.now()}`);
  const projectDir = path.join(tmpDir, "my-service");

  beforeEach(() => {
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no cache exists", () => {
    expect(readProjectCache(projectDir)).toBeNull();
  });

  it("writes and reads both checksums", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:scan",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:scan", "sha256:model");

    const cache = readProjectCache(projectDir);
    expect(cache).not.toBeNull();
    expect(cache!.scanChecksum).toBe("sha256:scan");
    expect(cache!.modelChecksum).toBe("sha256:model");
    expect(cache!.scan).toEqual(scan);
    expect(cache!.model).toBeNull();
  });

  it("writes and reads model cache", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:scan",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:scan", "sha256:model");

    const model = {
      version: 1 as const,
      system: { name: "Test", description: "" },
      actors: [],
      externalSystems: [],
      containers: [],
      components: [],
      relationships: [],
    };
    writeProjectModel(projectDir, model);

    const cache = readProjectCache(projectDir);
    expect(cache!.model).toEqual(model);
  });

  it("detects scan-stale and model-stale independently", () => {
    writeProjectScan(
      projectDir,
      {
        version: 1 as const,
        scannedAt: "2026-01-01T00:00:00Z",
        checksum: "sha256:scan",
        applications: [],
      },
      "sha256:scan",
      "sha256:model",
    );

    expect(isScanStale(projectDir, "sha256:scan")).toBe(false);
    expect(isScanStale(projectDir, "sha256:other")).toBe(true);
    expect(isModelStale(projectDir, "sha256:model")).toBe(false);
    expect(isModelStale(projectDir, "sha256:other")).toBe(true);
  });

  it("reports stale when no cache exists", () => {
    expect(isScanStale(projectDir, "sha256:any")).toBe(true);
    expect(isModelStale(projectDir, "sha256:any")).toBe(true);
  });

  it("treats pre-migration caches (legacy single `checksum` file) as stale", () => {
    const cacheDir = path.join(projectDir, ".diagram-docs");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "checksum"), "sha256:legacy");
    fs.writeFileSync(
      path.join(cacheDir, "scan.json"),
      JSON.stringify({
        version: 1,
        scannedAt: "2026-01-01T00:00:00Z",
        checksum: "sha256:legacy",
        applications: [],
      }),
    );

    expect(readProjectCache(projectDir)).toBeNull();
    expect(isScanStale(projectDir, "sha256:legacy")).toBe(true);
    expect(isModelStale(projectDir, "sha256:legacy")).toBe(true);
  });
});

import { configSchema } from "../../src/config/schema.js";
import { runProjectScan, runScanAll } from "../../src/core/scan.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { discoverApplications } from "../../src/core/discovery.js";

describe("runProjectScan (two-fingerprint cache)", () => {
  const tmpRoot = path.join(os.tmpdir(), `dd-runscan-${Date.now()}`);
  const project = {
    path: "services/api-gateway",
    language: "java",
    type: "container" as const,
    analyzerId: "java",
    buildFile: "build.gradle",
  };

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("populates scanChecksum and modelChecksum on first run", async () => {
    const config = buildEffectiveConfig(configSchema.parse({}));
    const result = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config,
    });
    expect(result.fromCache).toBe(false);
    expect(result.modelStale).toBe(true);

    const cache = readProjectCache(path.join(tmpRoot, project.path));
    expect(cache).not.toBeNull();
    expect(cache!.scanChecksum).toMatch(/^sha256:/);
    expect(cache!.modelChecksum).toMatch(/^sha256:/);
    expect(cache!.scanChecksum).not.toBe(cache!.modelChecksum);
  });

  it("toggling levels.code re-scans but leaves modelStale = false", async () => {
    const off = buildEffectiveConfig(
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildEffectiveConfig(
      configSchema.parse({ levels: { code: true } }),
    );

    const first = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config: off,
    });
    expect(first.fromCache).toBe(false);

    const second = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config: on,
    });
    expect(second.fromCache).toBe(false);
    expect(second.modelStale).toBe(false);
  });

  it("changing abstraction.granularity marks the model stale", async () => {
    const balanced = buildEffectiveConfig(
      configSchema.parse({ abstraction: { granularity: "balanced" } }),
    );
    const detailed = buildEffectiveConfig(
      configSchema.parse({ abstraction: { granularity: "detailed" } }),
    );

    await runProjectScan({ rootDir: tmpRoot, project, config: balanced });
    const second = await runProjectScan({
      rootDir: tmpRoot,
      project,
      config: detailed,
    });
    expect(second.fromCache).toBe(false);
    expect(second.modelStale).toBe(true);
  });

  it("hits the cache when nothing changes", async () => {
    const config = buildEffectiveConfig(configSchema.parse({}));
    await runProjectScan({ rootDir: tmpRoot, project, config });
    const second = await runProjectScan({ rootDir: tmpRoot, project, config });
    expect(second.fromCache).toBe(true);
    expect(second.modelStale).toBe(false);
  });
});

describe("runScanAll (model-stale aggregation)", () => {
  const tmpRoot = path.join(os.tmpdir(), `dd-runscanall-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.cpSync(MONOREPO_ROOT, tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("flipping levels.code re-scans but modelStaleProjects stays empty", async () => {
    const off = buildEffectiveConfig(
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildEffectiveConfig(
      configSchema.parse({ levels: { code: true } }),
    );

    const projects = await discoverApplications(tmpRoot, off);

    const first = await runScanAll({
      rootDir: tmpRoot,
      config: off,
      projects,
    });
    expect(first.staleProjects.length).toBeGreaterThan(0);
    expect(first.modelStaleProjects.length).toBe(first.staleProjects.length);

    const second = await runScanAll({
      rootDir: tmpRoot,
      config: on,
      projects,
    });
    // Every project was re-scanned (L4 now extracted)...
    expect(second.staleProjects.length).toBe(projects.length);
    // ...but the L1–L3 model is still valid for every project.
    expect(second.modelStaleProjects).toEqual([]);
  });
});
