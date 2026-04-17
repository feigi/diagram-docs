import { describe, it, expect } from "vitest";
import {
  codeLinkableComponentIds,
  dominantLanguageForComponent,
} from "../../../src/generator/d2/code-helpers.js";
import type {
  ArchitectureModel,
  Component,
  RawStructure,
} from "../../../src/analyzers/types.js";

const baseModel: ArchitectureModel = {
  version: 1,
  system: { name: "Sys", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "c",
      name: "C",
      technology: "TS",
      description: "",
      applicationId: "c",
    },
  ],
  components: [
    {
      id: "comp-a",
      name: "A",
      containerId: "c",
      technology: "TS",
      description: "",
      moduleIds: [],
    },
    {
      id: "comp-b",
      name: "B",
      containerId: "c",
      technology: "TS",
      description: "",
      moduleIds: [],
    },
  ],
  relationships: [],
  codeElements: [
    {
      id: "e1",
      componentId: "comp-a",
      containerId: "c",
      kind: "class",
      name: "Foo",
    },
    {
      id: "e2",
      componentId: "comp-a",
      containerId: "c",
      kind: "class",
      name: "Bar",
    },
    {
      id: "e3",
      componentId: "comp-b",
      containerId: "c",
      kind: "class",
      name: "Baz",
    },
  ],
  codeRelationships: [],
};

describe("codeLinkableComponentIds", () => {
  it("returns components meeting the minElements threshold", () => {
    const ids = codeLinkableComponentIds(baseModel, 2);
    expect([...ids].sort()).toEqual(["comp-a"]);
  });

  it("returns all components when threshold is 1", () => {
    const ids = codeLinkableComponentIds(baseModel, 1);
    expect([...ids].sort()).toEqual(["comp-a", "comp-b"]);
  });

  it("returns empty set when codeElements is undefined", () => {
    const m = { ...baseModel, codeElements: undefined };
    expect(codeLinkableComponentIds(m, 1).size).toBe(0);
  });
});

describe("dominantLanguageForComponent", () => {
  const comp: Component = {
    id: "comp-a",
    name: "A",
    containerId: "c",
    technology: "Java",
    description: "",
    moduleIds: ["mod-1"],
  };

  it("infers from rawStructure module file count", () => {
    const raw: RawStructure = {
      version: 1,
      scannedAt: "now",
      checksum: "x",
      applications: [
        {
          id: "c",
          path: "c",
          name: "C",
          language: "java",
          buildFile: "pom.xml",
          modules: [
            {
              id: "mod-1",
              path: "src/main/java",
              name: "m",
              files: ["A.java", "B.java"],
              exports: [],
              imports: [],
              metadata: {},
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
      ],
    };
    expect(dominantLanguageForComponent(comp, baseModel, raw)).toBe("java");
  });

  it("falls back to codeElements kind inference when rawStructure missing", () => {
    const m = {
      ...baseModel,
      codeElements: [
        {
          id: "s1",
          componentId: "comp-a",
          containerId: "c",
          kind: "struct" as const,
          name: "S",
        },
        {
          id: "t1",
          componentId: "comp-a",
          containerId: "c",
          kind: "typedef" as const,
          name: "T",
        },
      ],
    };
    expect(dominantLanguageForComponent(comp, m, undefined)).toBe("c");
  });
});
