import { describe, it, expect } from "vitest";
import { computeProjectChecksum } from "../../src/core/checksum.js";
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
