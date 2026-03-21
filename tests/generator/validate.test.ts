import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateD2Files } from "../../src/generator/d2/validate.js";

describe("validateD2Files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "d2-validate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when d2 CLI is not available", () => {
    // Temporarily override PATH so d2 can't be found
    const origPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = validateD2Files(["nonexistent.d2"]);
      expect(result).toBeNull();
    } finally {
      process.env.PATH = origPath;
    }
  });

  it("returns valid count for valid D2 files", () => {
    const validFile = path.join(tmpDir, "valid.d2");
    fs.writeFileSync(validFile, "a -> b: calls\n");

    const result = validateD2Files([validFile]);
    // If d2 is not installed in CI, skip
    if (result === null) return;

    expect(result.valid).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for invalid D2 files", () => {
    const invalidFile = path.join(tmpDir, "invalid.d2");
    fs.writeFileSync(invalidFile, "a -> -> -> b\n");

    const result = validateD2Files([invalidFile]);
    if (result === null) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBeTruthy();
  });

  it("handles a mix of valid and invalid files", () => {
    const validFile = path.join(tmpDir, "valid.d2");
    fs.writeFileSync(validFile, "x -> y\n");

    const invalidFile = path.join(tmpDir, "invalid.d2");
    fs.writeFileSync(invalidFile, "a -> -> -> b\n");

    const result = validateD2Files([validFile, invalidFile]);
    if (result === null) return;

    expect(result.valid).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it("skips nonexistent files", () => {
    const validFile = path.join(tmpDir, "valid.d2");
    fs.writeFileSync(validFile, "a -> b\n");

    const result = validateD2Files([
      validFile,
      path.join(tmpDir, "does-not-exist.d2"),
    ]);
    if (result === null) return;

    expect(result.valid).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("returns empty result for empty file list", () => {
    const result = validateD2Files([]);
    expect(result).toEqual({ valid: 0, errors: [] });
  });
});
