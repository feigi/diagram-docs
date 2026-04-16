import { describe, it, expect } from "vitest";
import type {
  CodeElementKind,
  CodeRelationship,
} from "../../src/analyzers/types.js";

/**
 * Light runtime checks on the closed string-literal unions. The types are
 * structural elsewhere; these tests exist to pin the *universe* of valid
 * values so a rogue analyzer emitting e.g. `kind: "method"` at the element
 * level fails compile-time on the `satisfies` below.
 */
describe("code-level type contracts", () => {
  it("CodeElementKind covers all analyzer-emitted values", () => {
    const all = [
      "class",
      "interface",
      "enum",
      "type",
      "function",
      "struct",
      "typedef",
    ] as const satisfies readonly CodeElementKind[];
    expect(new Set<CodeElementKind>(all).size).toBe(7);
  });

  it("CodeRelationship kind narrows to four semantic relations", () => {
    const all = [
      "inherits",
      "implements",
      "uses",
      "contains",
    ] as const satisfies readonly CodeRelationship["kind"][];
    expect(new Set<CodeRelationship["kind"]>(all).size).toBe(4);
  });
});
