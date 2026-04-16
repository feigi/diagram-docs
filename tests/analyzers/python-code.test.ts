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

  it("returns gracefully on malformed source", async () => {
    const broken = `class Broken:\n    def oops(self\n`;
    const elements = await extractPythonCode("/tmp/broken.py", broken);
    expect(Array.isArray(elements)).toBe(true);
  });
});
