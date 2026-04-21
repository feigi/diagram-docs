import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  parseDrawioFile,
  DrawioParseError,
  type ExistingDocument,
} from "../../../src/generator/drawio/merge.js";

const FIXTURES = path.resolve(__dirname, "../../fixtures/drawio");

describe("parseDrawioFile", () => {
  it("returns empty result when file does not exist", () => {
    const result = parseDrawioFile(
      path.join(FIXTURES, "does-not-exist.drawio"),
    );
    expect(result.cells.size).toBe(0);
  });

  it("extracts managed cells with geometry and style", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
    const auth = result.cells.get("auth");
    expect(auth).toBeDefined();
    expect(auth!.managed).toBe(true);
    expect(auth!.vertex).toBe(true);
    expect(auth!.geometry).toEqual({ x: 120, y: 80, width: 160, height: 60 });
    expect(auth!.style).toContain("ddocs_managed=1");
  });

  it("distinguishes user-freehand cells (no managed tag)", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
    const note = result.cells.get("my-note");
    expect(note?.managed).toBe(false);
  });

  it("extracts edge source/target", () => {
    const result = parseDrawioFile(path.join(FIXTURES, "populated.drawio"));
    const edge = result.cells.get("auth->db-uses");
    expect(edge?.edge).toBe(true);
    expect(edge?.source).toBe("auth");
    expect(edge?.target).toBe("db");
  });

  it("throws DrawioParseError on corrupt XML", () => {
    expect(() =>
      parseDrawioFile(path.join(FIXTURES, "corrupted.drawio")),
    ).toThrow(DrawioParseError);
  });
});

import { reconcile } from "../../../src/generator/drawio/merge.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

