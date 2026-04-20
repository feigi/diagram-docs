import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../../../src/generator/drawio/container.js";
import { parseDrawioFile } from "../../../../src/generator/drawio/merge.js";
import type { ArchitectureModel } from "../../../../src/analyzers/types.js";

const MODEL: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "" },
  actors: [{ id: "customer", name: "Customer", description: "" }],
  externalSystems: [
    { id: "payments", name: "Payments", description: "", technology: "REST" },
  ],
  containers: [
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "",
      technology: "TS",
    },
    {
      id: "api",
      applicationId: "api",
      name: "API",
      description: "",
      technology: "Go",
    },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    { sourceId: "web", targetId: "api", label: "calls" },
    { sourceId: "api", targetId: "payments", label: "charges" },
  ],
};

describe("drawio end-to-end", () => {
  it("emits a parseable L2 diagram with all expected cell ids", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-e2e-"));
    const out = path.join(dir, "c2-container.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(MODEL),
    });
    const doc = parseDrawioFile(out);
    expect(doc.cells.has("customer")).toBe(true);
    expect(doc.cells.has("system")).toBe(true);
    expect(doc.cells.has("web")).toBe(true);
    expect(doc.cells.has("api")).toBe(true);
    expect(doc.cells.has("payments")).toBe(true);
    const edges = [...doc.cells.values()].filter((c) => c.edge);
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });
});
