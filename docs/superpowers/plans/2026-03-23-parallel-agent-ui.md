# Parallel Agent UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared Frame during parallel LLM builds with a per-app status display and per-agent log files for post-mortem debugging.

**Architecture:** Extract shared terminal utilities from `frame.ts` into `terminal-utils.ts`. Create `ParallelProgress` (compact per-app status table) and `AgentLogger` (append-only log file per app). Wire them into `parallel-model-builder.ts` when the caller omits `onStatus`/`onProgress`, and update `model.ts` to omit those callbacks in multi-app mode.

**Tech Stack:** TypeScript, chalk, Node.js fs/path, vitest

**Spec:** `docs/superpowers/specs/2026-03-23-parallel-agent-ui-design.md`

---

### Task 1: Extract terminal utilities from frame.ts

**Files:**

- Create: `src/cli/terminal-utils.ts`
- Modify: `src/cli/frame.ts:1-80`
- Test: `tests/cli/terminal-utils.test.ts`

- [ ] **Step 1: Write failing tests for terminal utilities**

```typescript
// tests/cli/terminal-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  stripAnsi,
  truncate,
  padRight,
  getFrameWidth,
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
} from "../../src/cli/terminal-utils.js";

describe("formatElapsed", () => {
  it("formats seconds below 60", () => {
    expect(formatElapsed(5000)).toBe("5s");
    expect(formatElapsed(59000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(61000)).toBe("1m 1s");
    expect(formatElapsed(192000)).toBe("3m 12s");
  });

  it("formats zero", () => {
    expect(formatElapsed(0)).toBe("0s");
  });
});

describe("stripAnsi", () => {
  it("strips ANSI escape codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long text with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("padRight", () => {
  it("pads to width", () => {
    expect(padRight("hi", 5)).toBe("hi   ");
  });

  it("handles ANSI codes in width calculation", () => {
    const colored = "\x1b[31mhi\x1b[0m";
    const padded = padRight(colored, 5);
    expect(stripAnsi(padded)).toBe("hi   ");
  });
});

describe("constants", () => {
  it("exports spinner frames", () => {
    expect(SPINNER_FRAMES).toHaveLength(10);
    expect(SPINNER_FRAMES[0]).toBe("⠋");
  });

  it("exports spinner interval", () => {
    expect(SPINNER_INTERVAL).toBe(80);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/terminal-utils.test.ts`
Expected: FAIL — module `../../src/cli/terminal-utils.js` not found

- [ ] **Step 3: Create terminal-utils.ts with extracted utilities**

```typescript
// src/cli/terminal-utils.ts
/**
 * Shared terminal utilities used by Frame and ParallelProgress components.
 */

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];
export const SPINNER_INTERVAL = 80;

export function getFrameWidth(): number {
  if (process.stderr.isTTY && process.stderr.columns) {
    return Math.min(process.stderr.columns, 120);
  }
  return 80;
}

export function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

export function padRight(text: string, width: number): string {
  const visible = stripAnsi(text).length;
  const padding = Math.max(0, width - visible);
  return text + " ".repeat(padding);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/terminal-utils.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Update frame.ts to import from terminal-utils**

Replace the local definitions in `src/cli/frame.ts` (lines 1-80) with imports. Remove the local `SPINNER_FRAMES`, `SPINNER_INTERVAL`, `getFrameWidth`, `formatElapsed`, `stripAnsi`, `truncate`, `padRight` definitions and import them instead:

```typescript
// At the top of src/cli/frame.ts, replace lines 1-80 with:
/**
 * Live-updating boxed frame for stderr output.
 * Fixed-size panel with spinner, status line, and scrolling log area.
 * Falls back to static output when stderr is not a TTY.
 */
import chalk from "chalk";
import { constants as osConstants } from "node:os";
import {
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
  getFrameWidth,
  formatElapsed,
  stripAnsi,
  truncate,
  padRight,
} from "./terminal-utils.js";

