import { describe, it, expect } from "vitest";
import { collectAggregatorIds } from "../../src/generator/d2/submodule-scaffold.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

function makeModel(
  containers: Array<{ id: string; path?: string }>,
): ArchitectureModel {
  return {
    version: 1,
    system: { name: "T", description: "" },
    actors: [],
    externalSystems: [],
    containers: containers.map((c) => ({
      id: c.id,
      applicationId: c.id,
      name: c.id,
      description: c.id,
      technology: "Java",
      path: c.path,
    })),
    components: [],
    relationships: [],
  };
}

describe("collectAggregatorIds", () => {
  it("flags a container whose path is an ancestor of another", () => {
    const model = makeModel([
      { id: "los-cha", path: "los-cha" },
      { id: "los-cha-app", path: "los-cha/app" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set(["los-cha"]));
  });

  it("does not flag sibling paths", () => {
    const model = makeModel([
      { id: "a", path: "services/a" },
      { id: "b", path: "services/b" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set());
  });

  it("does not flag containers without a path", () => {
    const model = makeModel([{ id: "x" }, { id: "y", path: "x/y" }]);
    expect(collectAggregatorIds(model)).toEqual(new Set());
  });

  it("handles multi-level nesting", () => {
    const model = makeModel([
      { id: "root", path: "root" },
      { id: "mid", path: "root/mid" },
      { id: "leaf", path: "root/mid/leaf" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set(["root", "mid"]));
  });

  it("does not flag substring-but-not-prefix paths", () => {
    const model = makeModel([
      { id: "a", path: "foo" },
      { id: "b", path: "foobar/x" },
    ]);
    expect(collectAggregatorIds(model)).toEqual(new Set());
  });
});
