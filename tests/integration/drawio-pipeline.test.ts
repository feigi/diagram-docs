import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { configSchema } from "../../src/config/schema.js";
import { buildModel } from "../../src/core/model-builder.js";
import type {
  RawStructure,
  ScannedApplication,
} from "../../src/analyzers/types.js";
import { generateDrawioFile } from "../../src/generator/drawio/index.js";
import { buildContainerCells } from "../../src/generator/drawio/container.js";

const raw: RawStructure = {
  version: 1,
  scannedAt: "2026-04-20T00:00:00Z",
  checksum: "x",
  applications: [
    {
      id: "web",
      path: "web",
      name: "web",
      language: "typescript",
      buildFile: "package.json",
      modules: [],
      externalDependencies: [],
      internalImports: [],
    } satisfies ScannedApplication,
  ],
};

describe("drawio pipeline integration", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-pipeline-"));
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it("generates a drawio file end-to-end through buildModel", async () => {
    const config = configSchema.parse({
      output: { generators: ["drawio"] },
    });
    const model = buildModel({ config, rawStructure: raw });
    await generateDrawioFile({
      filePath: path.join(out, "c2-container.drawio"),
      diagramName: "L2",
      level: "container",
      cells: buildContainerCells(model),
    });
    const xml = fs.readFileSync(path.join(out, "c2-container.drawio"), "utf-8");
    expect(xml).toContain("mxfile");
    expect(xml).toContain("ddocs_managed=1");
  });
});
