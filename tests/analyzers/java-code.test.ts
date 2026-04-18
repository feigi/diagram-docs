import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractJavaCode } from "../../src/analyzers/java/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/java/UserService.java",
);

const MULTI_FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/java/MultipleInterfaces.java",
);

describe("java code extraction", () => {
  it("extracts classes, interfaces, and enums", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const elements = await extractJavaCode(FIXTURE, source);
    const names = elements.map((e) => e.name).sort();
    expect(names).toEqual(["Auditable", "Role", "User", "UserService"]);
  });

  it("marks interfaces and enums with correct kind", () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    return extractJavaCode(FIXTURE, source).then((els) => {
      const kinds = Object.fromEntries(els.map((e) => [e.name, e.kind]));
      expect(kinds["Auditable"]).toBe("interface");
      expect(kinds["User"]).toBe("class");
      expect(kinds["Role"]).toBe("enum");
    });
  });

  it("captures implements/extends references", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetName: "Auditable",
          kind: "implements",
        }),
      ]),
    );
    const user = els.find((e) => e.name === "User")!;
    expect(user.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetName: "Serializable",
          kind: "implements",
        }),
      ]),
    );
  });

  it("records public methods and fields on UserService", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    const memberNames = (svc.members ?? []).map((m) => m.name).sort();
    expect(memberNames).toEqual(
      expect.arrayContaining(["findByName", "getAuditLog"]),
    );
  });
});

describe("java code extraction: multi-interface and generic parents", () => {
  it("captures all entries in an implements list in order", async () => {
    const source = `package p; class Foo implements A, B, C {}`;
    const els = await extractJavaCode("Foo.java", source);
    const foo = els.find((e) => e.name === "Foo")!;
    expect(
      foo.references?.map(({ targetName, kind }) => ({ targetName, kind })),
    ).toEqual([
      { targetName: "A", kind: "implements" },
      { targetName: "B", kind: "implements" },
      { targetName: "C", kind: "implements" },
    ]);
  });

  it("strips generic parameters from extends and implements targets", async () => {
    const source = `package p;
import java.util.ArrayList;
import java.io.Serializable;
class Foo extends ArrayList<String> implements Comparable<Foo>, Serializable {}`;
    const els = await extractJavaCode("Foo.java", source);
    const foo = els.find((e) => e.name === "Foo")!;
    expect(
      foo.references?.map(({ targetName, kind }) => ({ targetName, kind })),
    ).toEqual([
      { targetName: "ArrayList", kind: "extends" },
      { targetName: "Comparable", kind: "implements" },
      { targetName: "Serializable", kind: "implements" },
    ]);
  });

  it("captures multiple parents for an interface extends list", async () => {
    const source = `package p; interface Super extends A, B {}`;
    const els = await extractJavaCode("Super.java", source);
    const sup = els.find((e) => e.name === "Super")!;
    expect(
      sup.references?.map(({ targetName, kind }) => ({ targetName, kind })),
    ).toEqual([
      { targetName: "A", kind: "extends" },
      { targetName: "B", kind: "extends" },
    ]);
  });

  it("extracts multi-interface and generic parents from MultipleInterfaces fixture", async () => {
    const source = fs.readFileSync(MULTI_FIXTURE, "utf-8");
    const els = await extractJavaCode(MULTI_FIXTURE, source);

    const combined = els.find((e) => e.name === "Combined")!;
    expect(
      combined.references?.map(({ targetName, kind }) => ({
        targetName,
        kind,
      })),
    ).toEqual([
      { targetName: "Alpha", kind: "extends" },
      { targetName: "Beta", kind: "extends" },
      { targetName: "Gamma", kind: "extends" },
    ]);

    const bag = els.find((e) => e.name === "Bag")!;
    expect(
      bag.references?.map(({ targetName, kind }) => ({ targetName, kind })),
    ).toEqual([
      { targetName: "ArrayList", kind: "extends" },
      { targetName: "Alpha", kind: "implements" },
      { targetName: "Comparable", kind: "implements" },
      { targetName: "Beta", kind: "implements" },
    ]);
  });

  it("captures nested classes at all depths (tree-sitter query matches anywhere)", async () => {
    const source = `package p;
class Outer {
  static class Inner {}
  class InnerTwo {}
}`;
    const els = await extractJavaCode("Outer.java", source);
    const names = els.map((e) => e.name).sort();
    // All three declarations are captured; collision handling downstream
    // deals with duplicate bare names across modules.
    expect(names).toEqual(["Inner", "InnerTwo", "Outer"]);
  });

  it("returns gracefully on malformed source (tree-sitter error-recovers)", async () => {
    const broken = `package com.example; public class Broken { void oops( }`;
    const elements = await extractJavaCode("/tmp/Broken.java", broken);
    expect(Array.isArray(elements)).toBe(true);
  });
});

