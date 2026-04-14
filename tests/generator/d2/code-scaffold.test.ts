import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scaffoldCodeFile } from "../../../src/generator/d2/code-scaffold.js";

describe("scaffoldCodeFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-test-"));
  });

  it("creates the file on first run with import directives", () => {
    const target = path.join(tmp, "c4-code.d2");
    scaffoldCodeFile(target, { containerName: "api", componentName: "users" });
    expect(fs.existsSync(target)).toBe(true);
    const content = fs.readFileSync(target, "utf-8");
    expect(content).toContain("@_generated/c4-code.d2");
    expect(content).toContain("users");
  });

  it("preserves user edits on subsequent runs", () => {
    const target = path.join(tmp, "c4-code.d2");
    scaffoldCodeFile(target, { containerName: "api", componentName: "users" });
    const customized = fs.readFileSync(target, "utf-8") + "\n# my note\n";
    fs.writeFileSync(target, customized);
    scaffoldCodeFile(target, { containerName: "api", componentName: "users" });
    const after = fs.readFileSync(target, "utf-8");
    expect(after).toContain("# my note");
  });
});
