import { describe, it, expect } from "vitest";
import { buildScanFingerprint } from "../../src/core/scan.js";
import { configSchema } from "../../src/config/schema.js";

describe("buildScanFingerprint", () => {
  const baseConfig = configSchema.parse({});
  const excludes = ["**/build/**"];

  it("is deterministic for the same inputs", () => {
    const a = buildScanFingerprint(excludes, baseConfig);
    const b = buildScanFingerprint(excludes, baseConfig);
    expect(a).toBe(b);
  });

  it("changes when excludes change", () => {
    const a = buildScanFingerprint(excludes, baseConfig);
    const b = buildScanFingerprint([...excludes, "**/tmp/**"], baseConfig);
    expect(a).not.toBe(b);
  });

  it("changes when abstraction granularity changes", () => {
    const a = buildScanFingerprint(
      excludes,
      configSchema.parse({ abstraction: { granularity: "balanced" } }),
    );
    const b = buildScanFingerprint(
      excludes,
      configSchema.parse({ abstraction: { granularity: "detailed" } }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when levels.code toggles (regression: cache bypass)", () => {
    const off = buildScanFingerprint(
      excludes,
      configSchema.parse({ levels: { code: false } }),
    );
    const on = buildScanFingerprint(
      excludes,
      configSchema.parse({ levels: { code: true } }),
    );
    expect(off).not.toBe(on);
  });

  it("changes when code.minElements changes", () => {
    const a = buildScanFingerprint(
      excludes,
      configSchema.parse({ code: { minElements: 2 } }),
    );
    const b = buildScanFingerprint(
      excludes,
      configSchema.parse({ code: { minElements: 5 } }),
    );
    expect(a).not.toBe(b);
  });

  it("includes scan.include only when requested", () => {
    const without = buildScanFingerprint(excludes, baseConfig);
    const withInclude = buildScanFingerprint(excludes, baseConfig, {
      includeScanInclude: true,
    });
    expect(without).not.toBe(withInclude);

    const sameConfigDifferentInclude = buildScanFingerprint(
      excludes,
      configSchema.parse({ scan: { include: ["src/**"] } }),
      { includeScanInclude: true },
    );
    expect(withInclude).not.toBe(sameConfigDifferentInclude);
  });
});
