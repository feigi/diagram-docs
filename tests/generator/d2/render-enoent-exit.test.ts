import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock node:child_process so execFileSync throws a synthetic ENOENT as if
// the `d2` binary were missing from $PATH. vi.mock hoists above the SUT
// import, so the mocked binding is the one generate.ts picks up.
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFileSync: vi.fn(() => {
      const err = new Error("spawn d2 ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }),
  };
});

describe("renderD2Files — ENOENT sets process.exitCode=1", () => {
  let tmp: string;
  let origExitCode: number | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-enoent-"));
    origExitCode = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = origExitCode;
    vi.restoreAllMocks();
  });

  it("flips process.exitCode to 1 when d2 binary is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const d2Path = path.join(tmp, "c1-context.d2");
    fs.writeFileSync(d2Path, "# noop\n", "utf-8");

    const { renderD2FilesForTest } =
      await import("../../../src/cli/commands/generate.js");
    const { configSchema } = await import("../../../src/config/schema.js");
    const config = configSchema.parse({});

    renderD2FilesForTest([d2Path], config);

    expect(process.exitCode).toBe(1);
  });
});
