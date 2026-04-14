import { describe, it, expect } from "vitest";
import type {
  RawCodeElement,
  CodeMember,
  RawCodeReference,
  CodeElement,
  CodeRelationship,
  ScannedModule,
  ArchitectureModel,
} from "../../src/analyzers/types.js";

describe("code-level types", () => {
  it("RawCodeElement has required and optional fields", () => {
    const el: RawCodeElement = {
      id: "com.example.Foo",
      kind: "class",
      name: "Foo",
      location: { file: "Foo.java", line: 1 },
    };
    expect(el.id).toBe("com.example.Foo");
  });

  it("CodeElement carries componentId", () => {
    const el: CodeElement = {
      id: "api.users.UserService",
      componentId: "users",
      kind: "class",
      name: "UserService",
    };
    expect(el.componentId).toBe("users");
  });

  it("ScannedModule accepts optional codeElements", () => {
    const mod: ScannedModule = {
      id: "m",
      path: "/tmp",
      name: "m",
      files: [],
      exports: [],
      imports: [],
      metadata: {},
      codeElements: [],
    };
    expect(mod.codeElements).toEqual([]);
  });

  it("ArchitectureModel accepts optional codeElements + codeRelationships", () => {
    const model: Partial<ArchitectureModel> = {
      codeElements: [],
      codeRelationships: [],
    };
    expect(model.codeElements).toEqual([]);
  });

  it("CodeRelationship kind enumerates the four semantic relations", () => {
    const rels: CodeRelationship[] = [
      { sourceId: "a", targetId: "b", kind: "inherits" },
      { sourceId: "a", targetId: "b", kind: "implements" },
      { sourceId: "a", targetId: "b", kind: "uses" },
      { sourceId: "a", targetId: "b", kind: "contains" },
    ];
    expect(rels.length).toBe(4);
  });
});