const MIN_LOG_LINES = 3;
const FRAME_OVERHEAD = 4; // top + 2 status rows + bottom

/** Strip newlines and collapse whitespace to produce a single safe line. */
function sanitize(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Keep `wordWrap` and `sanitize` as local functions in `frame.ts` — they are only used there.

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add src/cli/terminal-utils.ts src/cli/frame.ts tests/cli/terminal-utils.test.ts
git commit -m "refactor: extract shared terminal utilities from frame.ts"
```

---

### Task 2: Create AgentLogger

**Files:**

- Create: `src/core/agent-logger.ts`
- Test: `tests/core/agent-logger.test.ts`

- [ ] **Step 1: Write failing tests for AgentLogger**

```typescript
// tests/core/agent-logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AgentLogger } from "../../src/core/agent-logger.js";

describe("AgentLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes START marker with metadata", async () => {
    const logPath = path.join(tmpDir, "agent-test.log");
    const logger = new AgentLogger(logPath, {
      appId: "my-app",
      model: "sonnet",
      provider: "claude-code",
    });
    logger.logPrompt("system prompt text", "user message text");
    await logger.logDone(5000);

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain(
      "START app=my-app model=sonnet provider=claude-code",
    );
    expect(content).toContain("SYSTEM PROMPT");
    expect(content).toContain("system prompt text");
    expect(content).toContain("USER MESSAGE");
    expect(content).toContain("user message text");
    expect(content).toContain("DONE elapsed=5s");
  });

  it("writes THINKING and OUTPUT sections from progress events", async () => {
    const logPath = path.join(tmpDir, "agent-test.log");
    const logger = new AgentLogger(logPath, {
      appId: "my-app",
      model: "sonnet",
      provider: "claude-code",
    });
    logger.logPrompt("sys", "usr");
    logger.logProgress({
      line: "analyzing structure...",
      final: true,
      kind: "thinking",
    });
    logger.logProgress({ line: "version: 1", final: true, kind: "output" });
    await logger.logDone(3000);

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("THINKING");
    expect(content).toContain("analyzing structure...");
    expect(content).toContain("OUTPUT");
    expect(content).toContain("version: 1");
  });

  it("does not repeat section headers for consecutive same-kind events", async () => {
    const logPath = path.join(tmpDir, "agent-test.log");
    const logger = new AgentLogger(logPath, {
      appId: "my-app",
      model: "sonnet",
      provider: "claude-code",
    });
    logger.logPrompt("sys", "usr");
    logger.logProgress({ line: "line one", final: true, kind: "thinking" });
    logger.logProgress({ line: "line two", final: true, kind: "thinking" });
    await logger.logDone(1000);

    const content = fs.readFileSync(logPath, "utf-8");
    const thinkingCount = (content.match(/THINKING/g) || []).length;
    expect(thinkingCount).toBe(1);
  });

  it("writes FAILED marker on error", async () => {
    const logPath = path.join(tmpDir, "agent-test.log");
    const logger = new AgentLogger(logPath, {
      appId: "my-app",
      model: "sonnet",
      provider: "claude-code",
    });
    logger.logPrompt("sys", "usr");
    await logger.logFailed("Provider timeout after 900000ms", 107000);

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain(
      "FAILED elapsed=107s error=Provider timeout after 900000ms",
    );
    expect(content).not.toContain("DONE");
  });

  it("flushes buffer on kind change", async () => {
    const logPath = path.join(tmpDir, "agent-test.log");
    const logger = new AgentLogger(logPath, {
      appId: "my-app",
      model: "sonnet",
      provider: "claude-code",
    });
    logger.logPrompt("sys", "usr");
    logger.logProgress({ line: "thinking...", final: true, kind: "thinking" });
    logger.logProgress({ line: "output line", final: true, kind: "output" });
    logger.logProgress({
      line: "more thinking",
      final: true,
      kind: "thinking",
    });
    await logger.logDone(2000);

    const content = fs.readFileSync(logPath, "utf-8");
    const thinkingCount = (content.match(/THINKING/g) || []).length;
    const outputCount = (content.match(/\] OUTPUT/g) || []).length;
    expect(thinkingCount).toBe(2);
    expect(outputCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/agent-logger.test.ts`
Expected: FAIL — module `../../src/core/agent-logger.js` not found

- [ ] **Step 3: Implement AgentLogger**

```typescript
// src/core/agent-logger.ts
/**
 * Per-agent log file writer for parallel LLM builds.
 * Appends timestamped sections (prompts, thinking, output, done/failed)
 * to a plain text log file for post-mortem debugging.
 */
import * as fs from "node:fs";
import { formatElapsed } from "../cli/terminal-utils.js";
import type { ProgressEvent } from "./llm-model-builder.js";

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class AgentLogger {
  private readonly logPath: string;
  private readonly metadata: { appId: string; model: string; provider: string };
  private buffer: string = "";
  private currentKind: ProgressEvent["kind"] | null = null;

  constructor(
    logPath: string,
    metadata: { appId: string; model: string; provider: string },
  ) {
    this.logPath = logPath;
    this.metadata = metadata;
  }

  logPrompt(systemPrompt: string, userMessage: string): void {
    const { appId, model, provider } = this.metadata;
    this.buffer += `[${timestamp()}] START app=${appId} model=${model} provider=${provider}\n`;
    this.buffer += `[${timestamp()}] SYSTEM PROMPT\n`;
    this.buffer += systemPrompt + "\n";
    this.buffer += `[${timestamp()}] USER MESSAGE\n`;
    this.buffer += userMessage + "\n";
  }

  logProgress(event: ProgressEvent): void {
    if (event.kind !== this.currentKind) {
      this.flush();
      this.buffer += `[${timestamp()}] ${event.kind.toUpperCase()}\n`;
      this.currentKind = event.kind;
    }
    if (event.final) {
      this.buffer += event.line + "\n";
    }
  }

  async logDone(elapsedMs: number): Promise<void> {
    this.buffer += `[${timestamp()}] DONE elapsed=${formatElapsed(elapsedMs)}\n`;
    await this.flush();
  }

  async logFailed(error: string, elapsedMs: number): Promise<void> {
    this.buffer += `[${timestamp()}] FAILED elapsed=${formatElapsed(elapsedMs)} error=${error}\n`;
    await this.flush();
  }

  private flush(): Promise<void> {
    if (!this.buffer) return Promise.resolve();
    const data = this.buffer;
    this.buffer = "";
    return fs.promises.writeFile(this.logPath, data, { flag: "a" });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/agent-logger.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-logger.ts tests/core/agent-logger.test.ts
git commit -m "feat: add AgentLogger for per-app LLM debug logs"
```

---

### Task 3: Create ParallelProgress component

**Files:**

- Create: `src/cli/parallel-progress.ts`
- Test: `tests/cli/parallel-progress.test.ts`

- [ ] **Step 1: Write failing tests for ParallelProgress**

```typescript
// tests/cli/parallel-progress.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli/parallel-progress.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ParallelProgress component**

```typescript
// src/cli/parallel-progress.ts
/**
 * Compact terminal display for parallel LLM agent status.
 * Shows per-app state (queued/thinking/output/done/failed) with spinners and elapsed timers.
 * Falls back to one-line-per-transition when stderr is not a TTY.
 */
import chalk from "chalk";
import {
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
  formatElapsed,
  getFrameWidth,
  truncate,
  padRight,
  stripAnsi,
} from "./terminal-utils.js";

export type AppState = "queued" | "thinking" | "output" | "done" | "failed";

export interface ParallelProgress {
  /** Register apps upfront so queued state renders immediately */
  setApps(appIds: string[]): void;
  /** Update a single app's state */
  updateApp(appId: string, state: AppState): void;
  /** Overall status text (e.g. "Merging models...") */
  setStatus(text: string): void;
  /** Collapse to summary and release terminal */
  stop(summary: string): void;
}

interface AppEntry {
  id: string;
  state: AppState;
  startTime: number | null;
  elapsed: number | null; // frozen on done/failed
}

export function createParallelProgress(llmModel: string): ParallelProgress {
  const isTTY = process.stderr.isTTY;
  const startTime = Date.now();
  const apps: AppEntry[] = [];
  let statusText = "";
  let spinnerIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let prevTotalRows = 0;
  let firstRender = true;
  let stopped = false;
  const MAX_APP_ID_LEN = 28;

  function overallElapsed(): string {
    return formatElapsed(Date.now() - startTime);
  }

  // ── Non-TTY helpers ──

  function printLine(text: string): void {
    process.stderr.write(`[${overallElapsed().padStart(7)}] ${text}\n`);
  }

  // ── TTY rendering ──

  function stateIcon(state: AppState): string {
    switch (state) {
      case "done":
        return chalk.green("✓");
      case "failed":
        return chalk.red("✗");
      case "queued":
        return chalk.dim("○");
      default:
        return chalk.cyan(SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length]);
    }
  }

  function render(): void {
    if (!isTTY || stopped) return;

    const frameWidth = getFrameWidth();
    const inner = frameWidth - 2;

    function row(content: string): string {
      return (
        chalk.dim("│") +
        " " +
        padRight(content, inner - 2) +
        " " +
        chalk.dim("│")
      );
    }

    const titleStr = " LLM Agents ";
    const topFill = inner - titleStr.length - 1;
    const top =
      chalk.dim("┌─") +
      chalk.bold(titleStr) +
      chalk.dim("─".repeat(Math.max(0, topFill)) + "┐");
    const bottom = chalk.dim("└" + "─".repeat(inner) + "┘");

    // Header: spinner + "Modeling N apps" + overall elapsed
    const spinner = chalk.cyan(
      SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length],
    );
    const headerText = statusText || `Modeling ${apps.length} apps`;
    const elapsed = overallElapsed();
    const maxHeaderText = inner - 10 - elapsed.length;
    const headerRow = row(
      `${spinner} ${truncate(headerText, maxHeaderText)}  ${chalk.dim(elapsed)}`,
    );

    // Model line
    const modelRow = row(`  Model: ${llmModel}`);

    // Blank separator
    const blankRow = chalk.dim("│") + " ".repeat(inner) + chalk.dim("│");

    // App rows — limit to terminal height
    const termRows = process.stderr.rows || 24;
    const maxAppRows = Math.max(3, termRows - 6); // borders + header + model + blank + padding

    // Partition: active/recent first, then queued
    const active = apps.filter((a) => a.state !== "queued");
    const queued = apps.filter((a) => a.state === "queued");
    let visibleApps: AppEntry[];
    let hiddenCount = 0;

    if (active.length + queued.length <= maxAppRows) {
      visibleApps = [...active, ...queued];
    } else if (active.length >= maxAppRows) {
      visibleApps = active.slice(0, maxAppRows - 1);
      hiddenCount = apps.length - visibleApps.length;
    } else {
      const queuedSlots = maxAppRows - active.length - 1; // -1 for "... and N more"
      visibleApps = [...active, ...queued.slice(0, Math.max(0, queuedSlots))];
      hiddenCount = apps.length - visibleApps.length;
    }

    const appRows = visibleApps.map((app) => {
      const icon = stateIcon(app.state);
      const id = truncate(app.id, MAX_APP_ID_LEN);
      const stateLabel =
        app.state === "done" || app.state === "failed"
          ? app.state
          : app.state === "queued"
            ? "queued"
            : `${app.state}...`;
      const elapsedStr =
        app.elapsed != null
          ? formatElapsed(app.elapsed)
          : app.startTime != null
            ? formatElapsed(Date.now() - app.startTime)
            : "";
      // Layout: "  icon id          state    elapsed"
      const leftPart = `${icon} ${padRight(id, MAX_APP_ID_LEN + 2)}${stateLabel}`;
      if (elapsedStr) {
        const maxLeft = inner - 4 - elapsedStr.length;
        return row(`  ${padRight(leftPart, maxLeft)}${chalk.dim(elapsedStr)}`);
      }
      return row(`  ${leftPart}`);
    });

    if (hiddenCount > 0) {
      appRows.push(row(chalk.dim(`  … and ${hiddenCount} more queued`)));
    }

    const rows = [top, headerRow, modelRow, blankRow, ...appRows, bottom];
    const totalRows = rows.length;

    let output = "";
    if (firstRender) {
      output += "\n".repeat(totalRows) + `\x1b[${totalRows}A`;
      firstRender = false;
    } else {
      const extra = Math.max(0, totalRows - prevTotalRows);
      output += "\n".repeat(extra);
      output += `\x1b[${prevTotalRows + extra}A`;
    }
    output += "\x1b[?25l"; // hide cursor
    output += rows.join("\n") + "\n";
    output += "\x1b[J"; // erase below
    prevTotalRows = totalRows;

    process.stderr.write(output);
  }

  function startTimer(): void {
    if (timer || !isTTY) return;
    timer = setInterval(() => {
      spinnerIdx++;
      render();
    }, SPINNER_INTERVAL);
  }

  function stopTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    setApps(appIds: string[]): void {
      apps.length = 0;
      for (const id of appIds) {
        apps.push({ id, state: "queued", startTime: null, elapsed: null });
      }
      if (!isTTY) {
        printLine(`Modeling ${appIds.length} apps (${llmModel})`);
        return;
      }
      render();
      startTimer();
    },

    updateApp(appId: string, state: AppState): void {
      const entry = apps.find((a) => a.id === appId);
      if (!entry) return;

      // Start per-app timer on first non-queued state
      if (entry.startTime == null && state !== "queued") {
        entry.startTime = Date.now();
      }
      // Freeze elapsed on terminal states
      if ((state === "done" || state === "failed") && entry.startTime != null) {
        entry.elapsed = Date.now() - entry.startTime;
      }
      entry.state = state;

      if (!isTTY) {
        const elapsedStr =
          entry.elapsed != null ? ` (${formatElapsed(entry.elapsed)})` : "";
        printLine(`${appId}: ${state}${elapsedStr}`);
        return;
      }
      render();
    },

    setStatus(text: string): void {
      statusText = text;
      if (!isTTY) {
        printLine(text);
        return;
      }
      render();
    },

    stop(summary: string): void {
      if (stopped) return;
      stopped = true;
      stopTimer();

      const elapsed = overallElapsed();

      if (!isTTY) {
        printLine(summary);
        return;
      }

      // Render collapsed summary frame
      const frameWidth = getFrameWidth();
      const inner = frameWidth - 2;
      const titleStr = " LLM Agents ";
      const topFill = inner - titleStr.length - 1;
      const top =
        chalk.dim("┌─") +
        chalk.bold(titleStr) +
        chalk.dim("─".repeat(Math.max(0, topFill)) + "┐");
      const bottom = chalk.dim("└" + "─".repeat(inner) + "┘");
      const summaryRow =
        chalk.dim("│") +
        " " +
        padRight(
          `${chalk.green("✓")} ${truncate(summary, inner - 8)}  ${chalk.dim(elapsed)}`,
          inner - 2,
        ) +
        " " +
        chalk.dim("│");

      let output = "";
      if (prevTotalRows > 0) {
        output += `\x1b[${prevTotalRows}A`;
      }
      output += [top, summaryRow, bottom].join("\n") + "\n";
      output += "\x1b[J";
      output += "\x1b[?25h"; // show cursor

      process.stderr.write(output);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli/parallel-progress.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/parallel-progress.ts tests/cli/parallel-progress.test.ts
git commit -m "feat: add ParallelProgress component for multi-app LLM status"
```

---

### Task 4: Wire ParallelProgress and AgentLogger into parallel-model-builder

**Files:**

- Modify: `src/core/parallel-model-builder.ts:1-30,154-161,168-180,241-276,394-397,438-440,499-540`
- Modify: `src/core/llm-model-builder.ts:1028-1036`
- Modify: `src/cli/commands/model.ts:51-102`

- [ ] **Step 1: Write failing test for parallel builder creating its own UI**

Add a test to `tests/core/parallel-model-builder.test.ts` that verifies when `onStatus`/`onProgress` are omitted, the builder still succeeds (it creates its own UI internally). This is an integration-level test confirming the wiring works.

```typescript
// Add to tests/core/parallel-model-builder.test.ts, in the "buildModelParallel" describe block

it("creates its own UI when onStatus/onProgress are omitted", async () => {
  // Provide a minimal provider that returns valid YAML
  const provider: LLMProvider = {
    name: "test-provider",
    supportsTools: false,
    isAvailable: () => true,
    generate: async (_sys, _user, _model, _onProgress) => {
      return stringifyYaml(
        makePartialModel({
          system: { name: "Test", description: "test" },
          containers: [
            { id: "c1", name: "C1", description: "c", technology: "java" },
          ],
          components: [],
          relationships: [],
        }),
      );
    },
  };

  const raw = makeRawStructure([makeApp("app-a"), makeApp("app-b")]);
  const config = configSchema.parse({
    system: { name: "Test", description: "test" },
    llm: { model: "test", concurrency: 2 },
  });

  // Call WITHOUT onStatus/onProgress — should not throw
  const result = await buildModelParallel({
    rawStructure: raw,
    config,
    provider,
  });

  expect(result.containers.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run test to verify it passes (baseline — current code already handles optional callbacks)**

Run: `npx vitest run tests/core/parallel-model-builder.test.ts -t "creates its own UI"`
Expected: This should already pass since `onStatus`/`onProgress` are already optional. This confirms the baseline.

- [ ] **Step 3: Add imports and log directory setup to parallel-model-builder.ts**

At the top of `src/core/parallel-model-builder.ts`, add imports:

```typescript
// Add after existing imports (after line 27):
import { createParallelProgress } from "../cli/parallel-progress.js";
import { createFrame } from "../cli/frame.js";
import { AgentLogger } from "./agent-logger.js";
```

At the start of `buildModelParallel()` (after line 172, the destructuring), add log directory setup:

```typescript
// -- Log directory setup --
const logsDir = path.join(".diagram-docs", "logs");
const manageOwnUI = !onStatus && !onProgress;

if (manageOwnUI) {
  // Create logs directory, clearing previous run's logs
  fs.rmSync(logsDir, { recursive: true, force: true });
  fs.mkdirSync(logsDir, { recursive: true });

  // Warn if not gitignored
  try {
    const gitignorePath = ".gitignore";
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, "utf-8");
      if (!gitignore.includes(".diagram-docs/logs")) {
        process.stderr.write(
          chalk.yellow("Warning: .diagram-docs/logs/ is not in .gitignore\n"),
        );
      }
    }
  } catch {
    /* best-effort check */
  }
}
```

Also add `import chalk from "chalk";` at the top of the file (after the existing imports).

- [ ] **Step 4: Create ParallelProgress when managing own UI**

After the log directory setup (still inside `buildModelParallel`, before Step 1 "Split"), add:

```typescript
// -- UI setup --
const progress = manageOwnUI
  ? createParallelProgress(config.llm.model)
  : undefined;
```

After the split step (line ~192), add:

```typescript
if (progress) {
  const appIds = slices.map((s) => s.applications[0].id);
  progress.setApps(appIds);
}
```

- [ ] **Step 5: Wire per-app progress and logging into buildOneApp**

Inside `buildOneApp()` (after `const app = slice.applications[0];` on line ~248), create the logger and progress closure:

```typescript
const logger = manageOwnUI
  ? new AgentLogger(path.join(logsDir, `agent-${safeAppId}.log`), {
      appId: app.id,
      model: config.llm.model,
      provider: provider.name,
    })
  : undefined;

const appStartTime = Date.now();

// Per-app progress closure: updates both ParallelProgress and AgentLogger
let currentAppState: "queued" | "thinking" | "output" = "queued";
const appOnProgress = manageOwnUI
  ? (event: ProgressEvent) => {
      logger!.logProgress(event);
      const newState = event.kind;
      if (newState !== currentAppState) {
        currentAppState = newState;
        progress!.updateApp(app.id, newState);
      }
    }
  : onProgress;
```

Move `const safeAppId = ...` before the logger creation (it's already there at line ~253).

Replace the `onStatus?.(\`Modeling app ...\`)` call with:

```typescript
if (progress) {
  progress.updateApp(app.id, "thinking");
} else {
  onStatus?.(`Modeling app ${index + 1}/${slices.length}: ${app.id}`);
}
```

Log prompts to the agent logger after building them:

```typescript
// After building systemPrompt and userMessage (line ~267):
logger?.logPrompt(systemPrompt, userMessage);
```

Replace `onProgress` in the `provider.generate()` call (line ~275) with `appOnProgress`:

```typescript
textOutput = await provider.generate(
  systemPrompt,
  userMessage,
  config.llm.model,
  appOnProgress,
);
```

After successful `buildOneApp` return (before `return { model: ..., fellBack: false }`), log done:

```typescript
await logger?.logDone(Date.now() - appStartTime);
```

In the recoverable error catch block (line ~379-387), update both progress and logger:

```typescript
if (isRecoverableLLMError(err)) {
  const msg = err instanceof Error ? err.message : String(err);
  warn(
    `App ${slice.applications[0].id}: LLM failed (${msg}), using deterministic seed`,
  );
  progress?.updateApp(slice.applications[0].id, "failed");
  await logger?.logFailed(msg, Date.now() - appStartTime);
  return { model: seed, fellBack: true };
}
```

After successful `buildOneApp` return, also update progress to "done":

```typescript
progress?.updateApp(app.id, "done");
```

- [ ] **Step 6: Collapse ParallelProgress after all apps finish, before synthesis**

After `Promise.allSettled` and result collection (around line ~440 where "Merging per-app models..." is), add:

```typescript
// Collapse parallel progress display
const doneCount = results.filter((r) => !r.fellBack).length;
if (progress) {
  progress.stop(`${doneCount}/${slices.length} apps modeled`);
}
```

- [ ] **Step 7: Create Frame for synthesis pass when managing own UI**

In the synthesis section (around line ~499), replace the direct `onStatus`/`onProgress` usage with a synthesis frame:

```typescript
// Before the synthesis try block:
const synthesisFrame = manageOwnUI ? createFrame("LLM Synthesis") : undefined;
const synthesisOnStatus = manageOwnUI
  ? (status: string) =>
      synthesisFrame!.update([
        { text: status, spinner: true },
        { text: `Model: ${config.llm.model}` },
      ])
  : onStatus;
const synthesisOnProgress = manageOwnUI
  ? (event: ProgressEvent) =>
      synthesisFrame!.log(event.line, event.final, event.kind)
  : onProgress;
```

Replace `onStatus?.("Running synthesis pass...");` with:

```typescript
synthesisOnStatus?.("Running synthesis pass...");
```

Replace `onProgress` in the synthesis `provider.generate()` call with `synthesisOnProgress`.

After the synthesis try/catch block completes, stop the frame:

```typescript
if (synthesisFrame) {
  synthesisFrame.stop([{ text: "Synthesis complete" }]);
}
```

In the synthesis catch block (the recoverable error branch), also stop the frame:

```typescript
// Inside the catch (isRecoverableLLMError(err)) block for synthesis:
synthesisFrame?.stop([{ text: `Synthesis failed: ${msg}` }]);
```

- [ ] **Step 8: Fix llm-model-builder.ts to pass undefined callbacks in multi-app mode**

In `src/core/llm-model-builder.ts`, the `buildModelWithLLM` function (line ~1028-1036) currently always wraps `onStatus` in a lambda before passing to `buildModelParallel`, even when the original caller omitted it. This means `onStatus` is always defined from `parallel-model-builder.ts`'s perspective, so `manageOwnUI` would never be true.

Replace lines 1028-1036:

```typescript
    try {
      return await buildModelParallel({
        rawStructure: options.rawStructure,
        config: options.config,
        configYaml: options.configYaml,
        provider: resolvedProvider,
        onStatus: (status) => options.onStatus?.(status, resolvedProvider.name),
        onProgress: options.onProgress,
      });
```

With:

```typescript
    try {
      return await buildModelParallel({
        rawStructure: options.rawStructure,
        config: options.config,
        configYaml: options.configYaml,
        provider: resolvedProvider,
        onStatus: options.onStatus
          ? (status) => options.onStatus!(status, resolvedProvider.name)
          : undefined,
        onProgress: options.onProgress,
      });
```

This ensures `onStatus` and `onProgress` are `undefined` when the caller (model.ts) omits them in multi-app mode, allowing `parallel-model-builder.ts` to detect this and create its own UI.

- [ ] **Step 9: Update model.ts to skip Frame creation in multi-app mode**

In `src/cli/commands/model.ts`, replace the LLM block (lines 64-87) with mode detection:

```typescript
const isSeedMode = !existingModelYaml?.trim();
const isParallel = isSeedMode && rawStructure.applications.length > 1;

if (isParallel) {
  // Multi-app: parallel builder manages its own UI internally
  const model = await buildModelWithLLM({
    rawStructure,
    config,
    configYaml,
    existingModelYaml,
  });
  yamlContent = serializeModel(model);

  fs.writeFileSync(outputPath, yamlContent, "utf-8");
  console.error(`Model written to ${path.relative(process.cwd(), outputPath)}`);
} else {
  // Single-app / update: use Frame as before
  const frame = createFrame("LLM Agent");
  const model = await buildModelWithLLM({
    rawStructure,
    config,
    configYaml,
    existingModelYaml,
    onStatus(status) {
      frame.update([
        { text: status, spinner: true },
        { text: `Model: ${config.llm.model}` },
      ]);
    },
    onProgress({ line, final: done, kind }) {
      frame.log(line, done, kind);
    },
  });
  frame.stop([
    {
      text:
        `${model.containers.length} container(s), ` +
        `${model.components.length} component(s), ` +
        `${model.relationships.length} relationship(s)`,
    },
  ]);
  yamlContent = serializeModel(model);

  fs.writeFileSync(outputPath, yamlContent, "utf-8");
  console.error(`Model written to ${path.relative(process.cwd(), outputPath)}`);
}
```

The `outputPath` and `yamlContent` write logic is duplicated here for clarity — both branches need to write the file. The `outputPath` variable is already defined above (line 59).

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 11: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 12: Commit**

```bash
git add src/core/parallel-model-builder.ts src/core/llm-model-builder.ts src/cli/commands/model.ts
git commit -m "feat: wire ParallelProgress and AgentLogger into parallel LLM builds"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite one more time**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No lint errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 4: Commit any fixups if needed**

Only if previous steps required changes.
