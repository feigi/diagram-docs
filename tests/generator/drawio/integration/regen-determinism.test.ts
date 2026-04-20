import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

const MODEL: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    { id: "a", applicationId: "a", name: "A", description: "", technology: "" },
    { id: "b", applicationId: "b", name: "B", description: "", technology: "" },
  ],
  components: [],
  relationships: [{ sourceId: "a", targetId: "b", label: "uses" }],
};

describe("drawio regen determinism", () => {
  it("produces byte-identical output across two runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-regen-"));
    const out = path.join(dir, "c2-container.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(MODEL),
    });
    const first = fs.readFileSync(out, "utf-8");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(MODEL),
    });
    const second = fs.readFileSync(out, "utf-8");
    expect(second).toBe(first);
  });
});
