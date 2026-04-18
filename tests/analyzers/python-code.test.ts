import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractPythonCode } from "../../src/analyzers/python/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/python/user_service.py",
);

describe("python code extraction", () => {
  it("extracts classes and module-level functions", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const names = els.map((e) => e.name).sort();
    expect(names).toEqual([
      "User",
      "UserService",
      "_internal_helper",
      "format_user",
    ]);
  });

  it("captures base-class references as extends", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const svc = els.find((e) => e.name === "UserService")!;
    expect(svc.references).toEqual(
      expect.arrayContaining([{ targetName: "User", kind: "extends" }]),
    );
  });

  it("marks leading-underscore names as private", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const helper = els.find((e) => e.name === "_internal_helper")!;
    expect(helper.visibility).toBe("private");
  });

  it("captures typed method signatures on classes", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const user = els.find((e) => e.name === "User")!;
    const memberNames = (user.members ?? []).map((m) => m.name).sort();
    expect(memberNames).toEqual(
      expect.arrayContaining(["__init__", "get_name"]),
    );
  });

  it("captures decorated methods (@property, @classmethod, @staticmethod)", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const user = els.find((e) => e.name === "User")!;
    const memberNames = (user.members ?? []).map((m) => m.name).sort();
    expect(memberNames).toEqual(
      expect.arrayContaining(["anonymous", "display_name", "is_valid"]),
    );
  });

  it("returns gracefully on malformed source", async () => {
    const broken = `class Broken:\n    def oops(self\n`;
    const elements = await extractPythonCode("/tmp/broken.py", broken);
    expect(Array.isArray(elements)).toBe(true);
  });
});

describe("python code extraction: uses references", () => {
  it("captures uses edges from typed method signatures", async () => {
    const src = `class User: ...
class UserRepo:
    def find(self, name: str) -> User:
        return User()
`;
    const els = await extractPythonCode("repo.py", src);
    const repo = els.find((e) => e.name === "UserRepo")!;
    const usesNames = (repo.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesNames).toContain("User");
  });

  it("filters Python builtins and typing generics from uses", async () => {
    const els = await extractPythonCode(
      FIXTURE,
      fs.readFileSync(FIXTURE, "utf-8"),
    );
    const svc = els.find((e) => e.name === "UserService")!;
    const usesNames = (svc.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesNames).not.toContain("str");
    expect(usesNames).not.toContain("List");
  });

  it("does not emit a base class as uses when it appears only in signatures too", async () => {
    const src = `class Base: ...
class Derived(Base):
    def make(self, b: Base) -> Base:
        return b
`;
    const els = await extractPythonCode("x.py", src);
    const derived = els.find((e) => e.name === "Derived")!;
    const baseRefs = (derived.references ?? []).filter(
      (r) => r.targetName === "Base",
    );
    expect(baseRefs.map((r) => r.kind)).toEqual(["extends"]);
  });

  it("unwraps List[X] subscripts to the element type", async () => {
    const src = `from typing import List
class Item: ...
class Bag:
    def all(self) -> List[Item]:
        return []
`;
    const els = await extractPythonCode("bag.py", src);
    const bag = els.find((e) => e.name === "Bag")!;
    const usesNames = (bag.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesNames).toContain("Item");
    expect(usesNames).not.toContain("List");
  });
});
