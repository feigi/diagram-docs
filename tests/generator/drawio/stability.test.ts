import { describe, it, expect } from "vitest";
import {
  toDrawioId,
  edgeId,
  sortById,
  sortRelationships,
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
});
