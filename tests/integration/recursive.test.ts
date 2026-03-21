import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { processFolder } from "../../src/core/recursive-runner.js";
import { configSchema } from "../../src/config/schema.js";

describe("recursive descent integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-recursive-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates full diagram hierarchy for a Java monorepo", async () => {
    // Create structure:
    // root/
    //   service-a/ (pom.xml, java packages)
    //   service-b/ (pom.xml, java packages)
    for (const svc of ["service-a", "service-b"]) {
      const base = path.join(tmpDir, svc);
      fs.mkdirSync(path.join(base, "src", "main", "java", "com", "example"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(base, "pom.xml"), "<project/>");
      fs.writeFileSync(
        path.join(base, "src", "main", "java", "com", "example", "App.java"),
        [
          "package com.example;",
          "public class App {",
          "  public static void main(String[] args) {}",
          "}",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(
          base,
          "src",
          "main",
          "java",
          "com",
          "example",
          "Service.java",
        ),
        [
          "package com.example;",
          "public class Service {",
          "  private App app;",
          "}",
        ].join("\n"),
      );
    }

    const config = configSchema.parse({ agent: { enabled: false } });
    await processFolder(tmpDir, tmpDir, config);

    // Root: system level — context + container
    const rootDocs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(rootDocs, "_generated", "context.d2"))).toBe(true);
    expect(fs.existsSync(path.join(rootDocs, "_generated", "container.d2"))).toBe(true);

    // Each service: container level — component
    for (const svc of ["service-a", "service-b"]) {
      const svcDocs = path.join(tmpDir, svc, "docs", "architecture");
      expect(fs.existsSync(path.join(svcDocs, "_generated", "component.d2"))).toBe(true);
    }
  });

  it("generates only code diagram for a small library", async () => {
    // Single Python file with a pyproject.toml, no package structure
    fs.writeFileSync(
      path.join(tmpDir, "pyproject.toml"),
      '[project]\nname = "tiny-lib"\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, "lib.py"),
      [
        "class Calculator:",
        "    def add(self, a, b):",
        "        return a + b",
        "",
        "class AdvancedCalculator(Calculator):",
        "    def multiply(self, a, b):",
        "        return a * b",
      ].join("\n"),
    );

    const config = configSchema.parse({ agent: { enabled: false } });
    await processFolder(tmpDir, tmpDir, config);

    const docs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(docs, "_generated", "code.d2"))).toBe(true);
    // Should NOT have context or container diagrams
    expect(fs.existsSync(path.join(docs, "_generated", "context.d2"))).toBe(false);
    expect(fs.existsSync(path.join(docs, "_generated", "container.d2"))).toBe(false);
  });

  it("generates user-facing scaffold files alongside generated ones", async () => {
    // Single Java app
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src", "main", "java", "com", "example"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main", "java", "com", "example", "App.java"),
      "package com.example;\npublic class App {}",
    );

    const config = configSchema.parse({ agent: { enabled: false } });
    await processFolder(tmpDir, tmpDir, config);

    const docs = path.join(tmpDir, "docs", "architecture");
    // Should have user-facing D2 that imports generated files
    const userFiles = fs.readdirSync(docs).filter(f => f.endsWith(".d2") && f !== "styles.d2");
    expect(userFiles.length).toBeGreaterThan(0);

    // Check styles.d2 was created
    expect(fs.existsSync(path.join(docs, "styles.d2"))).toBe(true);
  });
});
