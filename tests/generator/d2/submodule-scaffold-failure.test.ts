import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSubmoduleDocs } from "../../../src/generator/d2/submodule-scaffold.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import { configSchema } from "../../../src/config/schema.js";

// Force scaffoldCodeFile to throw so we can verify the submodule path
// bumps its scaffoldFailed counter — mirrors the root-mode test in
// code-level-scaffold-failure.test.ts.
vi.mock("../../../src/generator/d2/code-scaffold.js", () => ({
  scaffoldCodeFile: vi.fn(() => {
    const e = new Error(
      "EISDIR: illegal operation on a directory",
    ) as NodeJS.ErrnoException;
    e.code = "EISDIR";
    throw e;
  }),
}));

describe("generateSubmoduleDocs — L4 scaffold failures are counted", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-submodule-scaffold-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("increments scaffoldFailed when scaffoldCodeFile throws in submodule mode", () => {
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "c1",
          applicationId: "services-c1",
          name: "C1",
          description: "",
          technology: "",
          path: "services/c1",
        },
      ],
      components: [
        {
          id: "comp1",
          containerId: "c1",
          name: "Comp1",
          description: "",
          technology: "",
          moduleIds: ["m1"],
        },
      ],
      relationships: [],
      codeElements: [
        {
          id: "e1",
          componentId: "comp1",
          containerId: "c1",
          kind: "class",
          name: "E1",
        },
        {
          id: "e2",
          componentId: "comp1",
          containerId: "c1",
          kind: "class",
          name: "E2",
        },
      ],
    };
    const config = configSchema.parse({
      submodules: { enabled: true },
      levels: { component: true, code: true },
      code: { minElements: 1, includePrivate: false, includeMembers: true },
    });

    const rootOutputDir = path.join(tmp, "docs/architecture");
    fs.mkdirSync(rootOutputDir, { recursive: true });

    const result = generateSubmoduleDocs(tmp, rootOutputDir, model, config);

    expect(result.scaffoldFailed).toBeGreaterThan(0);
    expect(result.outputs.length).toBeGreaterThan(0);
  });
});
