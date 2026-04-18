import { describe, it, expect, vi } from "vitest";
import { buildCodeModel } from "../../src/core/code-model.js";
import type { RawStructure, Component } from "../../src/analyzers/types.js";
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
    expect(result).toEqual({
      codeElements: [],
      codeRelationships: [],
      droppedReferences: [],
      ambiguousResolutions: [],
    });
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

describe("buildCodeModel — minElements drop is logged", () => {
  it("emits an aggregate stderr warning when elements are filtered", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const raw = {
      version: 1 as const,
      scannedAt: "2026-04-18T00:00:00Z",
      checksum: "x",
      applications: [
        {
          id: "a1",
          path: "a1",
          name: "a1",
          language: "java" as const,
          buildFile: "b",
          modules: [
            {
              id: "m1",
              path: "m1",
              name: "m1",
              files: [],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "OnlyOne",
                  kind: "class" as const,
                  name: "OnlyOne",
                  visibility: "public" as const,
                  location: { file: "f.java", line: 1 },
                },
              ],
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
      ],
    };
    const components = [
      {
        id: "comp1",
        containerId: "a1",
        name: "Comp1",
        description: "",
        technology: "",
        moduleIds: ["m1"],
      },
    ];
    buildCodeModel(raw, components, {
      levels: { context: true, container: true, component: true, code: true },
      code: { includePrivate: false, includeMembers: true, minElements: 2 },
    });
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("minElements=2");
    expect(out).toMatch(/Warning: L4: 1 element\(s\) dropped/);
    spy.mockRestore();
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

  it("disambiguates same-name elements via qualifiedName without warning", () => {
    // Two interfaces named RouteSearchApi in different packages within the
    // same component. Controller's reference carries targetQualifiedName so
    // resolver picks the correct one and does NOT warn.
    const fixture = {
      applications: [
        {
          id: "app",
          name: "app",
          language: "java",
          path: "/tmp/app",
          modules: [
            {
              id: "m",
              path: "/tmp/app/m",
              name: "m",
              files: [],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "RouteSearchApi",
                  name: "RouteSearchApi",
                  qualifiedName: "com.bmw.api.v6.RouteSearchApi",
                  kind: "interface" as const,
                  visibility: "public" as const,
                  location: { file: "v6/RouteSearchApi.java", line: 1 },
                },
                {
                  id: "RouteSearchApi",
                  name: "RouteSearchApi",
                  qualifiedName: "com.bmw.api.v7.RouteSearchApi",
                  kind: "interface" as const,
                  visibility: "public" as const,
                  location: { file: "v7/RouteSearchApi.java", line: 1 },
                },
                {
                  id: "RouteSearchControllerV7",
                  name: "RouteSearchControllerV7",
                  qualifiedName: "com.bmw.app.RouteSearchControllerV7",
                  kind: "class" as const,
                  visibility: "public" as const,
                  references: [
                    {
                      targetName: "RouteSearchApi",
                      targetQualifiedName: "com.bmw.api.v7.RouteSearchApi",
                      kind: "implements" as const,
                    },
                  ],
                  location: { file: "RouteSearchControllerV7.java", line: 1 },
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
        containerId: "app",
        name: "m",
        description: "",
        technology: "",
        moduleIds: ["m"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const { codeRelationships, codeElements } = buildCodeModel(
      fixture,
      comps,
      baseConfig,
    );
    // No collision warning emitted.
    const collisionWarnings = stderrSpy.mock.calls
      .map((a) => String(a[0]))
      .filter((m) => m.includes("name collision"));
    expect(collisionWarnings).toEqual([]);
    // Edge points to the v7 element specifically.
    const v7 = codeElements.find(
      (e) => e.qualifiedName === "com.bmw.api.v7.RouteSearchApi",
    )!;
    expect(codeRelationships).toEqual([
      expect.objectContaining({ targetId: v7.id, kind: "implements" }),
    ]);
    // Disambiguated suffixes come from the qualifiedName slug — unique per
    // element.
    expect(v7.id).toBe("app.m.RouteSearchApi-com-bmw-api-v7-routesearchapi");
    stderrSpy.mockRestore();
  });

  it("falls back to a counter when file path and qualifiedName both collide", () => {
    const fixture = {
      applications: [
        {
          id: "app",
          name: "app",
          language: "java",
          path: "/tmp/app",
          modules: [
            {
              id: "m",
              path: "/tmp/app/m",
              name: "m",
              files: [],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "Foo",
                  name: "Foo",
                  kind: "class" as const,
                  visibility: "public" as const,
                  location: { file: "Foo.java", line: 1 },
                },
                {
                  id: "Foo",
                  name: "Foo",
                  kind: "class" as const,
                  visibility: "public" as const,
                  location: { file: "Foo.java", line: 100 },
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
        containerId: "app",
        name: "m",
        description: "",
        technology: "",
        moduleIds: ["m"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
    const { codeElements } = buildCodeModel(fixture, comps, baseConfig);
    const ids = codeElements.map((e) => e.id).sort();
    expect(ids).toEqual(["app.m.Foo-foo", "app.m.Foo-foo-2"]);
  });
});

describe("buildCodeModel droppedReferences", () => {
  it("populates the array with both stdlib and cross-container drops", () => {
    // Two containers. `user-api.users.UserService` references:
    //   - `Logger` (exists only in a different container → cross-container)
    //   - `java.io.Serializable` (no such element anywhere → stdlib)
    const fixture: RawStructure = {
      applications: [
        {
          id: "user-api",
          name: "user-api",
          language: "java",
          path: "/tmp/user-api",
          modules: [
            {
              id: "users",
              path: "/tmp/user-api/users",
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
                  references: [
                    { targetName: "Logger", kind: "uses" },
                    {
                      targetName: "java.io.Serializable",
                      kind: "implements",
                    },
                  ],
                  location: { file: "UserService.java", line: 1 },
                },
                {
                  id: "UserRepo",
                  name: "UserRepo",
                  kind: "interface",
                  visibility: "public",
                  location: { file: "UserService.java", line: 20 },
                },
              ],
            },
          ],
          externalDependencies: [],
          internalImports: [],
        },
        {
          id: "order-api",
          name: "order-api",
          language: "java",
          path: "/tmp/order-api",
          modules: [
            {
              id: "logging",
              path: "/tmp/order-api/logging",
              name: "logging",
              files: ["Logger.java"],
              exports: [],
              imports: [],
              metadata: {},
              codeElements: [
                {
                  id: "Logger",
                  name: "Logger",
                  kind: "class",
                  visibility: "public",
                  location: { file: "Logger.java", line: 1 },
                },
                {
                  id: "LogConfig",
                  name: "LogConfig",
                  kind: "class",
                  visibility: "public",
                  location: { file: "Logger.java", line: 10 },
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
    const comps: Component[] = [
      {
        id: "users",
        containerId: "user-api",
        name: "users",
        description: "",
        technology: "",
        moduleIds: ["users"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        id: "logging",
        containerId: "order-api",
        name: "logging",
        description: "",
        technology: "",
        moduleIds: ["logging"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const res = buildCodeModel(fixture, comps, baseConfig);
    stderrSpy.mockRestore();

    const reasons = new Set(res.droppedReferences.map((d) => d.reason));
    expect(reasons.has("stdlib")).toBe(true);
    expect(reasons.has("cross-container")).toBe(true);

    for (const drop of res.droppedReferences) {
      expect(drop.sourceId).toBeTruthy();
      expect(drop.targetRaw).toBeTruthy();
      expect(drop.componentId).toBeTruthy();
    }

    // Spot-check the specific drop entries match the fixture.
    const stdlib = res.droppedReferences.find((d) => d.reason === "stdlib")!;
    expect(stdlib).toMatchObject({
      sourceId: "user-api.users.UserService",
      targetRaw: "java.io.Serializable",
      componentId: "users",
    });
    const crossContainer = res.droppedReferences.find(
      (d) => d.reason === "cross-container",
    )!;
    expect(crossContainer).toMatchObject({
      sourceId: "user-api.users.UserService",
      targetRaw: "Logger",
      componentId: "users",
    });
  });

  it("records an ambiguous resolution when resolver picks among multiple candidates", () => {
    // Two Auditable interfaces in the same module create a same-component
    // collision when UserService references `Auditable`. The resolver still
    // picks one (so a CodeRelationship IS created), but the pick is
    // surfaced via ambiguousResolutions — NOT droppedReferences, because
    // no reference was actually dropped.
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
    const res = buildCodeModel(collidingFixture, components, baseConfig);
    stderrSpy.mockRestore();

    // Collisions don't appear in droppedReferences — a relationship was created.
    expect(res.droppedReferences).toEqual([]);
    expect(res.codeRelationships.length).toBeGreaterThan(0);

    expect(res.ambiguousResolutions.length).toBeGreaterThan(0);
    for (const a of res.ambiguousResolutions) {
      expect(a.sourceId).toBeTruthy();
      expect(a.targetRaw).toBe("Auditable");
      expect(a.componentId).toBe("users");
      expect(a.candidateCount).toBeGreaterThan(1);
      expect(a.pickedId).toMatch(/^api\.users\.Auditable-/);
      expect(a.scope).toBe("component");
    }
  });
});
