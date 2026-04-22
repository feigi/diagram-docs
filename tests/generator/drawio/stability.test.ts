import { describe, it, expect } from "vitest";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
  wrapEdgeLabel,
  EDGE_LABEL_BR,
} from "../../../src/generator/drawio/stability.js";

describe("drawio stability", () => {
  it("toDrawioId slugifies and preserves hyphens", () => {
    expect(toDrawioId("User Service")).toBe("user-service");
  });

  it("edgeId combines source, target, and relationship slug", () => {
    expect(edgeId("auth", "user-db", "uses")).toBe("auth->user-db-uses");
  });

  it("sortById sorts by id ascending", () => {
    expect(sortById([{ id: "b" }, { id: "a" }])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("sortRelationships sorts by sourceId then targetId", () => {
    const rels = [
      { sourceId: "b", targetId: "x" },
      { sourceId: "a", targetId: "z" },
      { sourceId: "a", targetId: "y" },
    ];
    expect(sortRelationships(rels)).toEqual([
      { sourceId: "a", targetId: "y" },
      { sourceId: "a", targetId: "z" },
      { sourceId: "b", targetId: "x" },
    ]);
  });

  describe("wrapEdgeLabel", () => {
    it("returns the input unchanged for empty strings", () => {
      expect(wrapEdgeLabel("")).toBe("");
    });

    it("leaves a short single word intact", () => {
      expect(wrapEdgeLabel("uses")).toBe("uses");
    });

    it("keeps oversized single words on their own line without splitting them", () => {
      const long = "a".repeat(40);
      expect(wrapEdgeLabel(long, 22)).toBe(long);
    });

    it("keeps a multi-word label on one line when it fits within max", () => {
      expect(wrapEdgeLabel("sends events", 22)).toBe("sends events");
    });

    it("inserts <br> breaks when greedy-wrapping past max", () => {
      // 22-char cap: "publishes order events" is 22 chars — fits as one line.
      // Adding one more word forces a wrap.
      const out = wrapEdgeLabel("publishes order events to topic", 22);
      expect(out).toContain(EDGE_LABEL_BR);
      // Each line's length must not exceed max (except oversized single words).
      for (const line of out.split(EDGE_LABEL_BR)) {
        if (line.split(/\s+/).length > 1)
          expect(line.length).toBeLessThanOrEqual(22);
      }
    });

    it("uses <br> not \\n so drawio's html=1 edge style renders a break", () => {
      expect(EDGE_LABEL_BR).toBe("<br>");
    });
  });
});
