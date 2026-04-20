import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("returns a ProcessResult with d2Files and failure counters", async () => {
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src", "main", "java"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main", "java", "App.java"),
      "public class App {}",
    );

    const { processFolder, totalFailures } = await import("../../src/core/recursive-runner.js");
    const { configSchema } = await import("../../src/config/schema.js");
    const config = configSchema.parse({ agent: { enabled: false } });

    const result = await processFolder(tmpDir, tmpDir, config);

    expect(Array.isArray(result.d2Files)).toBe(true);
    expect(result.failures).toMatchObject({
      llm: 0,
      analyzer: 0,
      generation: 0,
      scaffold: 0,
    });
    expect(totalFailures(result.failures)).toBe(0);
  });

  it("rethrows EMFILE from analyzer.analyze (resource exhaustion propagates)", async () => {
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src", "main", "java"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main", "java", "App.java"),
      "public class App {}",
    );

    const { processFolder } = await import("../../src/core/recursive-runner.js");
    const { configSchema } = await import("../../src/config/schema.js");
    const registry = await import("../../src/analyzers/registry.js");
    const config = configSchema.parse({ agent: { enabled: false } });

    const getSpy = vi.spyOn(registry, "getAnalyzer").mockImplementation(() => {
      return {
        languageId: "java",
        detectBuildFile: () => null,
        analyze: () => {
          const err = new Error("EMFILE: too many open files") as NodeJS.ErrnoException;
          err.code = "EMFILE";
          throw err;
        },
      } as unknown as ReturnType<typeof registry.getAnalyzer>;
    });

    await expect(processFolder(tmpDir, tmpDir, config)).rejects.toThrow(/EMFILE/);
    getSpy.mockRestore();
  });

  it("rethrows TypeError (programming bug) instead of swallowing in generation catch", async () => {
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src", "main", "java"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "main", "java", "App.java"),
      "public class App {}",
    );

    const { processFolder } = await import("../../src/core/recursive-runner.js");
    const { configSchema } = await import("../../src/config/schema.js");
    const registry = await import("../../src/analyzers/registry.js");
    const config = configSchema.parse({ agent: { enabled: false } });

    const getSpy = vi.spyOn(registry, "getAnalyzer").mockImplementation(() => {
      return {
        languageId: "java",
        detectBuildFile: () => null,
        analyze: () => {
          throw new TypeError("deliberate programming bug");
        },
      } as unknown as ReturnType<typeof registry.getAnalyzer>;
    });

    await expect(processFolder(tmpDir, tmpDir, config)).rejects.toThrow(TypeError);
    getSpy.mockRestore();
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
