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
      expect.arrayContaining([{ targetName: "Auditable", kind: "implements" }]),
    );
    const user = els.find((e) => e.name === "User")!;
    expect(user.references).toEqual(
      expect.arrayContaining([
        { targetName: "Serializable", kind: "implements" },
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
    expect(foo.references).toEqual([
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
    expect(foo.references).toEqual([
      { targetName: "ArrayList", kind: "extends" },
      { targetName: "Comparable", kind: "implements" },
      { targetName: "Serializable", kind: "implements" },
    ]);
  });

  it("captures multiple parents for an interface extends list", async () => {
    const source = `package p; interface Super extends A, B {}`;
    const els = await extractJavaCode("Super.java", source);
    const sup = els.find((e) => e.name === "Super")!;
    expect(sup.references).toEqual([
      { targetName: "A", kind: "extends" },
      { targetName: "B", kind: "extends" },
    ]);
  });

  it("extracts multi-interface and generic parents from MultipleInterfaces fixture", async () => {
    const source = fs.readFileSync(MULTI_FIXTURE, "utf-8");
    const els = await extractJavaCode(MULTI_FIXTURE, source);

    const combined = els.find((e) => e.name === "Combined")!;
    expect(combined.references).toEqual([
      { targetName: "Alpha", kind: "extends" },
      { targetName: "Beta", kind: "extends" },
      { targetName: "Gamma", kind: "extends" },
    ]);

    const bag = els.find((e) => e.name === "Bag")!;
    expect(bag.references).toEqual([
      { targetName: "ArrayList", kind: "extends" },
      { targetName: "Alpha", kind: "implements" },
      { targetName: "Comparable", kind: "implements" },
      { targetName: "Beta", kind: "implements" },
    ]);
  });

  it("returns gracefully on malformed source (tree-sitter error-recovers)", async () => {
    const broken = `package com.example; public class Broken { void oops( }`;
    const elements = await extractJavaCode("/tmp/Broken.java", broken);
    expect(Array.isArray(elements)).toBe(true);
  });
});
