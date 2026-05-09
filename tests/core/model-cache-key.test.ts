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

  it("never collides empty input with single-empty-string input or with non-empty keys", () => {
    expect(computeModelCacheKey([""])).not.toBe(computeModelCacheKey([]));
    expect(computeModelCacheKey([])).not.toBe(computeModelCacheKey(["aaa"]));
  });

  it("uses a length prefix so adding/removing entries cannot collide", () => {
    expect(computeModelCacheKey(["a", "b"])).not.toBe(
      computeModelCacheKey(["a,b"]),
    );
  });
});
