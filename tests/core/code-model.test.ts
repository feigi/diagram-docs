import { describe, it, expect } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";
import type {
  RawStructure,
  Component,
  Config,
} from "../../src/analyzers/types.js";

const baseConfig: Pick<Config, "levels" | "code"> = {
  levels: { context: true, container: true, component: true, code: true },
  code: { includePrivate: false, includeMembers: true, minElements: 2 },
};

const raw: RawStructure = {
  applications: [
    {
      id: "api",
      name: "api",
      language: "java",
      path: "/tmp/api",
      modules: [
        {
          id: "users",
          path: "/tmp/api/users",
          name: "users",
          files: ["UserService.java"],
          exports: [],
          imports: [],
          metadata: {},
          codeElements: [
            {
              id: "UserService",
              name: "UserService",
              kind: "class",
              visibility: "public",
              references: [{ targetName: "Auditable", kind: "implements" }],
              location: { file: "UserService.java", line: 1 },
            },
            {
              id: "Auditable",
              name: "Auditable",
              kind: "interface",
              visibility: "public",
              location: { file: "UserService.java", line: 1 },
            },
          ],
        },
      ],
      externalDependencies: [],
      internalImports: [],
    },
  ],
} as any;

const components: Component[] = [
  {
    id: "users",
    containerId: "api",
    name: "users",
    description: "",
    technology: "",
    moduleIds: ["users"],
  } as any,
];

describe("buildCodeModel", () => {
  it("assigns qualified IDs rooted in containerId.componentId", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig as any);
    const ids = codeElements.map((e) => e.id).sort();
    expect(ids).toEqual(["api.users.Auditable", "api.users.UserService"]);
  });

  it("preserves componentId reference", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig as any);
    for (const el of codeElements) expect(el.componentId).toBe("users");
  });

  it("resolves same-component references into codeRelationships", () => {
    const { codeRelationships } = buildCodeModel(
      raw,
      components,
      baseConfig as any,
    );
    expect(codeRelationships).toEqual([
      {
        sourceId: "api.users.UserService",
        targetId: "api.users.Auditable",
        kind: "implements",
      },
    ]);
  });
});
