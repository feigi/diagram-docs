import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("processFolder", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a monorepo root as system and generates context + container diagrams", async () => {
    for (const svc of ["service-a", "service-b"]) {
      const svcDir = path.join(tmpDir, svc);
      fs.mkdirSync(path.join(svcDir, "src", "main", "java"), { recursive: true });
      fs.writeFileSync(path.join(svcDir, "pom.xml"), "<project/>");
      fs.writeFileSync(
        path.join(svcDir, "src", "main", "java", "App.java"),
        "public class App {}",
      );
    }

    const { processFolder } = await import("../../src/core/recursive-runner.js");
    const { configSchema } = await import("../../src/config/schema.js");
    const config = configSchema.parse({ agent: { enabled: false } });

    await processFolder(tmpDir, tmpDir, config);

    const rootDocs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(rootDocs, "_generated", "context.d2"))).toBe(true);
    expect(fs.existsSync(path.join(rootDocs, "_generated", "container.d2"))).toBe(true);
  });

  it("classifies a single-app folder as container and generates component diagram", async () => {
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src", "main", "java", "com", "example"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main", "java", "com", "example", "App.java"),
      "public class App {}",
    );

    const { processFolder } = await import("../../src/core/recursive-runner.js");
    const { configSchema } = await import("../../src/config/schema.js");
    const config = configSchema.parse({ agent: { enabled: false } });

    await processFolder(tmpDir, tmpDir, config);

    const docs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(path.join(docs, "_generated", "component.d2"))).toBe(true);
  });

  it("respects config overrides for role", async () => {
    for (const svc of ["svc-a", "svc-b"]) {
      const svcDir = path.join(tmpDir, svc);
      fs.mkdirSync(svcDir, { recursive: true });
      fs.writeFileSync(path.join(svcDir, "pom.xml"), "<project/>");
      fs.writeFileSync(path.join(svcDir, "App.java"), "public class App {}");
    }

    const { processFolder } = await import("../../src/core/recursive-runner.js");
    const { configSchema } = await import("../../src/config/schema.js");
    const config = configSchema.parse({
      agent: { enabled: false },
      overrides: { ".": { role: "skip" } },
    });

    await processFolder(tmpDir, tmpDir, config);

    const docs = path.join(tmpDir, "docs", "architecture");
    expect(fs.existsSync(docs)).toBe(false);
  });
});
