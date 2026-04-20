import { describe, it, expect } from "vitest";
import { buildCodeCells } from "../../../src/generator/drawio/code.js";
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
      technology: "Go",
    },
  ],
  components: [
    {
      id: "auth",
      containerId: "api",
      name: "Auth",
      description: "",
      technology: "Go",
      moduleIds: [],
    },
  ],
  relationships: [],
  codeElements: [
    {
      id: "User",
      componentId: "auth",
      containerId: "api",
      name: "User",
      kind: "class",
    },
    {
      id: "hashPassword",
      componentId: "auth",
      containerId: "api",
      name: "hashPassword",
      kind: "function",
    },
  ],
  codeRelationships: [
    { sourceId: "User", targetId: "hashPassword", kind: "uses" },
  ],
};

describe("buildCodeCells", () => {
  it("emits the component boundary and each code element", () => {
    const { vertices } = buildCodeCells(model, model.components[0]);
    expect(vertices.find((v) => v.id === "auth")).toBeDefined();
    expect(vertices.find((v) => v.id === "user")).toBeDefined();
    expect(vertices.find((v) => v.id === "hashpassword")).toBeDefined();
  });

  it("styles class kinds as code-class and function kinds as code-fn", () => {
    const { vertices } = buildCodeCells(model, model.components[0]);
    const user = vertices.find((v) => v.id === "user")!;
    const fn = vertices.find((v) => v.id === "hashpassword")!;
    expect(user.style).toContain("#dae8fc");
    expect(fn.style).toContain("#d5e8d4");
  });

  it("emits code relationships as edges", () => {
    const { edges } = buildCodeCells(model, model.components[0]);
    expect(
      edges.find((x) => x.source === "user" && x.target === "hashpassword"),
    ).toBeDefined();
  });
});
