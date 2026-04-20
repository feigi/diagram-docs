import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  parseDrawioFile,
  DrawioParseError,
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
