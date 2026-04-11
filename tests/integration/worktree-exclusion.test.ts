import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { configSchema } from "../../src/config/schema.js";
import { buildEffectiveConfig } from "../../src/config/loader.js";
import { discoverApplications } from "../../src/core/discovery.js";

describe("worktree directories are excluded from discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-worktree-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProject(relPath: string, buildFile: string, contents = "") {
    const abs = path.join(tmpDir, relPath);
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, buildFile), contents, "utf-8");
  }

  it("ignores projects inside .worktrees/", async () => {
    writeProject("services/main", "build.gradle", "// real project");
    writeProject(
      ".worktrees/feature-branch/services/main",
      "build.gradle",
      "// should be ignored",
    );

    const config = buildEffectiveConfig(configSchema.parse({}));
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path).sort();
    expect(paths).toContain("services/main");
    expect(paths).not.toContain(".worktrees/feature-branch/services/main");
    expect(paths.some((p) => p.startsWith(".worktrees/"))).toBe(false);
  });

  it("ignores projects inside *.worktree/", async () => {
    writeProject("services/api", "pom.xml", "<project/>");
    writeProject("tmp.worktree/services/api", "pom.xml", "<project/>");

    const config = buildEffectiveConfig(configSchema.parse({}));
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path).sort();
    expect(paths).toContain("services/api");
    expect(paths).not.toContain("tmp.worktree/services/api");
  });

  it("ignores projects inside *.worktrees/", async () => {
    writeProject("services/worker", "tsconfig.json", "{}");
    writeProject("feat.worktrees/services/worker", "tsconfig.json", "{}");

    const config = buildEffectiveConfig(configSchema.parse({}));
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path).sort();
    expect(paths).toContain("services/worker");
    expect(paths).not.toContain("feat.worktrees/services/worker");
  });

  it("forceInclude overrides worktree exclusion", async () => {
    writeProject(
      "feat.worktrees/feature/services/main",
      "build.gradle",
      "// explicitly kept",
    );

    // Sanity: without forceInclude, the schema default **/*.worktrees/**
    // excludes this path.
    const defaultConfig = buildEffectiveConfig(configSchema.parse({}));
    const defaultDiscovered = await discoverApplications(tmpDir, defaultConfig);
    expect(defaultDiscovered.map((d) => d.path)).not.toContain(
      "feat.worktrees/feature/services/main",
    );

    const config = buildEffectiveConfig(
      configSchema.parse({
        scan: { forceInclude: ["**/*.worktrees/**"] },
      }),
    );
    const discovered = await discoverApplications(tmpDir, config);

    const paths = discovered.map((d) => d.path);
    expect(paths).toContain("feat.worktrees/feature/services/main");
  });
});