describe("reconcile", () => {
  const layoutGeom = (x: number, y: number) => ({
    x,
    y,
    width: 160,
    height: 60,
  });

  it("preserves saved geometry and style for matched managed cells", () => {
    const existing = {
      cells: new Map([
        [
          "auth",
          {
            id: "auth",
            value: "old label",
            style: "rounded=1;fillColor=#ff0000;ddocs_managed=1",
            vertex: true,
            edge: false,
            parent: "1",
            geometry: { x: 500, y: 500, width: 200, height: 80 },
            managed: true,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = {
      vertices: [{ id: "auth", value: "new label", style: STYLES.container }],
      edges: [],
    };
    const layout = new Map([["auth", layoutGeom(0, 0)]]);
    const result = reconcile({ existing, fresh, layout });
    const auth = result.vertices.find((v) => v.id === "auth")!;
    expect(auth.style).toBe("rounded=1;fillColor=#ff0000;ddocs_managed=1");
    expect(auth.geometry).toEqual({ x: 500, y: 500, width: 200, height: 80 });
    expect(auth.value).toBe("new label");
  });

  it("places new cells using layout coords", () => {
    const existing = { cells: new Map() } as ExistingDocument;
    const fresh = {
      vertices: [{ id: "a", value: "A", style: STYLES.container }],
      edges: [],
    };
    const layout = new Map([["a", layoutGeom(42, 99)]]);
    const result = reconcile({ existing, fresh, layout });
    expect(result.vertices[0].geometry).toEqual({
      x: 42,
      y: 99,
      width: 160,
      height: 60,
    });
  });

  it("drops stale managed cells and orphan edges", () => {
    const existing = {
      cells: new Map([
        [
          "gone",
          {
            id: "gone",
            style: STYLES.container,
            vertex: true,
            edge: false,
            geometry: { x: 0, y: 0, width: 10, height: 10 },
            managed: true,
          },
        ],
        [
          "a->gone-uses",
          {
            id: "a->gone-uses",
            style: STYLES.relationship,
            vertex: false,
            edge: true,
            source: "a",
            target: "gone",
            managed: true,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = { vertices: [], edges: [] };
    const layout = new Map();
    const result = reconcile({ existing, fresh, layout });
    expect(result.vertices.find((v) => v.id === "gone")).toBeUndefined();
    expect(result.edges.find((e) => e.id === "a->gone-uses")).toBeUndefined();
  });

  it("preserves user freehand (unmanaged) cells verbatim", () => {
    const existing = {
      cells: new Map([
        [
          "my-note",
          {
            id: "my-note",
            value: "note",
            style: "rounded=1;fillColor=#fff2cc",
            vertex: true,
            edge: false,
            geometry: { x: 300, y: 300, width: 120, height: 40 },
            managed: false,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = { vertices: [], edges: [] };
    const layout = new Map();
    const result = reconcile({ existing, fresh, layout });
    const note = result.vertices.find((v) => v.id === "my-note");
    expect(note).toBeDefined();
    expect(note!.style).toBe("rounded=1;fillColor=#fff2cc");
    expect(note!.geometry).toEqual({ x: 300, y: 300, width: 120, height: 40 });
  });

  it("reparents to layer 1 when saved parent is now stale", () => {
    const existing = {
      cells: new Map([
        [
          "kept",
          {
            id: "kept",
            style: STYLES.component,
            vertex: true,
            edge: false,
            parent: "gone",
            geometry: { x: 50, y: 50, width: 160, height: 60 },
            managed: true,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = {
      vertices: [{ id: "kept", value: "Kept", style: STYLES.component }],
      edges: [],
    };
    const layout = new Map([["kept", layoutGeom(0, 0)]]);
    const result = reconcile({ existing, fresh, layout });
    const kept = result.vertices.find((v) => v.id === "kept")!;
    expect(kept.parent).toBe("1");
    expect(result.warnings.some((w) => w.includes("kept"))).toBe(true);
  });

  it("drops edge waypoints when either endpoint is new", () => {
    const existing = {
      cells: new Map([
        [
          "a->b-uses",
          {
            id: "a->b-uses",
            style: STYLES.relationship,
            vertex: false,
            edge: true,
            source: "a",
            target: "b",
            waypoints: [{ x: 100, y: 100 }],
            managed: true,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = {
      vertices: [
        { id: "a", value: "A", style: STYLES.container },
        { id: "b", value: "B", style: STYLES.container },
      ],
      edges: [
        {
          id: "a->b-uses",
          source: "a",
          target: "b",
          value: "uses",
          style: STYLES.relationship,
        },
      ],
    };
    const layout = new Map([
      ["a", layoutGeom(0, 0)],
      ["b", layoutGeom(200, 0)],
    ]);
    const result = reconcile({ existing, fresh, layout });
    const edge = result.edges.find((e) => e.id === "a->b-uses")!;
    expect(edge.waypoints).toBeUndefined();
  });

  it("drops and warns about unmanaged edges whose endpoint no longer exists", () => {
    const existing = {
      cells: new Map([
        [
          "a",
          {
            id: "a",
            style: STYLES.container,
            vertex: true,
            edge: false,
            parent: "1",
            geometry: { x: 0, y: 0, width: 160, height: 60 },
            managed: true,
          },
        ],
        [
          "b",
          {
            id: "b",
            style: STYLES.container,
            vertex: true,
            edge: false,
            parent: "1",
            geometry: { x: 200, y: 0, width: 160, height: 60 },
            managed: true,
          },
        ],
        [
          "freehand-a-to-b",
          {
            id: "freehand-a-to-b",
            style: "endArrow=classic",
            vertex: false,
            edge: true,
            source: "a",
            target: "b",
            managed: false,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = {
      vertices: [{ id: "a", value: "A", style: STYLES.container }],
      edges: [],
    };
    const layout = new Map([["a", layoutGeom(0, 0)]]);
    const result = reconcile({ existing, fresh, layout });
    expect(
      result.edges.find((e) => e.id === "freehand-a-to-b"),
    ).toBeUndefined();
    expect(result.warnings).toContain(
      "Dropped unmanaged edge freehand-a-to-b: endpoint b no longer exists",
    );
  });

  it("preserves waypoints when both endpoints are kept unchanged", () => {
    const existing = {
      cells: new Map([
        [
          "a",
          {
            id: "a",
            style: STYLES.container,
            vertex: true,
            edge: false,
            parent: "1",
            geometry: { x: 10, y: 10, width: 160, height: 60 },
            managed: true,
          },
        ],
        [
          "b",
          {
            id: "b",
            style: STYLES.container,
            vertex: true,
            edge: false,
            parent: "1",
            geometry: { x: 400, y: 10, width: 160, height: 60 },
            managed: true,
          },
        ],
        [
          "a->b-uses",
          {
            id: "a->b-uses",
            style: STYLES.relationship,
            vertex: false,
            edge: true,
            source: "a",
            target: "b",
            waypoints: [
              { x: 200, y: 40 },
              { x: 300, y: 40 },
            ],
            managed: true,
          },
        ],
      ]),
    } as ExistingDocument;
    const fresh = {
      vertices: [
        { id: "a", value: "A", style: STYLES.container },
        { id: "b", value: "B", style: STYLES.container },
      ],
      edges: [
        {
          id: "a->b-uses",
          source: "a",
          target: "b",
          value: "uses",
          style: STYLES.relationship,
        },
      ],
    };
    const layout = new Map([
      ["a", layoutGeom(0, 0)],
      ["b", layoutGeom(500, 0)],
    ]);
    const result = reconcile({ existing, fresh, layout });
    const edge = result.edges.find((e) => e.id === "a->b-uses")!;
    expect(edge.waypoints).toEqual([
      { x: 200, y: 40 },
      { x: 300, y: 40 },
    ]);
  });
});
