import { describe, it, expect } from "vitest";
import { buildContainerCells } from "../../../src/generator/drawio/container.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "desc" },
  actors: [{ id: "customer", name: "Customer", description: "" }],
  externalSystems: [
    { id: "payment", name: "Payment", description: "", technology: "REST" },
  ],
  containers: [
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "",
      technology: "TS",
    },
    {
      id: "api",
      applicationId: "api",
      name: "API",
      description: "",
      technology: "Go",
    },
    {
      id: "orphan",
      applicationId: "orphan",
      name: "Orphan",
      description: "",
      technology: "?",
    },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    { sourceId: "web", targetId: "api", label: "calls" },
    { sourceId: "api", targetId: "payment", label: "charges" },
  ],
};

describe("buildContainerCells", () => {
  it("emits system boundary vertex with containers as children", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "system")).toBeDefined();
    expect(vertices.find((v) => v.id === "web")?.parent).toBe("system");
  });

  it("drops containers with no relationships", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "orphan")).toBeUndefined();
  });

  it("emits actor and external-system vertices at top level", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "customer")?.parent).toBeUndefined();
    expect(vertices.find((v) => v.id === "payment")?.parent).toBeUndefined();
  });

  it("edges reference containers directly (not via system)", () => {
    const { edges } = buildContainerCells(model);
    expect(
      edges.find((e) => e.source === "web" && e.target === "api"),
    ).toBeDefined();
  });
});
