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
      description: "Handles authentication and session management",
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
    { sourceId: "auth", targetId: "user", label: "uses", technology: "gRPC" },
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

  it("moves component description to tooltip and keeps value compact", () => {
    const { vertices } = buildComponentCells(model, "api");
    // auth has a non-empty description in the fixture
    const comp = vertices.find((v) => v.id === "auth")!;
    const componentModel = model.components.find((c) => c.id === "auth")!;
    expect(comp.value).toBe(
      `${componentModel.name}\n[Component: ${componentModel.technology}]`,
    );
    expect(comp.tooltip).toBe(componentModel.description);
  });

  it("moves edge tech tag into edge tooltip and keeps edge value to the label", () => {
    const { edges } = buildComponentCells(model, "api");
    // auth→user has technology: "gRPC"
    const edge = edges.find((e) => e.tooltip !== undefined);
    expect(edge).toBeDefined();
    expect(edge!.value).not.toContain("[");
    expect(edge!.tooltip).toMatch(/^\[.+\]$/);
  });

  it("renders an actor with person styling when referenced from a component", () => {
    const withActor: ArchitectureModel = {
      ...model,
      actors: [
        { id: "admin", name: "Admin", description: "Operator of the platform" },
      ],
      relationships: [
        ...model.relationships,
        { sourceId: "admin", targetId: "auth", label: "manages" },
      ],
    };
    const { vertices } = buildComponentCells(withActor, "api");
    const actor = vertices.find((v) => v.id === "admin");
    expect(actor).toBeDefined();
    expect(actor!.kind).toBe("person");
    expect(actor!.value).toBe("Admin\n[Person]");
    expect(actor!.tooltip).toBe("Operator of the platform");
    expect(actor!.parent).toBeUndefined();
  });

  it("includes technology line and [External System] tag for external refs at L3", () => {
    const withExternal: ArchitectureModel = {
      ...model,
      externalSystems: [
        {
          id: "billing",
          name: "Billing",
          description: "",
          technology: "Stripe",
        },
      ],
      relationships: [
        ...model.relationships,
        { sourceId: "auth", targetId: "billing", label: "charges" },
      ],
    };
    const { vertices } = buildComponentCells(withExternal, "api");
    const ext = vertices.find((v) => v.id === "billing")!;
    expect(ext.value).toBe("Billing\n[External System]\n[Stripe]");
  });

  it("renders [Library] tag for library-tagged externals at L3", () => {
    const withLib: ArchitectureModel = {
      ...model,
      externalSystems: [
        {
          id: "lodash",
          name: "lodash",
          description: "",
          technology: "npm",
          tags: ["library"],
        },
      ],
      relationships: [
        ...model.relationships,
        { sourceId: "auth", targetId: "lodash", label: "uses" },
      ],
    };
    const { vertices } = buildComponentCells(withLib, "api");
    const lib = vertices.find((v) => v.id === "lodash")!;
    expect(lib.value).toBe("lodash\n[Library]\n[npm]");
  });

  it("omits tooltip when component description is empty", () => {
    const minimal: ArchitectureModel = {
      ...model,
      components: [
        {
          id: "bare",
          containerId: "api",
          name: "Bare",
          description: "",
          technology: "X",
          moduleIds: [],
        },
      ],
      relationships: [],
    };
    const { vertices } = buildComponentCells(minimal, "api");
    const bare = vertices.find((v) => v.id === "bare")!;
    expect(bare.value).toBe("Bare\n[Component: X]");
    expect(bare.tooltip).toBeUndefined();
  });
});
