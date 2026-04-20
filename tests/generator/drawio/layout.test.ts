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

  it("emits child geometry relative to the immediate parent, not absolute", async () => {
    // drawio/mxGraph interprets mxGeometry x/y relative to the mxCell parent's
    // origin whenever the parent is not the background layer ("1"). So the
    // geometry returned for a nested child must be parent-relative.
    const result = await layoutGraph({
      level: "component",
      nodes: [
        { id: "boundary", width: 600, height: 400, children: ["c1", "c2"] },
        { id: "c1", width: NODE_WIDTH, height: NODE_HEIGHT },
        { id: "c2", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [{ id: "c1->c2", source: "c1", target: "c2" }],
    });
    const boundary = result.get("boundary")!;
    const c1 = result.get("c1")!;
    const c2 = result.get("c2")!;
    expect(boundary).toBeDefined();
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    // Children must fit inside the parent when interpreted as relative
    // coordinates (0 <= child.x < parent.width, same for y/height). If the
    // collect() walker were accumulating parentX+node.x again, c1/c2 would
    // easily exceed boundary.width/height here.
    expect(c1.x).toBeGreaterThanOrEqual(0);
    expect(c1.y).toBeGreaterThanOrEqual(0);
    expect(c1.x + c1.width).toBeLessThanOrEqual(boundary.width);
    expect(c1.y + c1.height).toBeLessThanOrEqual(boundary.height);
    expect(c2.x).toBeGreaterThanOrEqual(0);
    expect(c2.y).toBeGreaterThanOrEqual(0);
    expect(c2.x + c2.width).toBeLessThanOrEqual(boundary.width);
    expect(c2.y + c2.height).toBeLessThanOrEqual(boundary.height);
  });

  it("returns child geometry as parent-relative across three nesting levels", async () => {
    // Synthesise a three-deep hierarchy similar to L4: system -> container ->
    // component -> code element. If collect() were still accumulating parent
    // offsets, the innermost leaf would have x,y equal to the sum of all
    // ancestor origins; with the fix, leaf.x/leaf.y stay bounded by its
    // immediate parent component.
    const result = await layoutGraph({
      level: "component",
      nodes: [
        { id: "sys", width: 800, height: 600, children: ["cont"] },
        { id: "cont", width: 600, height: 400, children: ["comp"] },
        { id: "comp", width: 400, height: 250, children: ["leaf"] },
        { id: "leaf", width: NODE_WIDTH, height: NODE_HEIGHT },
      ],
      edges: [],
    });
    const comp = result.get("comp")!;
    const leaf = result.get("leaf")!;
    expect(comp).toBeDefined();
    expect(leaf).toBeDefined();
    // leaf is drawn inside comp; its relative coords must fit inside comp's
    // own box (which itself is relative to cont, and so on).
    expect(leaf.x).toBeGreaterThanOrEqual(0);
    expect(leaf.y).toBeGreaterThanOrEqual(0);
    expect(leaf.x + leaf.width).toBeLessThanOrEqual(comp.width);
    expect(leaf.y + leaf.height).toBeLessThanOrEqual(comp.height);
  });
});
