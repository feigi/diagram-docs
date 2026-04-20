import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import { parseDrawioFile } from "../../../../src/generator/drawio/merge.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

const BASE: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "a",
      applicationId: "a",
      name: "A",
      description: "first",
      technology: "",
    },
    { id: "b", applicationId: "b", name: "B", description: "", technology: "" },
  ],
  components: [],
  relationships: [{ sourceId: "a", targetId: "b", label: "uses" }],
};

describe("user-edit preservation", () => {
  it("preserves hand-edited geometry and style across regeneration", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-pres-"));
    const out = path.join(dir, "c2-container.drawio");

    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(BASE),
    });

    let xml = fs.readFileSync(out, "utf-8");
    // Replace style for cell "a" - change the managed style to user-edited color
    xml = xml.replace(
      /(id="a"[^>]*style=")[^"]*(")/s,
      `$1rounded=1;fillColor=#ff0000;ddocs_managed=1$2`,
    );
    // Replace geometry for cell "a" - use precise attribute match
    xml = xml.replace(
      /x="24" y="24" width="160" height="60" as="geometry"/,
      `x="999" y="777" width="200" height="80" as="geometry"`,
    );
    // Add a freehand user note cell before closing root
    xml = xml.replace(
      /(<\/root>)/,
      `<mxCell id="user-note" value="my note" style="rounded=1;fillColor=#fff2cc" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="40" as="geometry"/></mxCell>$1`,
    );
    fs.writeFileSync(out, xml);

    const updated: ArchitectureModel = {
      ...BASE,
      containers: [
        { ...BASE.containers[0], description: "updated" },
        BASE.containers[1],
      ],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(updated),
    });

    const doc = parseDrawioFile(out);
    const a = doc.cells.get("a")!;
    expect(a.style).toBe("rounded=1;fillColor=#ff0000;ddocs_managed=1");
    expect(a.geometry).toEqual({ x: 999, y: 777, width: 200, height: 80 });
    expect(a.value).toContain("updated");
    const note = doc.cells.get("user-note")!;
    expect(note.managed).toBe(false);
    expect(note.geometry).toEqual({ x: 10, y: 10, width: 120, height: 40 });
  });
});
