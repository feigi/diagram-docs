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
});
