import { describe, it, expect } from "vitest";
import { buildComponentCells } from "../../../src/generator/drawio/component.js";
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
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "",
      technology: "TS",
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
    {
      id: "user",
      containerId: "api",
      name: "User",
      description: "",
      technology: "Go",
      moduleIds: [],
    },
    {
      id: "ui",
      containerId: "web",
      name: "UI",
      description: "",
      technology: "TS",
      moduleIds: [],
    },
  ],
  relationships: [
    { sourceId: "auth", targetId: "user", label: "uses" },
    { sourceId: "ui", targetId: "auth", label: "calls" },
  ],
};

describe("buildComponentCells", () => {
  it("emits the container boundary and components nested inside", () => {
    const { vertices } = buildComponentCells(model, "api");
    expect(vertices.find((v) => v.id === "api")).toBeDefined();
    expect(vertices.find((v) => v.id === "auth")?.parent).toBe("api");
  });

  it("emits external component references at top level", () => {
    const { vertices } = buildComponentCells(model, "api");
    const ui = vertices.find((v) => v.id === "ui");
    expect(ui).toBeDefined();
    expect(ui?.parent).toBeUndefined();
  });

  it("throws when container not found", () => {
    expect(() => buildComponentCells(model, "missing")).toThrow();
  });
});
