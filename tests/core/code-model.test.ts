import { describe, it, expect } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";
import {
  codeFixture as raw,
  codeFixtureComponents as components,
  makeConfig,
} from "./fixtures/code-model-fixture.js";

const baseConfig = makeConfig(true);

describe("buildCodeModel", () => {
  it("assigns qualified IDs rooted in containerId.componentId", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig);
    const ids = codeElements.map((e) => e.id).sort();
    expect(ids).toEqual(["api.users.Auditable", "api.users.UserService"]);
  });

  it("preserves componentId reference", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig);
    for (const el of codeElements) expect(el.componentId).toBe("users");
  });

  it("resolves same-component references into codeRelationships", () => {
    const { codeRelationships } = buildCodeModel(raw, components, baseConfig);
    expect(codeRelationships).toEqual([
      {
        sourceId: "api.users.UserService",
        targetId: "api.users.Auditable",
        kind: "implements",
      },
    ]);
  });
});
