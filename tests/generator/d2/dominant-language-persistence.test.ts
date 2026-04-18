import { describe, it, expect, vi } from "vitest";
import { dominantLanguageForComponent } from "../../../src/generator/d2/code-helpers.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const makeModel = (
  lang: "typescript" | "java" | undefined,
): ArchitectureModel => ({
  version: 1,
  system: { name: "", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "c1",
      applicationId: "a1",
      name: "C1",
      description: "",
      technology: "",
    },
  ],
  components: [
    {
      id: "comp1",
      containerId: "c1",
      name: "Comp1",
      description: "",
      technology: "",
      moduleIds: ["m1"],
    },
  ],
  relationships: [],
  codeElements: [
    {
      id: "e1",
      componentId: "comp1",
      containerId: "c1",
      kind: "class",
      name: "E1",
      language: lang,
    },
    {
      id: "e2",
      componentId: "comp1",
      containerId: "c1",
      kind: "function",
      name: "fn",
      language: lang,
    },
  ],
});

describe("dominantLanguageForComponent — persisted language wins", () => {
  it("reads language directly from CodeElement when set (no rawStructure needed)", () => {
    const model = makeModel("typescript");
    expect(
      dominantLanguageForComponent(model.components[0], model, undefined),
    ).toBe("typescript");
  });

  it("falls back to kind-based default + warn when nothing is persisted", () => {
    const model = makeModel(undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const picked = dominantLanguageForComponent(
        model.components[0],
        model,
        undefined,
      );
      expect(picked).toBe("java");
    } finally {
      errSpy.mockRestore();
    }
  });
});
