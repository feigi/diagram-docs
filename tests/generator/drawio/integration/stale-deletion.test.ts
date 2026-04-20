import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import { parseDrawioFile } from "../../../../src/generator/drawio/merge.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

describe("drawio stale-deletion", () => {
  it("drops removed containers and their edges, keeps freehand", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-stale-"));
    const out = path.join(dir, "c2-container.drawio");

    const full: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "a",
          applicationId: "a",
          name: "A",
          description: "",
          technology: "",
        },
        {
          id: "b",
          applicationId: "b",
          name: "B",
          description: "",
          technology: "",
        },
      ],
      components: [],
      relationships: [{ sourceId: "a", targetId: "b", label: "uses" }],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(full),
    });

    let xml = fs.readFileSync(out, "utf-8");
    xml = xml.replace(
      /(<\/root>)/,
      `<mxCell id="note" value="note" style="rounded=1;fillColor=#fff2cc" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>$1`,
    );
    fs.writeFileSync(out, xml);

    const shrunk: ArchitectureModel = {
      ...full,
      containers: [full.containers[0]],
      relationships: [],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(shrunk),
    });

    const doc = parseDrawioFile(out);
    expect(doc.cells.has("b")).toBe(false);
    expect(
      [...doc.cells.values()].some((c) => c.source === "a" && c.target === "b"),
    ).toBe(false);
    expect(doc.cells.has("note")).toBe(true);
  });
});
