import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../../src/core/model.js";
import { projectComponent } from "../../../src/generator/projection/component.js";

const MODEL_PATH = path.resolve(__dirname, "../../fixtures/model.yaml");

describe("projectComponent (L3)", () => {
  it("nests local components under the container via parentId", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectComponent(model, "user-api");
    const ctrl = spec.vertices.find((v) => v.id === "user-controller");
    expect(ctrl?.parentId).toBe("user-api");
    expect(ctrl?.kind).toBe("component");
  });

  it("includes ACTOR as cross-container reference (drift verdict)", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [{ id: "u", name: "User", description: "" }],
      externalSystems: [],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
      ],
      components: [
        {
          id: "c1",
          containerId: "api",
          name: "C1",
          description: "",
          technology: "X",
        },
      ],
      relationships: [{ sourceId: "u", targetId: "c1", label: "uses" }],
    } as unknown as Parameters<typeof projectComponent>[0];
    const spec = projectComponent(model, "api");
    const actor = spec.vertices.find((v) => v.id === "u");
    expect(actor).toBeDefined();
    expect(actor?.kind).toBe("actor");
  });

  it("does NOT decorate cross-container component refs with refId suffix", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
        { id: "svc", name: "SVC", description: "", technology: "Y" },
      ],
      components: [
        {
          id: "c1",
          containerId: "api",
          name: "C1",
          description: "",
          technology: "X",
        },
        {
          id: "c2",
          containerId: "svc",
          name: "C2",
          description: "",
          technology: "Y",
        },
      ],
      relationships: [{ sourceId: "c1", targetId: "c2", label: "calls" }],
    } as unknown as Parameters<typeof projectComponent>[0];
    const spec = projectComponent(model, "api");
    const ref = spec.vertices.find((v) => v.id === "c2");
    expect(ref?.name).toBe("C2");
    expect(ref?.name).not.toContain("|");
  });

  it("throws when container not found", async () => {
    const model = await loadModel(MODEL_PATH);
    expect(() => projectComponent(model, "missing")).toThrow(/not found/);
  });

  it("emits the local container as the boundary vertex", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectComponent(model, "user-api");
    const boundary = spec.vertices.find((v) => v.id === "user-api");
    expect(boundary?.kind).toBe("container");
    expect(boundary?.parentId).toBeUndefined();
  });

  it("drops dangling refIds and their edges, with a warning", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
      ],
      components: [
        {
          id: "c1",
          containerId: "api",
          name: "C1",
          description: "",
          technology: "X",
        },
      ],
      relationships: [{ sourceId: "ghost", targetId: "c1", label: "x" }],
    } as unknown as Parameters<typeof projectComponent>[0];
    const spec = projectComponent(model, "api");
    expect(spec.vertices.find((v) => v.id === "ghost")).toBeUndefined();
    expect(spec.edges.find((e) => e.sourceId === "ghost")).toBeUndefined();
    expect(spec.warnings.some((w) => w.includes("ghost"))).toBe(true);
  });
});
