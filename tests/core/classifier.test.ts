import { describe, it, expect } from "vitest";
import { collectSignals, inferRole } from "../../src/core/classifier.js";
import type { FolderSignals } from "../../src/core/classifier.js";

describe("inferRole", () => {
  it("classifies folder with multiple children having build files as system", () => {
    const signals: FolderSignals = {
      buildFiles: [],
      childrenWithBuildFiles: 3,
      infraFiles: ["docker-compose.yml"],
      sourceFileCount: 0,
      sourceLanguages: [],
      hasPackageStructure: false,
      depth: 0,
      childFolderNames: ["order-service", "user-service", "gateway"],
      readmeSnippet: null,
      hasSourceFiles: false,
    };
    expect(inferRole(signals)).toBe("system");
  });

  it("classifies folder with build file and package structure as container", () => {
    const signals: FolderSignals = {
      buildFiles: ["pom.xml"],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 25,
      sourceLanguages: ["java"],
      hasPackageStructure: true,
      depth: 1,
      childFolderNames: ["src", "test"],
      readmeSnippet: null,
      hasSourceFiles: true,
    };
    expect(inferRole(signals)).toBe("container");
  });

  it("classifies folder with build file but no package structure as code-only", () => {
    const signals: FolderSignals = {
      buildFiles: ["pyproject.toml"],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 3,
      sourceLanguages: ["python"],
      hasPackageStructure: false,
      depth: 1,
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: true,
    };
    expect(inferRole(signals)).toBe("code-only");
  });

  it("classifies package directory with source files as component", () => {
    const signals: FolderSignals = {
      buildFiles: [],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 5,
      sourceLanguages: ["python"],
      hasPackageStructure: false,
      depth: 3,
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: true,
      isPackageDir: true,
    };
    expect(inferRole(signals)).toBe("component");
  });

  it("classifies empty folder as skip", () => {
    const signals: FolderSignals = {
      buildFiles: [],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 0,
      sourceLanguages: [],
      hasPackageStructure: false,
      depth: 2,
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: false,
    };
    expect(inferRole(signals)).toBe("skip");
  });
});

describe("collectSignals", () => {
  // Test with real filesystem using temp directories
  it("detects build files and source files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "classifier-test-"));
    fs.writeFileSync(path.join(tmpDir, "pom.xml"), "<project/>");
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "App.java"), "class App {}");

    const signals = await collectSignals(tmpDir, tmpDir);
    expect(signals.buildFiles).toContain("pom.xml");
    expect(signals.hasSourceFiles).toBe(true);
    expect(signals.sourceLanguages).toContain("java");

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("counts children with build files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "classifier-test-"));
    for (const svc of ["svc-a", "svc-b", "svc-c"]) {
      fs.mkdirSync(path.join(tmpDir, svc));
      fs.writeFileSync(path.join(tmpDir, svc, "pom.xml"), "<project/>");
    }

    const signals = await collectSignals(tmpDir, tmpDir);
    expect(signals.childrenWithBuildFiles).toBe(3);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
