import { describe, it, expect } from "vitest";
import {
  layoutGraph,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "../../../src/generator/drawio/layout.js";

describe("layoutGraph", () => {
  it("returns geometry for every node", async () => {
    const result = await layoutGraph({
      level: "context",
      nodes: [
        { id: "a", width: NODE_WIDTH, height: NODE_HEIGHT },
        { id: "b", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [{ id: "a->b", source: "a", target: "b" }],
    });
    expect(result.get("a")).toBeDefined();
    expect(result.get("b")).toBeDefined();
    expect(result.get("a")!.width).toBe(NODE_WIDTH);
  });

  it("is deterministic across repeated runs", async () => {
    const input = {
      level: "container" as const,
      nodes: ["a", "b", "c", "d"].map((id) => ({
        id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: [
        { id: "a->b", source: "a", target: "b" },
        { id: "b->c", source: "b", target: "c" },
        { id: "c->d", source: "c", target: "d" },
      ],
    };
    const first = await layoutGraph(input);
    const second = await layoutGraph(input);
    for (const id of ["a", "b", "c", "d"]) {
      expect(first.get(id)).toEqual(second.get(id));
    }
  });

  it("nests children inside groups (component level)", async () => {
    const result = await layoutGraph({
      level: "component",
      nodes: [
        { id: "boundary", width: 400, height: 300, children: ["c1", "c2"] },
        { id: "c1", width: NODE_WIDTH, height: NODE_HEIGHT },
        { id: "c2", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [{ id: "c1->c2", source: "c1", target: "c2" }],
    });
    expect(result.get("boundary")).toBeDefined();
    expect(result.get("c1")).toBeDefined();
    expect(result.get("c1")!.x).toBeGreaterThanOrEqual(0);
  });

  it("applies mrtree for the code level", async () => {
    const result = await layoutGraph({
      level: "code",
      nodes: [
        { id: "parent", width: NODE_WIDTH, height: NODE_HEIGHT },
        { id: "leaf", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [{ id: "parent->leaf", source: "parent", target: "leaf" }],
    });
    expect(result.get("parent")).toBeDefined();
    expect(result.get("leaf")).toBeDefined();
  });
});
