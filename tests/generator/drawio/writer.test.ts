import { describe, it, expect } from "vitest";
import { DrawioWriter } from "../../../src/generator/drawio/writer.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

describe("DrawioWriter", () => {
  it("emits mxfile > diagram > mxGraphModel > root with default 0/1 cells", () => {
    const w = new DrawioWriter({ diagramName: "L1 - context" });
    const xml = w.serialise();
    expect(xml).toContain("<mxfile");
    expect(xml).toContain('<diagram name="L1 - context"');
    expect(xml).toContain('<mxCell id="0"');
    expect(xml).toContain('<mxCell id="1" parent="0"');
  });

  it("addVertex produces mxCell with geometry and style", () => {
    const w = new DrawioWriter({ diagramName: "L1" });
    w.addVertex({
      id: "auth-service",
      value: "Auth Service",
      style: STYLES.container,
      geometry: { x: 100, y: 80, width: 160, height: 60 },
    });
    const xml = w.serialise();
    expect(xml).toContain('id="auth-service"');
    expect(xml).toContain('value="Auth Service"');
    expect(xml).toContain('vertex="1"');
    expect(xml).toContain("ddocs_managed=1");
    expect(xml).toMatch(/x="100"[^>]*y="80"[^>]*width="160"[^>]*height="60"/);
  });

  it("addEdge produces mxCell with edge=1 and source/target attrs", () => {
    const w = new DrawioWriter({ diagramName: "L1" });
    w.addVertex({
      id: "a",
      value: "A",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 100, height: 60 },
    });
    w.addVertex({
      id: "b",
      value: "B",
      style: STYLES.container,
      geometry: { x: 200, y: 0, width: 100, height: 60 },
    });
    w.addEdge({
      id: "a->b-uses",
      source: "a",
      target: "b",
      value: "uses",
      style: STYLES.relationship,
    });
    const xml = w.serialise();
    expect(xml).toContain('id="a-&gt;b-uses"');
    expect(xml).toContain('edge="1"');
    expect(xml).toContain('source="a"');
    expect(xml).toContain('target="b"');
    expect(xml).toContain('value="uses"');
  });

  it("addVertex supports nested parent", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "system",
      value: "System",
      style: STYLES["system-boundary"],
      geometry: { x: 0, y: 0, width: 500, height: 300 },
    });
    w.addVertex({
      id: "auth",
      value: "Auth",
      style: STYLES.container,
      geometry: { x: 20, y: 40, width: 160, height: 60 },
      parent: "system",
    });
    const xml = w.serialise();
    expect(xml).toMatch(/id="auth"[^>]*parent="system"/);
  });

  it("wraps vertex in UserObject when tooltip is set", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "auth",
      value: "Auth",
      tooltip: "JWT-based auth service",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    const xml = w.serialise();
    expect(xml).toContain("<UserObject");
    expect(xml).toContain('id="auth"');
    expect(xml).toContain('label="Auth"');
    expect(xml).toContain('tooltip="JWT-based auth service"');
    expect(xml).toContain('ddocs_managed="1"');
    expect(xml).toMatch(/<UserObject[^>]*>\s*<mxCell[^>]*vertex="1"/);
    expect(xml).not.toMatch(/<mxCell[^>]*value="Auth"/);
  });

  it("emits plain mxCell when no tooltip is set", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "auth",
      value: "Auth",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    const xml = w.serialise();
    expect(xml).not.toContain("<UserObject");
    expect(xml).toMatch(/<mxCell[^>]*id="auth"[^>]*value="Auth"/);
  });

  it("wraps edge in UserObject when tooltip is set", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "a",
      value: "A",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    w.addVertex({
      id: "b",
      value: "B",
      style: STYLES.container,
      geometry: { x: 300, y: 0, width: 180, height: 70 },
    });
    w.addEdge({
      id: "a->b-uses",
      source: "a",
      target: "b",
      value: "uses",
      tooltip: "[HTTPS/REST]",
      style: STYLES.relationship,
    });
    const xml = w.serialise();
    expect(xml).toMatch(/<UserObject[^>]*id="a-&gt;b-uses"/);
    expect(xml).toContain('label="uses"');
    expect(xml).toContain('tooltip="[HTTPS/REST]"');
    expect(xml).toMatch(/<UserObject[^>]*>\s*<mxCell[^>]*edge="1"/);
  });

  it("strips ddocs_managed=1 from inner mxCell style on UserObject wrap", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "auth",
      value: "Auth",
      tooltip: "desc",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    const xml = w.serialise();
    // ddocs_managed is asserted via the UserObject attribute, not the style.
    expect(xml).toMatch(
      /<UserObject[^>]*id="auth"[^>]*ddocs_managed="1"[^>]*>\s*<mxCell[^>]*style="(?!.*ddocs_managed=1)/,
    );
  });

  it("preserves ddocs_managed=1 in style on plain mxCell (no tooltip)", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "auth",
      value: "Auth",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    const xml = w.serialise();
    expect(xml).toMatch(
      /<mxCell[^>]*id="auth"[^>]*style="[^"]*ddocs_managed=1/,
    );
  });

  it("escapes XML-unsafe chars in tooltip (quotes, angle brackets, ampersand)", async () => {
    const { parseDrawioFile } =
      await import("../../../src/generator/drawio/merge.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const w = new DrawioWriter({ diagramName: "L2" });
    const tricky = 'has "quotes" & <angles>';
    w.addVertex({
      id: "auth",
      value: "Auth",
      tooltip: tricky,
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-esc-"));
    const out = path.join(dir, "t.drawio");
    fs.writeFileSync(out, w.serialise(), "utf-8");
    const doc = parseDrawioFile(out);
    expect(doc.cells.get("auth")?.tooltip).toBe(tricky);
  });

  it("omits label when edge has tooltip but no value", () => {
    const w = new DrawioWriter({ diagramName: "L2" });
    w.addVertex({
      id: "a",
      value: "A",
      style: STYLES.container,
      geometry: { x: 0, y: 0, width: 180, height: 70 },
    });
    w.addVertex({
      id: "b",
      value: "B",
      style: STYLES.container,
      geometry: { x: 300, y: 0, width: 180, height: 70 },
    });
    w.addEdge({
      id: "a->b",
      source: "a",
      target: "b",
      tooltip: "[HTTPS]",
      style: STYLES.relationship,
    });
    const xml = w.serialise();
    expect(xml).toMatch(/<UserObject[^>]*id="a-&gt;b"/);
    expect(xml).toContain('tooltip="[HTTPS]"');
    expect(xml).not.toMatch(/<UserObject[^>]*label=/);
  });
});
