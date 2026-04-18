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
  isProjectStale,
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
    const cache = readProjectCache(projectDir);
    expect(cache).toBeNull();
  });

  it("writes and reads scan cache", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:abc",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:abc");

    const cache = readProjectCache(projectDir);
    expect(cache).not.toBeNull();
    expect(cache!.checksum).toBe("sha256:abc");
    expect(cache!.scan).toEqual(scan);
    expect(cache!.model).toBeNull();
  });

  it("writes and reads model cache", () => {
    const scan = {
      version: 1 as const,
      scannedAt: "2026-01-01T00:00:00Z",
      checksum: "sha256:abc",
      applications: [],
    };
    writeProjectScan(projectDir, scan, "sha256:abc");

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

  it("detects stale project when checksum changes", () => {
    writeProjectScan(
      projectDir,
      {
        version: 1 as const,
        scannedAt: "2026-01-01T00:00:00Z",
        checksum: "sha256:old",
        applications: [],
      },
      "sha256:old",
    );

    expect(isProjectStale(projectDir, "sha256:old")).toBe(false);
    expect(isProjectStale(projectDir, "sha256:new")).toBe(true);
  });

  it("detects stale when no cache exists", () => {
    expect(isProjectStale(projectDir, "sha256:any")).toBe(true);
  });
});
