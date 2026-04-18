import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractTypeScriptCode } from "../../src/analyzers/typescript/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/typescript/user.ts",
);

describe("typescript code extraction", () => {
  it("extracts classes, interfaces, type aliases, and module-level functions", async () => {
    const els = await extractTypeScriptCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const names = els.map((e) => e.name).sort();
    expect(names).toEqual([
      "Auditable",
      "Id",
      "User",
      "UserService",
      "formatUser",
    ]);
  });

  it("tags kinds correctly", async () => {
    const els = await extractTypeScriptCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const kinds = Object.fromEntries(els.map((e) => [e.name, e.kind]));
    expect(kinds).toMatchObject({
      Auditable: "interface",
      Id: "type",
      User: "class",
      UserService: "class",
      formatUser: "function",
    });
  });

  it("captures implements edges", async () => {
    const els = await extractTypeScriptCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([{ targetName: "Auditable", kind: "implements" }]),
    );
  });

  it("captures constructor shorthand parameters as fields", async () => {
    const els = await extractTypeScriptCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    // `User` class declares `constructor(private readonly name: string)` —
    // the `name` parameter is a TS shorthand that declares a private field.
    const user = els.find((e) => e.name === "User")!;
    expect(user.members).toBeDefined();
    const nameField = user.members!.find(
      (m) => m.name === "name" && m.kind === "field",
    );
    expect(nameField).toBeDefined();
    expect(nameField).toMatchObject({
      name: "name",
      kind: "field",
      visibility: "private",
    });
    expect(nameField!.signature).toContain("name");
    expect(nameField!.signature).toContain("string");

    // The constructor itself should still be recorded as a method, so we
    // don't lose the method shape when shorthand is present.
    const ctor = user.members!.find((m) => m.name === "constructor");
    expect(ctor).toBeDefined();
    expect(ctor!.kind).toBe("method");
  });

  it("returns gracefully on malformed source", async () => {
    const broken = `export class Broken { method( {`;
    const elements = await extractTypeScriptCode("/tmp/Broken.ts", broken);
    expect(Array.isArray(elements)).toBe(true);
  });
});

describe("typescript code extraction: uses references", () => {
  it("captures uses edges from field types and method signatures", async () => {
    const els = await extractTypeScriptCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([{ targetName: "User", kind: "uses" }]),
    );
  });

  it("drops TS builtin/primitive names from uses", async () => {
    const els = await extractTypeScriptCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const svc = els.find((e) => e.name === "UserService")!;
    const usesNames = (svc.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesNames).not.toContain("string");
    expect(usesNames).not.toContain("undefined");
  });

  it("does not duplicate an implements target as uses", async () => {
    const src = `interface Foo {} class C implements Foo { f: Foo; }`;
    const els = await extractTypeScriptCode("c.ts", src);
    const c = els.find((e) => e.name === "C")!;
    const fooRefs = (c.references ?? []).filter((r) => r.targetName === "Foo");
    expect(fooRefs.map((r) => r.kind)).toEqual(["implements"]);
  });

  it("unwraps array, union, and generic types in field signatures", async () => {
    const src = `
      class A {}
      class B {}
      class C {}
      class Holder {
        a: A[];
        b: B | null;
        c: Array<C>;
      }
    `;
    const els = await extractTypeScriptCode("holder.ts", src);
    const holder = els.find((e) => e.name === "Holder")!;
    const usesNames = (holder.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName)
      .sort();
    expect(usesNames).toEqual(["A", "B", "C"]);
  });
});
