import { describe, it, expect } from "vitest";
import { architectureModelSchema } from "../../src/core/model.js";

describe("architectureModelSchema — codeRelationship.targetId validation", () => {
  const baseModel = {
    version: 1,
    system: { name: "S", description: "" },
    actors: [],
    externalSystems: [],
    containers: [
      {
        id: "c1",
        applicationId: "a1",
        name: "C1",
        description: "",
        technology: "t",
      },
    ],
    components: [
      {
        id: "comp1",
        containerId: "c1",
        name: "Comp1",
        description: "",
        technology: "t",
        moduleIds: [],
      },
    ],
    relationships: [],
    codeElements: [
      {
        id: "e1",
        componentId: "comp1",
        containerId: "c1",
        kind: "class" as const,
        name: "E1",
      },
    ],
  };

  it("rejects relationships with dangling targetId", () => {
    const bad = {
      ...baseModel,
      codeRelationships: [
        { sourceId: "e1", targetId: "does-not-exist", kind: "uses" as const },
      ],
    };
    const result = architectureModelSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("targetId");
    }
  });

  it("accepts relationships with valid sourceId and targetId", () => {
    const good = {
      ...baseModel,
      codeElements: [
        ...baseModel.codeElements,
        {
          id: "e2",
          componentId: "comp1",
          containerId: "c1",
          kind: "class" as const,
          name: "E2",
        },
      ],
      codeRelationships: [
        { sourceId: "e1", targetId: "e2", kind: "uses" as const },
      ],
    };
    expect(architectureModelSchema.safeParse(good).success).toBe(true);
  });
});
