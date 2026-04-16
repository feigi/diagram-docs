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
    const outputDir = tmp;
    const compDir = path.join(tmp, "containers", "api", "components", "users");
    const target = path.join(compDir, "c4-code.d2");
    scaffoldCodeFile(target, {
      containerName: "api",
      componentName: "users",
      outputDir,
    });
    expect(fs.existsSync(target)).toBe(true);
    const content = fs.readFileSync(target, "utf-8");
    expect(content).toContain("@_generated/c4-code.d2");
    expect(content).toContain("users");
    expect(content).toContain("@../../../../styles.d2");
  });

  it("preserves user edits on subsequent runs", () => {
    const outputDir = tmp;
    const compDir = path.join(tmp, "containers", "api", "components", "users");
    const target = path.join(compDir, "c4-code.d2");
    scaffoldCodeFile(target, {
      containerName: "api",
      componentName: "users",
      outputDir,
    });
    const customized = fs.readFileSync(target, "utf-8") + "\n# my note\n";
    fs.writeFileSync(target, customized);
    scaffoldCodeFile(target, {
      containerName: "api",
      componentName: "users",
      outputDir,
    });
    const after = fs.readFileSync(target, "utf-8");
    expect(after).toContain("# my note");
  });

  it("computes correct relative styles path for non-standard depth", () => {
    const outputDir = tmp;
    const target = path.join(tmp, "deep", "nested", "c4-code.d2");
    scaffoldCodeFile(target, {
      containerName: "x",
      componentName: "y",
      outputDir,
    });
    const content = fs.readFileSync(target, "utf-8");
    expect(content).toContain("@../../styles.d2");
  });
});
