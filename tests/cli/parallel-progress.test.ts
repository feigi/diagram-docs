import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ParallelProgress } from "../../src/cli/parallel-progress.js";

// Capture stderr output for assertion
let stderrOutput: string;
const originalWrite = process.stderr.write;

function captureStderr() {
  stderrOutput = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrOutput +=
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
}

function restoreStderr() {
  process.stderr.write = originalWrite;
}

describe("ParallelProgress", () => {
  // Test non-TTY (static) mode — TTY mode requires terminal emulation
  // and is better tested manually.

  beforeEach(() => {
    vi.stubGlobal("process", {
      ...process,
      on: process.on.bind(process),
      off: process.off.bind(process),
      addListener: process.addListener.bind(process),
      removeListener: process.removeListener.bind(process),
      exit: process.exit.bind(process),
      stderr: { ...process.stderr, isTTY: false, write: process.stderr.write },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreStderr();
  });

  it("prints app state transitions in non-TTY mode", async () => {
    // Dynamic import after stubbing process
    const { createParallelProgress } =
      await import("../../src/cli/parallel-progress.js");
    captureStderr();

    const progress = createParallelProgress("sonnet");
    progress.setApps(["app-a", "app-b"]);
    progress.updateApp("app-a", "thinking");
    progress.updateApp("app-a", "done");
    progress.stop("2/2 apps modeled");

    expect(stderrOutput).toContain("Modeling 2 apps");
    expect(stderrOutput).toContain("app-a: thinking");
    expect(stderrOutput).toContain("app-a: done");
    expect(stderrOutput).toContain("2/2 apps modeled");
  });

  it("tracks per-app state correctly", async () => {
    const { createParallelProgress } =
      await import("../../src/cli/parallel-progress.js");
    captureStderr();

    const progress = createParallelProgress("sonnet");
    progress.setApps(["app-a", "app-b", "app-c"]);
    progress.updateApp("app-a", "thinking");
    progress.updateApp("app-b", "thinking");
    progress.updateApp("app-a", "output");
    progress.updateApp("app-a", "done");
    progress.updateApp("app-b", "failed");
    progress.stop("1/3 apps modeled");

    expect(stderrOutput).toContain("app-a: done");
    expect(stderrOutput).toContain("app-b: failed");
  });
});
