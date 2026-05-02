import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../../src/core/model.js";
import { projectContext } from "../../../src/generator/projection/context.js";

const MODEL_PATH = path.resolve(__dirname, "../../fixtures/model.yaml");

describe("projectContext (L1)", () => {
  it("emits actors, system, and non-library externals as vertices", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const ids = spec.vertices.map((v) => v.id).sort();
    expect(ids).toContain("user");
    expect(ids).toContain("system");
    expect(ids).toContain("email-provider");
  });

  it("collapses internal (container/component) endpoints into 'system'", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const userToSystem = spec.edges.find(
      (e) => e.sourceId === "user" && e.targetId === "system",
    );
    expect(userToSystem).toBeDefined();
  });

  it("dedupes edges that collapse to the same source→target pair", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const seen = new Set<string>();
    for (const e of spec.edges) {
      const key = `${e.sourceId}->${e.targetId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("drops external↔external relationships at L1 (drift verdict)", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [
        { id: "ext-a", name: "A", description: "" },
        { id: "ext-b", name: "B", description: "" },
      ],
      containers: [],
      components: [],
      relationships: [{ sourceId: "ext-a", targetId: "ext-b", label: "calls" }],
    } as unknown as Parameters<typeof projectContext>[0];
    const spec = projectContext(model);
    expect(spec.edges).toHaveLength(0);
  });

  it("excludes external systems tagged 'library' from vertices", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [
        { id: "lib-a", name: "Lib", description: "", tags: ["library"] },
        { id: "ext-a", name: "Ext", description: "" },
      ],
      containers: [],
      components: [],
      relationships: [],
    } as unknown as Parameters<typeof projectContext>[0];
    const spec = projectContext(model);
    const ids = spec.vertices.map((v) => v.id);
    expect(ids).not.toContain("lib-a");
    expect(ids).toContain("ext-a");
  });

  it("orders vertices: actors → system → externals (deterministic)", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContext(model);
    const systemIdx = spec.vertices.findIndex((v) => v.id === "system");
    const userIdx = spec.vertices.findIndex((v) => v.id === "user");
    const extIdx = spec.vertices.findIndex((v) => v.id === "email-provider");
    expect(userIdx).toBeLessThan(systemIdx);
    expect(systemIdx).toBeLessThan(extIdx);
  });
});
