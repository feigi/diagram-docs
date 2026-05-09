import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readManifest,
  readManifestV2,
  writeManifest,
  writeManifestV2,
  createDefaultManifest,
  createDefaultManifestV2,
} from "../../src/core/manifest.js";

const MANIFEST_DIR = ".diagram-docs";
const MANIFEST_FILE = "manifest.yaml";

describe("readManifest / readManifestV2 — error handling", () => {
  let tmpRoot: string;
  let manifestPath: string;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dd-manifest-"));
    fs.mkdirSync(path.join(tmpRoot, MANIFEST_DIR), { recursive: true });
    manifestPath = path.join(tmpRoot, MANIFEST_DIR, MANIFEST_FILE);
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderr.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("readManifest returns null on malformed YAML and logs a warning", () => {
    fs.writeFileSync(manifestPath, ":\n  : not: valid: yaml: ::\n", "utf-8");
    expect(readManifest(tmpRoot)).toBeNull();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringMatching(/failed to parse manifest/),
    );
  });

  it("readManifest returns null when version is missing or wrong", () => {
    fs.writeFileSync(manifestPath, "", "utf-8");
    expect(readManifest(tmpRoot)).toBeNull();

    fs.writeFileSync(manifestPath, "version: 2\nprojects: {}\n", "utf-8");
    expect(readManifest(tmpRoot)).toBeNull();
  });

  it("readManifest round-trips a valid V1 manifest", () => {
    const m = createDefaultManifest();
    m.lastModel = { timestamp: "2026-01-01T00:00:00Z", checksum: "abc" };
    writeManifest(tmpRoot, m);
    const read = readManifest(tmpRoot);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(1);
    expect(read!.lastModel?.checksum).toBe("abc");
  });

  it("readManifestV2 returns null on malformed YAML and logs a warning", () => {
    fs.writeFileSync(manifestPath, ":\n  : not: valid: yaml: ::\n", "utf-8");
    expect(readManifestV2(tmpRoot)).toBeNull();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringMatching(/failed to parse manifest/),
    );
  });

  it("readManifestV2 returns null for non-V2 content", () => {
    fs.writeFileSync(
      manifestPath,
      "version: 1\nrawStructure: x\nmodel: y\n",
      "utf-8",
    );
    expect(readManifestV2(tmpRoot)).toBeNull();
  });

  it("readManifestV2 round-trips a valid V2 manifest", () => {
    writeManifestV2(tmpRoot, createDefaultManifestV2());
    const read = readManifestV2(tmpRoot);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(2);
  });
});
