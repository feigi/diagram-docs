import { describe, it, expect } from "vitest";
import { generateCodeDiagram } from "../../../src/generator/d2/code.js";
import {
  getProfileForLanguage,
  selectProfileForComponent,
} from "../../../src/generator/d2/code-profiles.js";
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

  it("emits class members inside shape:class containers", () => {
    const modelWithMembers: ArchitectureModel = {
      ...model,
      codeElements: [
        {
          id: "api.users.UserService",
          componentId: "users",
          kind: "class",
          name: "UserService",
          visibility: "public",
          members: [
            { name: "users", kind: "field", signature: "users: List<User>" },
            {
              name: "findByName",
              kind: "method",
              signature: "findByName(name: String): User",
            },
          ],
        },
      ],
      codeRelationships: [],
    } as any;
    const d2 = generateCodeDiagram(
      modelWithMembers,
      component,
      getProfileForLanguage("java"),
    );
    expect(d2).toContain("shape: class");
    expect(d2).toContain("findByName(name: String): User");
    expect(d2).toContain("users: List<User>");
  });

  it("renders external refs with valid D2 style syntax (not scalar 'style: dashed')", () => {
    const modelWithExternal: ArchitectureModel = {
      ...model,
      codeElements: [
        {
          id: "api.users.UserService",
          componentId: "users",
          kind: "class",
          name: "UserService",
          visibility: "public",
        },
      ],
      codeRelationships: [
        {
          sourceId: "api.users.UserService",
          targetId: "api.other.ExternalDep",
          kind: "uses",
        },
      ],
    } as any;
    const d2 = generateCodeDiagram(
      modelWithExternal,
      component,
      getProfileForLanguage("java"),
    );
    // Bug: `{ style: "dashed" }` emits `id.style: dashed` — invalid D2.
    // Fix: use a nested style property like `style.stroke-dash`.
    expect(d2).not.toMatch(/\.style:\s*dashed/);
    expect(d2).toMatch(/\.style\.stroke-dash:/);
  });

  it("C profile renders external refs with valid D2 style syntax", () => {
    const cComponent: Component = { ...component, id: "ht" } as any;
    const cModel: ArchitectureModel = {
      ...model,
      codeElements: [
        {
          id: "lib.ht.hash_insert",
          componentId: "ht",
          kind: "function",
          name: "hash_insert",
          visibility: "public",
        },
      ],
      codeRelationships: [
        {
          sourceId: "lib.ht.hash_insert",
          targetId: "lib.other.external_helper",
          kind: "uses",
        },
      ],
    } as any;
    const d2 = generateCodeDiagram(
      cModel,
      cComponent,
      getProfileForLanguage("c"),
    );
    expect(d2).not.toMatch(/\.style:\s*dashed/);
    expect(d2).toMatch(/\.style\.stroke-dash:/);
  });

  it("selectProfileForComponent picks C when most files are .c/.h", () => {
    const result = selectProfileForComponent({
      java: 1,
      c: 5,
      python: 0,
      typescript: 0,
    });
    expect(result).toBe("c");
  });

  it("selectProfileForComponent applies tiebreak Java > TS > Python > C", () => {
    expect(
      selectProfileForComponent({ java: 3, typescript: 3, python: 0, c: 0 }),
    ).toBe("java");
    expect(
      selectProfileForComponent({ typescript: 3, python: 3, java: 0, c: 0 }),
    ).toBe("typescript");
    expect(
      selectProfileForComponent({ python: 3, c: 3, java: 0, typescript: 0 }),
    ).toBe("python");
  });

  it("selectProfileForComponent returns null when every count is zero", () => {
    expect(
      selectProfileForComponent({ java: 0, typescript: 0, python: 0, c: 0 }),
    ).toBeNull();
  });

  it("selectProfileForComponent picks C even when C is alphabetically last", () => {
    // Regression: initial winner must not default to Java when C-only counts
    // arrive — otherwise a C-only component silently renders with Java shapes.
    expect(
      selectProfileForComponent({ java: 0, typescript: 0, python: 0, c: 5 }),
    ).toBe("c");
  });

  it("C profile groups types, public functions, and internal functions", () => {
    const cComponent: Component = { ...component, id: "ht" } as any;
    const cModel: ArchitectureModel = {
      ...model,
      codeElements: [
        {
          id: "lib.ht.hash_table",
          componentId: "ht",
          kind: "struct",
          name: "hash_table",
          visibility: "public",
          members: [
            {
              name: "entries",
              kind: "field",
              signature: "entries: hash_entry**",
            },
            { name: "count", kind: "field", signature: "count: size_t" },
          ],
        },
        {
          id: "lib.ht.hash_insert",
          componentId: "ht",
          kind: "function",
          name: "hash_insert",
          visibility: "public",
        },
        {
          id: "lib.ht.rehash",
          componentId: "ht",
          kind: "function",
          name: "rehash",
          visibility: "private",
        },
      ],
      codeRelationships: [],
    } as any;
    const d2 = generateCodeDiagram(
      cModel,
      cComponent,
      getProfileForLanguage("c"),
    );
    expect(d2).toMatch(/types:.*\{/);
    expect(d2).toMatch(/public:.*\{/);
    expect(d2).toMatch(/internal:.*\{/);
    expect(d2).toContain("hash_table");
    expect(d2).toContain("hash_insert");
    expect(d2).toContain("rehash");
  });
});
