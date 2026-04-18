import { describe, it, expect } from "vitest";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { architectureModelSchema } from "../../src/core/model.js";

describe("qualifiedName survives YAML round-trip", () => {
  it("persists on codeElements after parse", () => {
    const model = {
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
          id: "comp1.User",
          componentId: "comp1",
          containerId: "c1",
          kind: "class" as const,
          name: "User",
          qualifiedName: "com.example.user.User",
        },
      ],
    };
    const yaml = stringifyYaml(model);
    const parsed = architectureModelSchema.parse(parseYaml(yaml));
    expect(parsed.codeElements?.[0].qualifiedName).toBe(
      "com.example.user.User",
    );
  });
});
