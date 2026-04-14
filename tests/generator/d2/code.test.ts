import { describe, it, expect } from "vitest";
import { generateCodeDiagram } from "../../../src/generator/d2/code.js";
import { getProfileForLanguage } from "../../../src/generator/d2/code-profiles.js";
import type {
  ArchitectureModel,
  Component,
} from "../../../src/analyzers/types.js";

const component: Component = {
  id: "users",
  containerId: "api",
  name: "users",
  description: "",
  technology: "",
  moduleIds: ["users"],
} as any;

const model: ArchitectureModel = {
  version: 1,
  system: { name: "s", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "api",
      applicationId: "api",
      name: "api",
      description: "",
      technology: "java",
    } as any,
  ],
  components: [component],
  relationships: [],
  codeElements: [
    {
      id: "api.users.User",
      componentId: "users",
      kind: "class",
      name: "User",
      visibility: "public",
    },
    {
      id: "api.users.UserService",
      componentId: "users",
      kind: "class",
      name: "UserService",
      visibility: "public",
    },
    {
      id: "api.users.Auditable",
      componentId: "users",
      kind: "interface",
      name: "Auditable",
      visibility: "public",
    },
  ],
  codeRelationships: [
    {
      sourceId: "api.users.UserService",
      targetId: "api.users.Auditable",
      kind: "implements",
    },
  ],
} as any;

describe("generateCodeDiagram", () => {
  it("renders a D2 diagram containing element names and relationships", () => {
    const d2 = generateCodeDiagram(
      model,
      component,
      getProfileForLanguage("java"),
    );
    expect(d2).toContain("User");
    expect(d2).toContain("UserService");
    expect(d2).toContain("Auditable");
    expect(d2).toContain("implements");
  });

  it("produces byte-identical output on repeat invocation (stability)", () => {
    const a = generateCodeDiagram(
      model,
      component,
      getProfileForLanguage("java"),
    );
    const b = generateCodeDiagram(
      model,
      component,
      getProfileForLanguage("java"),
    );
    expect(a).toBe(b);
  });
});
