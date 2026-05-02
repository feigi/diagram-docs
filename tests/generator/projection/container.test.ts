import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../../src/core/model.js";
import { projectContainer } from "../../../src/generator/projection/container.js";

const MODEL_PATH = path.resolve(__dirname, "../../fixtures/model.yaml");

describe("projectContainer (L2)", () => {
  it("nests connected containers under 'system' via parentId", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContainer(model);
    const userApi = spec.vertices.find((v) => v.id === "user-api");
    expect(userApi?.parentId).toBe("system");
    expect(userApi?.kind).toBe("container");
  });

  it("emits actors and external systems at the top level (no parentId)", async () => {
    const model = await loadModel(MODEL_PATH);
    const spec = projectContainer(model);
    const user = spec.vertices.find((v) => v.id === "user");
    expect(user?.parentId).toBeUndefined();
    const ext = spec.vertices.find((v) => v.id === "email-provider");
    expect(ext?.parentId).toBeUndefined();
  });

  it("drops dangling containers (no relationships at L2)", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        { id: "used", name: "Used", description: "", technology: "X" },
        { id: "lonely", name: "Lonely", description: "", technology: "X" },
      ],
      components: [],
      relationships: [
        { sourceId: "used", targetId: "used", label: "self" }, // self drops too
      ],
    } as unknown as Parameters<typeof projectContainer>[0];
    const spec = projectContainer(model);
    const ids = spec.vertices.map((v) => v.id);
    expect(ids).not.toContain("used");
    expect(ids).not.toContain("lonely");
  });

  it("collapses component endpoints to their parent container", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [{ id: "ext", name: "E", description: "" }],
      containers: [
        { id: "api", name: "API", description: "", technology: "X" },
      ],
      components: [
        {
          id: "ctrl",
          containerId: "api",
          name: "C",
          description: "",
          technology: "X",
        },
      ],
      relationships: [{ sourceId: "ctrl", targetId: "ext", label: "calls" }],
    } as unknown as Parameters<typeof projectContainer>[0];
    const spec = projectContainer(model);
    const e = spec.edges.find(
      (e) => e.sourceId === "api" && e.targetId === "ext",
    );
    expect(e).toBeDefined();
  });

  it("dedupes edges that collapse to the same container→target pair", () => {
    const model = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [{ id: "ext", name: "E", description: "" }],
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
        {
          id: "c2",
          containerId: "api",
          name: "C2",
          description: "",
          technology: "X",
        },
      ],
      relationships: [
        { sourceId: "c1", targetId: "ext", label: "calls" },
        { sourceId: "c2", targetId: "ext", label: "calls" },
      ],
    } as unknown as Parameters<typeof projectContainer>[0];
    const spec = projectContainer(model);
    const apiToExt = spec.edges.filter(
      (e) => e.sourceId === "api" && e.targetId === "ext",
    );
    expect(apiToExt).toHaveLength(1);
  });
});
