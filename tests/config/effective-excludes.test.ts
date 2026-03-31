import { describe, it, expect } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { configSchema } from "../../src/config/schema.js";
import { computeEffectiveExcludes } from "../../src/config/loader.js";
import { getRegistry } from "../../src/analyzers/registry.js";
import type { LanguageAnalyzer } from "../../src/analyzers/types.js";

describe("computeEffectiveExcludes", () => {
  const baseConfig: Config = configSchema.parse({});

  it("includes schema defaults when no overrides", () => {
    const result = computeEffectiveExcludes(baseConfig, []);
    expect(result).toContain("**/*test*/**");
    expect(result).toContain("**/*test*");
    expect(result).toContain("**/build/**");
  });

  it("merges analyzer defaultExcludes into config excludes", () => {
    const fakeAnalyzer: LanguageAnalyzer = {
      id: "fake",
      name: "Fake",
      buildFilePatterns: [],
      defaultExcludes: ["**/vendor/**", "**/.cache/**"],
      async analyze() {
        throw new Error("not implemented");
      },
    };

    const result = computeEffectiveExcludes(baseConfig, [fakeAnalyzer]);
    expect(result).toContain("**/vendor/**");
    expect(result).toContain("**/.cache/**");
    // schema defaults still present
    expect(result).toContain("**/*test*/**");
  });

  it("deduplicates patterns from config and analyzers", () => {
    const config: Config = configSchema.parse({
      scan: { exclude: ["**/*test*/**", "**/build/**", "**/custom/**"] },
    });
    const fakeAnalyzer: LanguageAnalyzer = {
      id: "fake",
      name: "Fake",
      buildFilePatterns: [],
      defaultExcludes: ["**/build/**"], // already in config
      async analyze() {
        throw new Error("not implemented");
      },
    };

    const result = computeEffectiveExcludes(config, [fakeAnalyzer]);
    const buildCount = result.filter((p) => p === "**/build/**").length;
    expect(buildCount).toBe(1);
  });

  it("removes forceInclude patterns from effective excludes", () => {
    const config: Config = configSchema.parse({
      scan: { forceInclude: ["**/build/**"] },
    });

    const result = computeEffectiveExcludes(config, []);
    expect(result).not.toContain("**/build/**");
    // other defaults still present
    expect(result).toContain("**/*test*/**");
  });

  it("forceInclude overrides analyzer defaults too", () => {
    const config: Config = configSchema.parse({
      scan: { forceInclude: ["**/venv/**"] },
    });
    const fakeAnalyzer: LanguageAnalyzer = {
      id: "fake",
      name: "Fake",
      buildFilePatterns: [],
      defaultExcludes: ["**/venv/**"],
      async analyze() {
        throw new Error("not implemented");
      },
    };

    const result = computeEffectiveExcludes(config, [fakeAnalyzer]);
    expect(result).not.toContain("**/venv/**");
  });

  it("handles analyzers with no defaultExcludes", () => {
    const fakeAnalyzer: LanguageAnalyzer = {
      id: "fake",
      name: "Fake",
      buildFilePatterns: [],
      // no defaultExcludes
      async analyze() {
        throw new Error("not implemented");
      },
    };

    const result = computeEffectiveExcludes(baseConfig, [fakeAnalyzer]);
    expect(result).toEqual(computeEffectiveExcludes(baseConfig, []));
  });
});

describe("analyzer defaultExcludes", () => {
  const registry = getRegistry();

  it("all analyzers have a defaultExcludes property", () => {
    for (const analyzer of registry) {
      expect(analyzer.defaultExcludes).toBeDefined();
      expect(Array.isArray(analyzer.defaultExcludes)).toBe(true);
    }
  });

  it("python analyzer includes venv exclusions", () => {
    const python = registry.find((a) => a.id === "python")!;
    expect(python.defaultExcludes).toContain("**/venv/**");
    expect(python.defaultExcludes).toContain("**/.venv/**");
    expect(python.defaultExcludes).toContain("**/__pycache__/**");
  });

  it("java analyzer includes target exclusion", () => {
    const java = registry.find((a) => a.id === "java")!;
    expect(java.defaultExcludes).toContain("**/target/**");
    expect(java.defaultExcludes).toContain("**/.gradle/**");
  });

  it("typescript analyzer includes node_modules exclusion", () => {
    const ts = registry.find((a) => a.id === "typescript")!;
    expect(ts.defaultExcludes).toContain("**/node_modules/**");
    expect(ts.defaultExcludes).toContain("**/dist/**");
  });

  it("full registry effective excludes includes all language patterns", () => {
    const config: Config = configSchema.parse({});
    const result = computeEffectiveExcludes(config, registry);

    // Universal
    expect(result).toContain("**/*test*/**");
    expect(result).toContain("**/*.worktree/**");
    expect(result).toContain("**/.worktrees/**");
    // Python
    expect(result).toContain("**/venv/**");
    // Java
    expect(result).toContain("**/target/**");
    // TypeScript
    expect(result).toContain("**/node_modules/**");
  });
});

describe("scaffolded config has no scan.exclude", () => {
  it("writeDefaultConfig does not write scan.exclude to YAML", async () => {
    const { writeDefaultConfig } = await import("../../src/config/loader.js");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { parse: parseYaml } = await import("yaml");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-test-"));
    try {
      const { configPath } = writeDefaultConfig(tmpDir);
      const raw = parseYaml(fs.readFileSync(configPath, "utf-8"));
      expect(raw.scan.exclude).toBeUndefined();
      expect(raw.scan.include).toEqual(["**"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
