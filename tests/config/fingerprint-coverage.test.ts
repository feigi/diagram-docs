import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import {
  SCAN_FINGERPRINT_KEYS,
  MODEL_FINGERPRINT_KEYS,
  IGNORED_FINGERPRINT_KEYS,
} from "../../src/core/scan.js";

function topLevelConfigKeys(): string[] {
  // zod's ZodObject exposes `.shape` in v3+. For ZodDefault/ZodEffects
  // wrappers, unwrap first.
  // configSchema is `z.object({...}).strict()` in our schema; `.shape`
  // is the keyof object type.
  const schema: unknown = configSchema;
  // @ts-expect-error - reach into zod internals for the test
  const shape = schema.shape ?? schema._def?.schema?.shape;
  if (!shape || typeof shape !== "object") {
    throw new Error(
      "Could not extract top-level keys from configSchema. " +
        "If zod's internal shape has moved, update this helper.",
    );
  }
  return Object.keys(shape);
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
