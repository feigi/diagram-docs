import { describe, it, expect } from "vitest";
import { z } from "zod";
import { configSchema } from "../../src/config/schema.js";
import {
  SCAN_FINGERPRINT_KEYS,
  MODEL_FINGERPRINT_KEYS,
  IGNORED_FINGERPRINT_KEYS,
} from "../../src/core/scan.js";

function topLevelConfigKeys(): string[] {
  if (!(configSchema instanceof z.ZodObject)) {
    throw new Error(
      "configSchema is no longer a bare ZodObject — update this helper to unwrap the current type.",
    );
  }
  return Object.keys(configSchema.shape);
}

describe("fingerprint coverage tripwire", () => {
  it("every top-level config key is classified", () => {
    const allKeys = topLevelConfigKeys();
    const classified = new Set<string>([
      ...SCAN_FINGERPRINT_KEYS,
      ...IGNORED_FINGERPRINT_KEYS,
    ]);
    const unclassified = allKeys.filter((k) => !classified.has(k));

    if (unclassified.length > 0) {
      throw new Error(
        `Unclassified config key(s): ${unclassified.join(", ")}. ` +
          "Add each to SCAN_FINGERPRINT_KEYS, MODEL_FINGERPRINT_KEYS, or " +
          "IGNORED_FINGERPRINT_KEYS in src/core/scan.ts. Picking the " +
          "wrong bucket causes silent cache-bypass bugs.",
      );
    }
  });

  it("MODEL_FINGERPRINT_KEYS is a subset of SCAN_FINGERPRINT_KEYS", () => {
    const scanSet = new Set<string>(SCAN_FINGERPRINT_KEYS);
    for (const k of MODEL_FINGERPRINT_KEYS) {
      expect(scanSet.has(k)).toBe(true);
    }
  });

  it("SCAN_FINGERPRINT_KEYS and IGNORED_FINGERPRINT_KEYS are disjoint", () => {
    const ignored = new Set<string>(IGNORED_FINGERPRINT_KEYS);
    for (const k of SCAN_FINGERPRINT_KEYS) {
      expect(ignored.has(k)).toBe(false);
    }
  });
});
