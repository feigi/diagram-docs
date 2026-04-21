import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkDrawioDrift } from "../../../src/generator/drawio/drift.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "api",
      applicationId: "api",
      name: "API",
      description: "",
      technology: "",
    },
  ],
  components: [],
  relationships: [],
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-drift-"));
}

describe("checkDrawioDrift", () => {
  it("reports user-drawn edges that reference stale ids", () => {
    const dir = tmpDir();
    const file = path.join(dir, "c2-container.drawio");
    fs.writeFileSync(
      file,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="my-edge" style="endArrow=classic" edge="1" parent="1" source="api" target="removed-svc"/>
</root></mxGraphModel></diagram></mxfile>`,
      "utf-8",
    );
    const warns = checkDrawioDrift(dir, model);
    expect(warns.some((w) => w.id === "removed-svc")).toBe(true);
  });

  it("ignores freehand vertices not referenced by any edge", () => {
    const dir = tmpDir();
    const file = path.join(dir, "c2-container.drawio");
    fs.writeFileSync(
      file,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="my-note" value="note" style="rounded=1" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="100" height="40" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
      "utf-8",
    );
    const warns = checkDrawioDrift(dir, model);
    expect(warns).toEqual([]);
  });

  it("reports a severity=error warning for corrupt drawio files", () => {
    const dir = tmpDir();
    const file = path.join(dir, "c2-container.drawio");
    const fixture = path.resolve(
      __dirname,
      "../../fixtures/drawio/corrupted.drawio",
    );
    fs.copyFileSync(fixture, file);
    const warns = checkDrawioDrift(dir, model);
    const errors = warns.filter((w) => w.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.file).toBe(file);
    expect(errors[0]!.message.length).toBeGreaterThan(0);
  });

  it("emits an error-severity warning when a UserObject has no child mxCell", () => {
    const fixtureDir = path.resolve(
      __dirname,
      "../../fixtures/drawio/drift-invalid",
    );
    const warnings = checkDrawioDrift(fixtureDir, {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [],
      components: [],
      relationships: [],
    });
    const bad = warnings.find((w) =>
      w.file.endsWith("userobject-missing-mxcell.drawio"),
    );
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("error");
    expect(bad!.message).toContain("missing child mxCell");
  });
});
