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
        targetName: "Auditable",
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
      targetName: "Logger",
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

describe("buildCodeModel reference-kind mapping", () => {
  it("maps raw extends→inherits, implements→implements, uses→uses, contains→contains", () => {
    const fixture = {
      applications: [
        {
          id: "api",
          name: "api",
          language: "java",
          path: "/tmp/api",
          modules: [
            {
              id: "m",
              path: "/tmp/api/m",
              name: "m",
              files: [],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "Child",
                  name: "Child",
                  kind: "class" as const,
                  visibility: "public" as const,
                  references: [
                    { targetName: "Parent", kind: "extends" as const },
                    { targetName: "Iface", kind: "implements" as const },
                    { targetName: "Helper", kind: "uses" as const },
                    { targetName: "Pieces", kind: "contains" as const },
                  ],
                  location: { file: "Child.java", line: 1 },
                },
                {
                  id: "Parent",
                  name: "Parent",
                  kind: "class" as const,
                  visibility: "public" as const,
                  location: { file: "Parent.java", line: 1 },
                },
                {
                  id: "Iface",
                  name: "Iface",
                  kind: "interface" as const,
                  visibility: "public" as const,
                  location: { file: "Iface.java", line: 1 },
                },
                {
                  id: "Helper",
                  name: "Helper",
                  kind: "class" as const,
                  visibility: "public" as const,
                  location: { file: "Helper.java", line: 1 },
                },
                {
                  id: "Pieces",
                  name: "Pieces",
                  kind: "class" as const,
                  visibility: "public" as const,
                  location: { file: "Pieces.java", line: 1 },
                },
              ],
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const comps = [
      {
        id: "m",
        containerId: "api",
        name: "m",
        description: "",
        technology: "",
        moduleIds: ["m"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
    const { codeRelationships } = buildCodeModel(fixture, comps, baseConfig);
    const kindsByTarget = Object.fromEntries(
      codeRelationships.map((r) => [r.targetId, r.kind]),
    );
    expect(kindsByTarget["api.m.Parent"]).toBe("inherits");
    expect(kindsByTarget["api.m.Iface"]).toBe("implements");
    expect(kindsByTarget["api.m.Helper"]).toBe("uses");
    expect(kindsByTarget["api.m.Pieces"]).toBe("contains");
  });
});

describe("buildCodeModel silent-drop of unresolvable refs", () => {
  it("produces zero relationships and no throw when ref is external", () => {
    const fixture = JSON.parse(JSON.stringify(raw));
    fixture.applications[0].modules[0].codeElements[0].references = [
      { targetName: "java.io.Serializable", kind: "implements" },
    ];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { codeRelationships } = buildCodeModel(
      fixture,
      components,
      baseConfig,
    );
    expect(codeRelationships).toEqual([]);
    // Aggregate drop-count is surfaced by default so users can see "N refs
    // dropped" without turning on debug mode.
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("code reference(s) dropped"),
    );
    stderrSpy.mockRestore();
  });

  it("emits per-component breakdown only when DIAGRAM_DOCS_DEBUG is set", () => {
    const fixture = JSON.parse(JSON.stringify(raw));
    fixture.applications[0].modules[0].codeElements[0].references = [
      { targetName: "External", kind: "uses" },
    ];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const prev = process.env.DIAGRAM_DOCS_DEBUG;
    delete process.env.DIAGRAM_DOCS_DEBUG;
    try {
      buildCodeModel(fixture, components, baseConfig);
      const withoutDebug = stderrSpy.mock.calls.some((args) =>
        String(args[0]).includes("[L4 debug] component"),
      );
      expect(withoutDebug).toBe(false);
      stderrSpy.mockClear();
      process.env.DIAGRAM_DOCS_DEBUG = "1";
      buildCodeModel(fixture, components, baseConfig);
      const withDebug = stderrSpy.mock.calls.some((args) =>
        String(args[0]).includes("[L4 debug] component"),
      );
      expect(withDebug).toBe(true);
    } finally {
      stderrSpy.mockRestore();
      if (prev === undefined) delete process.env.DIAGRAM_DOCS_DEBUG;
      else process.env.DIAGRAM_DOCS_DEBUG = prev;
    }
  });
});

describe("buildCodeModel includeMembers toggle", () => {
  it("strips members from every element when includeMembers is false", () => {
    const config = makeConfig(true, { includeMembers: false, minElements: 1 });
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
    for (const el of codeElements) {
      expect(el.members).toBeUndefined();
    }
  });
});

describe("buildCodeModel targetName on relationships", () => {
  it("populates targetName with the resolved element's display name", () => {
    const { codeRelationships } = buildCodeModel(raw, components, baseConfig);
    expect(codeRelationships[0].targetName).toBe("Auditable");
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
    // Same-name raw elements across files inside one component are
    // disambiguated with a file-stem suffix (see buildCodeModel); the picked
    // id therefore always carries one of the two suffixes, sorted
    // lexicographically — in this fixture `other` sorts before `userservice`.
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /picking api\.users\.Auditable-(other|userservice)/,
      ),
    );
    expect(codeRelationships.length).toBe(1);
    stderrSpy.mockRestore();
  });

  it("disambiguates qualified IDs when two raw elements in one component share a name", () => {
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
    const { codeElements } = buildCodeModel(
      collidingFixture,
      components,
      baseConfig,
    );
    const auditables = codeElements
      .filter((e) => e.name === "Auditable")
      .map((e) => e.id)
      .sort();
    expect(auditables).toEqual([
      "api.users.Auditable-other",
      "api.users.Auditable-userservice",
    ]);
    stderrSpy.mockRestore();
  });

  it("classifies cross-container target drops distinctly from stdlib drops", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    buildCodeModel(crossContainerFixture, crossContainerComponents, baseConfig);
    const messages = stderrSpy.mock.calls
      .map((args) => String(args[0]))
      .join("\n");
    expect(messages).toContain("cross container boundaries");
    stderrSpy.mockRestore();
  });
});
