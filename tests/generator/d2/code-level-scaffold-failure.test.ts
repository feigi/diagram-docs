import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateCodeLevelDiagrams } from "../../../src/cli/commands/generate.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import { configSchema } from "../../../src/config/schema.js";

// Force scaffoldCodeFile to throw so we can verify the counter is bumped.
// (scaffoldCodeFile's early-return on fs.existsSync makes a pure filesystem
// EISDIR/ENOTDIR setup unreliable: the generator also creates the component
// `_generated/` dir up-front, which collides with any preplaced sentinel we
// could use.)
vi.mock("../../../src/generator/d2/code-scaffold.js", () => ({
  scaffoldCodeFile: vi.fn(() => {
    const e = new Error(
      "EISDIR: illegal operation on a directory",
    ) as NodeJS.ErrnoException;
    e.code = "EISDIR";
    throw e;
  }),
}));

describe("generateCodeLevelDiagrams — scaffold failures are counted", () => {
  let tmp: string;
  let origExitCode: number | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-l4-scaffold-"));
    origExitCode = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = origExitCode;
    vi.restoreAllMocks();
  });

  it("increments scaffoldFailed when scaffoldCodeFile throws", () => {
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "c1",
          applicationId: "c1",
          name: "C1",
          description: "",
          technology: "",
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
    const config = configSchema.parse({ levels: { code: true } });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = generateCodeLevelDiagrams({ model, config, outputDir: tmp });

    expect(result.scaffoldFailed).toBeGreaterThan(0);
    expect(result.written + result.unchanged).toBeGreaterThan(0);
  });
});
