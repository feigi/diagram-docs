import { describe, it, expect, vi } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";
import {
  codeFixture as raw,
  codeFixtureComponents as components,
  crossComponentFixture,
  crossComponentComponents,
  crossContainerFixture,
  crossContainerComponents,
  mixedVisibilityFixture,
  makeConfig,
} from "./fixtures/code-model-fixture.js";

const baseConfig = makeConfig(true);

describe("buildCodeModel", () => {
  it("short-circuits to empty when levels.code is false", () => {
    const result = buildCodeModel(raw, components, makeConfig(false));
    expect(result).toEqual({ codeElements: [], codeRelationships: [] });
  });

  it("assigns qualified IDs rooted in containerId.componentId", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig);
    const ids = codeElements.map((e) => e.id).sort();
    expect(ids).toEqual(["api.users.Auditable", "api.users.UserService"]);
  });

  it("preserves componentId and containerId on every element", () => {
    const { codeElements } = buildCodeModel(raw, components, baseConfig);
    for (const el of codeElements) {
      expect(el.componentId).toBe("users");
      expect(el.containerId).toBe("api");
    }
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

describe("buildCodeModel cross-component resolution", () => {
  it("resolves references across components in the same container", () => {
    const { codeRelationships } = buildCodeModel(
      crossComponentFixture,
      crossComponentComponents,
      baseConfig,
    );
    expect(codeRelationships).toContainEqual({
      sourceId: "api.auth.AuthService",
      targetId: "api.logging.Logger",
      kind: "uses",
    });
  });

  it("does NOT resolve references across containers", () => {
    const { codeRelationships } = buildCodeModel(
      crossContainerFixture,
      crossContainerComponents,
      baseConfig,
    );
    expect(codeRelationships).toEqual([]);
  });
});

describe("buildCodeModel visibility filter", () => {
  it("drops private elements and private members when includePrivate=false", () => {
    const config = makeConfig(true, {
      includePrivate: false,
      minElements: 1,
    });
    const { codeElements } = buildCodeModel(
      mixedVisibilityFixture,
      [
        {
          id: "users",
          containerId: "api",
          name: "users",
          description: "",
          technology: "",
          moduleIds: ["users"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      config,
    );
    const names = codeElements.map((e) => e.name).sort();
    expect(names).toEqual(["Helper", "UserService"]);
    const us = codeElements.find((e) => e.name === "UserService")!;
    expect(us.members?.map((m) => m.name)).toEqual(["getUser"]);
  });

  it("keeps private elements and private members when includePrivate=true", () => {
    const config = makeConfig(true, { includePrivate: true, minElements: 1 });
    const { codeElements } = buildCodeModel(
      mixedVisibilityFixture,
      [
        {
          id: "users",
          containerId: "api",
          name: "users",
          description: "",
          technology: "",
          moduleIds: ["users"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      config,
    );
    const names = codeElements.map((e) => e.name).sort();
    expect(names).toEqual(["Helper", "InternalUtil", "UserService"]);
    const us = codeElements.find((e) => e.name === "UserService")!;
    expect(us.members?.map((m) => m.name).sort()).toEqual([
      "_cache",
      "getUser",
    ]);
  });
});

describe("buildCodeModel minElements threshold", () => {
  it("drops all elements of a component with fewer than minElements", () => {
    const config = makeConfig(true, { minElements: 3 });
    const { codeElements } = buildCodeModel(raw, components, config);
    expect(codeElements).toEqual([]);
  });

  it("keeps elements when count exactly equals minElements", () => {
    const config = makeConfig(true, { minElements: 2 });
    const { codeElements } = buildCodeModel(raw, components, config);
    expect(codeElements).toHaveLength(2);
  });

  it("drops relationships whose source was filtered out", () => {
    const config = makeConfig(true, { minElements: 3 });
    const { codeRelationships } = buildCodeModel(raw, components, config);
    expect(codeRelationships).toEqual([]);
  });
});

describe("buildCodeModel collision handling", () => {
  it("warns on same-component name collision and picks first match", () => {
    const collidingFixture = JSON.parse(JSON.stringify(raw));
    collidingFixture.applications[0].modules[0].codeElements.push({
      id: "Auditable",
      name: "Auditable",
      kind: "interface",
      visibility: "public",
      location: { file: "Other.java", line: 1 },
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { codeRelationships } = buildCodeModel(
      collidingFixture,
      components,
      baseConfig,
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("name collision"),
    );
    expect(codeRelationships.length).toBe(1);
    stderrSpy.mockRestore();
  });
});
