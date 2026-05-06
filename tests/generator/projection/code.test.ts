import { describe, it, expect } from "vitest";
import { projectCode } from "../../../src/generator/projection/code.js";
import type {
  CodeVertexSpec,
  VertexSpec,
} from "../../../src/generator/projection/types.js";
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
      members: [{ name: "id", kind: "field", signature: "id: string" }],
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

function asCode(v: VertexSpec | undefined): CodeVertexSpec {
  if (!v || v.kind !== "code-element") {
    throw new Error("expected code-element vertex");
  }
  return v;
}

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
    const userVertex = asCode(
      spec.vertices.find((v) => v.id === "api.users.User"),
    );
    expect(userVertex.kind).toBe("code-element");
    expect(userVertex.parentId).toBe("users");
    expect(userVertex.elementKind).toBe("class");
  });

  it("propagates members and visibility onto code-element vertices", () => {
    const spec = projectCode(baseModel, "users");
    const userVertex = asCode(
      spec.vertices.find((v) => v.id === "api.users.User"),
    );
    expect(userVertex.members).toEqual([
      { name: "id", signature: "id: string" },
    ]);
    expect(userVertex.visibility).toBe("public");
  });

  it("emits foreign code-element vertex for cross-component edge target, tagged cross-component", () => {
    const spec = projectCode(baseModel, "users");
    const foreignEl = asCode(
      spec.vertices.find((v) => v.id === "api.billing.Invoice"),
    );
    expect(foreignEl.kind).toBe("code-element");
    expect(foreignEl.tags).toContain("cross-component");
    expect(foreignEl.parentId).toBe("billing");
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

  it("drops + warns when a relationship source has no matching code element", () => {
    const broken: ArchitectureModel = {
      ...baseModel,
      codeRelationships: [
        {
          sourceId: "api.unknown.Ghost",
          targetId: "api.users.User",
          kind: "uses",
        },
      ],
    } as any;
    const spec = projectCode(broken, "users");
    expect(spec.edges).toHaveLength(0);
    expect(
      spec.warnings.some(
        (w) => w.includes("api.unknown.Ghost") && w.includes("source"),
      ),
    ).toBe(true);
  });

  it("does NOT warn when a relationship's source belongs to another local component (expected filter)", () => {
    const spec = projectCode(baseModel, "billing");
    // The two relationships have sources in `users`; from `billing`'s view
    // they're foreign-source filtered, not contract violations.
    expect(spec.warnings).toHaveLength(0);
  });

  it("dedupes foreign code-element vertex when multiple edges target it", () => {
    const dupTarget: ArchitectureModel = {
      ...baseModel,
      codeElements: [
        ...(baseModel.codeElements ?? []),
        {
          id: "api.users.UserController",
          componentId: "users",
          containerId: "api",
          kind: "class",
          name: "UserController",
          visibility: "public",
        },
      ],
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.billing.Invoice",
          kind: "uses",
        },
        {
          sourceId: "api.users.UserController",
          targetId: "api.billing.Invoice",
          kind: "uses",
        },
      ],
    } as any;
    const spec = projectCode(dupTarget, "users");
    const invoiceVerts = spec.vertices.filter(
      (v) => v.id === "api.billing.Invoice",
    );
    expect(invoiceVerts).toHaveLength(1);
  });

  it("dedupes foreign component boundary when multiple edges target the same foreign component", () => {
    const dupComp: ArchitectureModel = {
      ...baseModel,
      codeElements: [
        ...(baseModel.codeElements ?? []),
        {
          id: "api.billing.Receipt",
          componentId: "billing",
          containerId: "api",
          kind: "class",
          name: "Receipt",
          visibility: "public",
        },
      ],
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.billing.Invoice",
          kind: "uses",
        },
        {
          sourceId: "api.users.UserService",
          targetId: "api.billing.Receipt",
          kind: "uses",
        },
      ],
    } as any;
    const spec = projectCode(dupComp, "users");
    const billingBoundaries = spec.vertices.filter(
      (v) => v.kind === "component" && v.id === "billing",
    );
    expect(billingBoundaries).toHaveLength(1);
  });

  it("emits the local boundary even when the component has zero code elements", () => {
    const empty: ArchitectureModel = {
      ...baseModel,
      codeElements: [],
      codeRelationships: [],
    } as any;
    const spec = projectCode(empty, "users");
    const boundary = spec.vertices.find(
      (v) => v.kind === "component" && v.id === "users",
    );
    expect(boundary).toBeDefined();
    expect(spec.edges).toHaveLength(0);
  });

  it("renders self-referential edges (sourceId === targetId)", () => {
    const selfRef: ArchitectureModel = {
      ...baseModel,
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.users.UserService",
          kind: "uses",
        },
      ],
    } as any;
    const spec = projectCode(selfRef, "users");
    const selfEdge = spec.edges.find(
      (e) =>
        e.sourceId === "api.users.UserService" &&
        e.targetId === "api.users.UserService",
    );
    expect(selfEdge).toBeDefined();
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

  it("stores relationship.kind in EdgeSpec.label and .kind", () => {
    const spec = projectCode(baseModel, "users");
    for (const e of spec.edges) {
      expect(e.label).toBe("uses");
      expect(e.kind).toBe("uses");
    }
  });

  it("EdgeSpec.label honors an explicit relationship.label override (kind stays canonical)", () => {
    const labeled: ArchitectureModel = {
      ...baseModel,
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.users.User",
          kind: "uses",
          label: "calls",
        },
      ],
    } as any;
    const spec = projectCode(labeled, "users");
    const edge = spec.edges[0];
    expect(edge.label).toBe("calls");
    expect(edge.kind).toBe("uses");
  });
});
