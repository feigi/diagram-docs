import { describe, it, expect } from "vitest";
import {
  buildCodeCells,
  emitCodeCells,
} from "../../../src/generator/drawio/code.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import type { DiagramSpec } from "../../../src/generator/projection/types.js";

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

  it("tags code-element vertices with code-class or code-fn kind", () => {
    const { vertices } = buildCodeCells(model, model.components[0]);
    const classVertex = vertices.find((v) => v.kind === "code-class");
    const fnVertex = vertices.find((v) => v.kind === "code-fn");
    expect(classVertex).toBeDefined();
    expect(fnVertex).toBeDefined();
  });

  it("tags the component boundary as system-boundary", () => {
    const { vertices } = buildCodeCells(model, model.components[0]);
    const boundary = vertices.find((v) => v.style.includes("dashed=1"));
    expect(boundary?.kind).toBe("system-boundary");
  });

  it("renders cross-component foreign boundary with a distinct dotted stroke", () => {
    const crossModel: ArchitectureModel = {
      ...model,
      components: [
        ...model.components,
        {
          id: "billing",
          containerId: "api",
          name: "Billing",
          description: "",
          technology: "Go",
          moduleIds: [],
        },
      ],
      codeElements: [
        ...(model.codeElements ?? []),
        {
          id: "Invoice",
          componentId: "billing",
          containerId: "api",
          name: "Invoice",
          kind: "class",
        },
      ],
      codeRelationships: [
        { sourceId: "User", targetId: "Invoice", kind: "uses" },
      ],
    };
    const { vertices } = buildCodeCells(crossModel, crossModel.components[0]);
    const local = vertices.find((v) => v.id === "auth")!;
    const foreign = vertices.find((v) => v.id === "billing")!;
    expect(local.kind).toBe("system-boundary");
    expect(foreign.kind).toBe("system-boundary");
    expect(local.style.includes("dashed=2")).toBe(false);
    expect(foreign.style).toContain("dashed=2");
    expect(foreign.value).toContain("[External Component]");
  });

  it("nests cross-component code-element under foreign boundary via parent", () => {
    const crossModel: ArchitectureModel = {
      ...model,
      components: [
        ...model.components,
        {
          id: "billing",
          containerId: "api",
          name: "Billing",
          description: "",
          technology: "Go",
          moduleIds: [],
        },
      ],
      codeElements: [
        ...(model.codeElements ?? []),
        {
          id: "Invoice",
          componentId: "billing",
          containerId: "api",
          name: "Invoice",
          kind: "class",
        },
      ],
      codeRelationships: [
        { sourceId: "User", targetId: "Invoice", kind: "uses" },
      ],
    };
    const { vertices } = buildCodeCells(crossModel, crossModel.components[0]);
    const invoice = vertices.find((v) => v.id === "invoice")!;
    expect(invoice.parent).toBe("billing");
    expect(invoice.style).toContain("dashed=2");
  });

  it("maps each elementKind to the right style key", () => {
    const allKinds: ArchitectureModel = {
      ...model,
      codeElements: [
        {
          id: "C",
          componentId: "auth",
          containerId: "api",
          name: "C",
          kind: "class",
        },
        {
          id: "I",
          componentId: "auth",
          containerId: "api",
          name: "I",
          kind: "interface",
        },
        {
          id: "E",
          componentId: "auth",
          containerId: "api",
          name: "E",
          kind: "enum",
        },
        {
          id: "S",
          componentId: "auth",
          containerId: "api",
          name: "S",
          kind: "struct",
        },
        {
          id: "T",
          componentId: "auth",
          containerId: "api",
          name: "T",
          kind: "type",
        },
        {
          id: "TD",
          componentId: "auth",
          containerId: "api",
          name: "TD",
          kind: "typedef",
        },
        {
          id: "F",
          componentId: "auth",
          containerId: "api",
          name: "F",
          kind: "function",
        },
      ],
      codeRelationships: [],
    };
    const { vertices } = buildCodeCells(allKinds, allKinds.components[0]);
    const get = (id: string) => vertices.find((v) => v.id === id)!;
    for (const id of ["c", "i", "e", "s"]) {
      expect(get(id).kind).toBe("code-class");
    }
    for (const id of ["t", "td", "f"]) {
      expect(get(id).kind).toBe("code-fn");
    }
  });

  it("throws on an unexpected projection vertex kind", () => {
    const badSpec: DiagramSpec = {
      vertices: [
        {
          id: "stray",
          name: "Stray",
          kind: "actor",
        },
      ],
      edges: [],
      warnings: [],
    };
    expect(() => emitCodeCells(badSpec)).toThrow(/unexpected vertex kind/);
  });
});
