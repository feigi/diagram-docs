import { describe, it, expect } from "vitest";
import { projectCode } from "../../../src/generator/projection/code.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const baseModel: ArchitectureModel = {
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
      technology: "java",
    },
  ],
  components: [
    {
      id: "users",
      containerId: "api",
      name: "users",
      description: "",
      technology: "java",
      moduleIds: [],
    },
    {
      id: "billing",
      containerId: "api",
      name: "billing",
      description: "",
      technology: "java",
      moduleIds: [],
    },
  ],
  relationships: [],
  codeElements: [
    {
      id: "api.users.User",
      componentId: "users",
      containerId: "api",
      kind: "class",
      name: "User",
      visibility: "public",
      members: [{ name: "id", signature: "id: string" }],
    },
    {
      id: "api.users.UserService",
      componentId: "users",
      containerId: "api",
      kind: "class",
      name: "UserService",
      visibility: "public",
    },
    {
      id: "api.billing.Invoice",
      componentId: "billing",
      containerId: "api",
      kind: "class",
      name: "Invoice",
      visibility: "public",
    },
  ],
  codeRelationships: [
    {
      sourceId: "api.users.UserService",
      targetId: "api.users.User",
      kind: "uses",
    },
    {
      sourceId: "api.users.UserService",
      targetId: "api.billing.Invoice",
      kind: "uses",
    },
  ],
} as any;

describe("projectCode (L4)", () => {
  it("emits the local component as the boundary vertex (no parentId, no cross-component tag)", () => {
    const spec = projectCode(baseModel, "users");
    const boundary = spec.vertices.find(
      (v) => v.kind === "component" && !v.tags?.includes("cross-component"),
    );
    expect(boundary).toBeDefined();
    expect(boundary?.id).toBe("users");
    expect(boundary?.parentId).toBeUndefined();
  });

  it("nests local code-elements under the local component via parentId", () => {
    const spec = projectCode(baseModel, "users");
    const userVertex = spec.vertices.find((v) => v.id === "api.users.User");
    expect(userVertex?.kind).toBe("code-element");
    expect(userVertex?.parentId).toBe("users");
    expect(userVertex?.elementKind).toBe("class");
  });

  it("propagates members, visibility, and language onto code-element vertices", () => {
    const spec = projectCode(baseModel, "users");
    const userVertex = spec.vertices.find((v) => v.id === "api.users.User");
    expect(userVertex?.members).toEqual([
      { name: "id", signature: "id: string" },
    ]);
    expect(userVertex?.visibility).toBe("public");
  });

  it("emits foreign code-element vertex for cross-component edge target, tagged cross-component", () => {
    const spec = projectCode(baseModel, "users");
    const foreignEl = spec.vertices.find((v) => v.id === "api.billing.Invoice");
    expect(foreignEl).toBeDefined();
    expect(foreignEl?.kind).toBe("code-element");
    expect(foreignEl?.tags).toContain("cross-component");
    expect(foreignEl?.parentId).toBe("billing");
  });

  it("emits foreign component boundary on demand (only when an edge crosses)", () => {
    const spec = projectCode(baseModel, "users");
    const foreignBoundary = spec.vertices.find(
      (v) => v.kind === "component" && v.id === "billing",
    );
    expect(foreignBoundary).toBeDefined();
    expect(foreignBoundary?.tags).toContain("cross-component");
  });

  it("does NOT emit a foreign component boundary when no edge crosses to it", () => {
    const isolated: ArchitectureModel = {
      ...baseModel,
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.users.User",
          kind: "uses",
        },
      ],
    } as any;
    const spec = projectCode(isolated, "users");
    const billing = spec.vertices.find(
      (v) => v.kind === "component" && v.id === "billing",
    );
    expect(billing).toBeUndefined();
  });

  it("invariant: every edge's source and target id appears as a vertex", () => {
    const spec = projectCode(baseModel, "users");
    const ids = new Set(spec.vertices.map((v) => v.id));
    for (const e of spec.edges) {
      expect(ids).toContain(e.sourceId);
      expect(ids).toContain(e.targetId);
    }
  });

  it("drops + warns when a relationship target has no matching code element", () => {
    const broken: ArchitectureModel = {
      ...baseModel,
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.unknown.Ghost",
          kind: "uses",
        },
      ],
    } as any;
    const spec = projectCode(broken, "users");
    expect(spec.edges).toHaveLength(0);
    expect(spec.warnings.some((w) => w.includes("api.unknown.Ghost"))).toBe(
      true,
    );
  });

  it("skips relationships whose source is not a local element", () => {
    const spec = projectCode(baseModel, "users");
    for (const e of spec.edges) {
      const src = spec.vertices.find((v) => v.id === e.sourceId);
      expect(src?.parentId).toBe("users");
    }
  });

  it("throws when the requested component is not in the model", () => {
    expect(() => projectCode(baseModel, "ghost")).toThrow(
      /Component not found/,
    );
  });

  it("produces deterministic output across repeat invocations", () => {
    const a = projectCode(baseModel, "users");
    const b = projectCode(baseModel, "users");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stores relationship.kind in EdgeSpec.label", () => {
    const spec = projectCode(baseModel, "users");
    for (const e of spec.edges) {
      expect(e.label).toBe("uses");
    }
  });
});
