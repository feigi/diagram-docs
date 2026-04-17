import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { resolveSubmodulePaths } from "../../../src/generator/d2/submodule-scaffold.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import type { Config } from "../../../src/config/schema.js";
import { configSchema } from "../../../src/config/schema.js";

type Container = ArchitectureModel["containers"][number];

const cfg: Config = configSchema.parse({});
const repoRoot = "/repo";

function container(overrides: Partial<Container>): Container {
  return {
    id: "c",
    name: "C",
    technology: "TS",
    description: "",
    applicationId: "my-app",
    ...overrides,
  };
}

describe("resolveSubmodulePaths", () => {
  it("uses container.path when set", () => {
    const c = container({ path: "services/foo" });
    const r = resolveSubmodulePaths(repoRoot, c, cfg);
    expect(r.appPath).toBe("services/foo");
    expect(r.docsDir).toBe("docs");
    expect(r.architectureDir).toBe(
      path.join(repoRoot, "services/foo/docs/architecture"),
    );
  });

  it("falls back to slash-expanded applicationId when path missing", () => {
    const c = container({ applicationId: "team-foo-svc", path: undefined });
    const r = resolveSubmodulePaths(repoRoot, c, cfg);
    expect(r.appPath).toBe("team/foo/svc");
  });

  it("honours per-container docsDir override", () => {
    const overridden: Config = {
      ...cfg,
      submodules: {
        ...cfg.submodules,
        overrides: { "my-app": { docsDir: "documentation" } },
      },
    };
    const c = container({ path: "services/foo" });
    const r = resolveSubmodulePaths(repoRoot, c, overridden);
    expect(r.docsDir).toBe("documentation");
    expect(r.architectureDir).toBe(
      path.join(repoRoot, "services/foo/documentation/architecture"),
    );
  });
});