describe("java code extraction: qualified-name resolution", () => {
  it("emits qualifiedName for top-level types using the package declaration", async () => {
    const source = `package com.bmw.api; public class RouteSearchApi {}`;
    const els = await extractJavaCode("RouteSearchApi.java", source);
    expect(els[0].qualifiedName).toBe("com.bmw.api.RouteSearchApi");
  });

  it("omits qualifiedName when no package declaration is present (default package)", async () => {
    const source = `public class Loose {}`;
    const els = await extractJavaCode("Loose.java", source);
    expect(els[0].qualifiedName).toBeUndefined();
  });

  it("resolves implements-target FQN via single-type imports", async () => {
    const source = `package com.bmw.app;
import com.bmw.api.v7.RouteSearchApi;
public class RouteSearchControllerV7 implements RouteSearchApi {}`;
    const els = await extractJavaCode("RouteSearchControllerV7.java", source);
    const ctrl = els[0];
    const ref = ctrl.references!.find((r) => r.targetName === "RouteSearchApi");
    expect(ref?.targetQualifiedName).toBe("com.bmw.api.v7.RouteSearchApi");
  });

  it("falls back to same-package FQN when target is unimported", async () => {
    const source = `package com.bmw.app;
public class Foo extends Bar {}`;
    const els = await extractJavaCode("Foo.java", source);
    const ref = els[0].references!.find((r) => r.targetName === "Bar");
    expect(ref?.targetQualifiedName).toBe("com.bmw.app.Bar");
  });

  it("ignores wildcard imports (cannot map a single FQN)", async () => {
    const source = `package com.bmw.app;
import com.bmw.api.v7.*;
public class Foo implements RouteSearchApi {}`;
    const els = await extractJavaCode("Foo.java", source);
    const ref = els[0].references!.find(
      (r) => r.targetName === "RouteSearchApi",
    );
    // Wildcard skipped → falls back to same-package guess.
    expect(ref?.targetQualifiedName).toBe("com.bmw.app.RouteSearchApi");
  });

  it("ignores static imports", async () => {
    const source = `package com.bmw.app;
import static java.util.Collections.emptyList;
public class Foo {}`;
    const els = await extractJavaCode("Foo.java", source);
    expect(els[0].qualifiedName).toBe("com.bmw.app.Foo");
  });
});

describe("java code extraction: uses references", () => {
  it("captures uses edges from fields and method signatures", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    const usesTargets = (svc.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesTargets).toContain("User");
  });

  it("filters java.lang builtins from uses (String, Object, ...)", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    const usesTargets = (svc.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesTargets).not.toContain("String");
    expect(usesTargets).not.toContain("Object");
  });

  it("populates targetQualifiedName for resolved uses via imports", async () => {
    const source = fs.readFileSync(FIXTURE, "utf-8");
    const els = await extractJavaCode(FIXTURE, source);
    const svc = els.find((e) => e.name === "UserService")!;
    const userUse = (svc.references ?? []).find(
      (r) => r.kind === "uses" && r.targetName === "User",
    );
    expect(userUse?.targetQualifiedName).toBe("com.example.users.User");
  });

  it("does not emit the same target as both implements/extends and uses", async () => {
    const source = `package p;
interface Foo {}
class C implements Foo {
  Foo inner;
  Foo make() { return inner; }
}`;
    const els = await extractJavaCode("C.java", source);
    const c = els.find((e) => e.name === "C")!;
    const fooRefs = (c.references ?? []).filter((r) => r.targetName === "Foo");
    expect(fooRefs.map((r) => r.kind)).toEqual(["implements"]);
  });

  it("unwraps generic type params for uses targets", async () => {
    const source = `package p;
import java.util.List;
class Outer {
  List<Inner> items;
}
class Inner {}`;
    const els = await extractJavaCode("Outer.java", source);
    const outer = els.find((e) => e.name === "Outer")!;
    const usesTargets = (outer.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesTargets).toContain("Inner");
  });
});
