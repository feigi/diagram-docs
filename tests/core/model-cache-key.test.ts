import { describe, it, expect } from "vitest";
import { computeModelCacheKey } from "../../src/core/scan.js";

describe("computeModelCacheKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(computeModelCacheKey(["aaa", "bbb"])).toBe(
      computeModelCacheKey(["aaa", "bbb"]),
    );
  });

  it("is order-independent", () => {
    expect(computeModelCacheKey(["aaa", "bbb"])).toBe(
      computeModelCacheKey(["bbb", "aaa"]),
    );
  });

  it("changes when a checksum changes", () => {
    expect(computeModelCacheKey(["aaa", "bbb"])).not.toBe(
      computeModelCacheKey(["aaa", "ccc"]),
    );
  });

  it("changes when a checksum is added", () => {
    expect(computeModelCacheKey(["aaa"])).not.toBe(
      computeModelCacheKey(["aaa", "bbb"]),
    );
  });

  it("returns empty string for no checksums", () => {
    expect(computeModelCacheKey([])).toBe("");
  });
});
