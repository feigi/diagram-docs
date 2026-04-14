import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractJavaCode } from "../../src/analyzers/java/code.js";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/code-level/java/UserService.java",
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
