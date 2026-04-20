import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeStaleDrawioFiles } from "../../../src/generator/drawio/cleanup.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const emptyModel: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [],
  components: [],
  relationships: [],
};

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-dw-clean-"));
}

describe("removeStaleDrawioFiles", () => {
  it("removes container .drawio files when the container is gone", () => {
    const dir = tmp();
    const stale = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(
      stale,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="gone" style="ddocs_managed=1" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
    );
    removeStaleDrawioFiles(dir, emptyModel);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("preserves file when it contains any unmanaged cell", () => {
    const dir = tmp();
    const preserved = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(preserved), { recursive: true });
    fs.writeFileSync(
      preserved,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="note" style="fillColor=#fff2cc" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
    );
    removeStaleDrawioFiles(dir, emptyModel);
    expect(fs.existsSync(preserved)).toBe(true);
  });
});
