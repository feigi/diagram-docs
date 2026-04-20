import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../src/generator/drawio/index.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-drawio-"));
}

describe("generateDrawioFile", () => {
  it("writes a .drawio file with the fresh cells", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells: {
        vertices: [{ id: "a", value: "A", style: STYLES.container }],
        edges: [],
      },
    });
    const xml = fs.readFileSync(out, "utf-8");
    expect(xml).toContain('id="a"');
    expect(xml).toContain("mxGraphModel");
  });

  it("is byte-identical across two runs with unchanged input", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    const cells = {
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
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells,
    });
    const first = fs.readFileSync(out, "utf-8");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells,
    });
    const second = fs.readFileSync(out, "utf-8");
    expect(second).toBe(first);
  });

  it("aborts and leaves the file intact on corrupt existing XML", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    const corrupt = "<not xml";
    fs.writeFileSync(out, corrupt, "utf-8");
    await expect(
      generateDrawioFile({
        filePath: out,
        diagramName: "L1",
        level: "context",
        cells: { vertices: [], edges: [] },
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(out, "utf-8")).toBe(corrupt);
  });
});
