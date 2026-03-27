/**
 * Compact terminal display for parallel LLM agent status.
 * Shows per-app state (queued/thinking/output/done/failed) with spinners and elapsed timers.
 * Falls back to one-line-per-transition when stderr is not a TTY.
 */
import chalk from "chalk";
import { constants as osConstants } from "node:os";
import {
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
  formatElapsed,
  getFrameWidth,
  truncate,
  padRight,
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
  stop(summary: string, isError?: boolean): void;
}

interface AppEntry {
  id: string;
  state: AppState;
  startTime: number | null;
  elapsed: number | null; // frozen on done/failed
}

export function createParallelProgress(llmModel: string): ParallelProgress {
  const isTTY = process.stderr.isTTY;
  const stdinTTY = process.stdin.isTTY;
  const startTime = Date.now();
  const apps: AppEntry[] = [];
  let statusText = "";
  let spinnerIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let prevTotalRows = 0;
  let firstRender = true;
  let stopped = false;
  let viewportStart = 0;
  let userScrolled = false; // true while user has scrolled away from auto-advance position

  // Mouse capture state
  const SCROLL_STEP = 3;
  let stdinListener: ((data: Buffer) => void) | null = null;
  let wasRawMode = false;
  let signalHandled = false;

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
    const MAX_APP_ID_LEN = Math.min(60, Math.max(32, inner - 50));

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

    // App rows — limit to terminal height.
    // Scroll indicators are counted within the budget so the frame
    // height stays constant regardless of scroll position.
    const termRows = process.stderr.rows || 24;
    const maxAppRows = Math.max(3, termRows - 6);

    const totalApps = apps.length;
    const needsScrolling = totalApps > maxAppRows;
    let displayCount: number;
    let showAbove: boolean;
    let showBelow: boolean;

    if (!needsScrolling) {
      displayCount = totalApps;
      showAbove = false;
      showBelow = false;
    } else {
      showAbove = viewportStart > 0;
      if (!showAbove) {
        displayCount = maxAppRows - 1;
        showBelow = true;
      } else {
        const remaining = totalApps - viewportStart;
        if (remaining <= maxAppRows - 1) {
          displayCount = remaining;
          showBelow = false;
        } else {
          displayCount = maxAppRows - 2;
          showBelow = true;
        }
      }
    }

    // Scrolling viewport
    const visibleApps = apps.slice(viewportStart, viewportStart + displayCount);
    const hiddenAbove = viewportStart;
    const hiddenBelow = Math.max(0, totalApps - viewportStart - displayCount);

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
      const leftPart = `${icon} ${padRight(id, MAX_APP_ID_LEN + 2)}${stateLabel}`;
      if (elapsedStr) {
        const maxLeft = inner - 4 - elapsedStr.length;
        return row(`  ${padRight(leftPart, maxLeft)}${chalk.dim(elapsedStr)}`);
      }
      return row(`  ${leftPart}`);
    });

    if (showAbove) {
      appRows.unshift(row(chalk.dim(`  … ${hiddenAbove} above`)));
    }
    if (showBelow) {
      appRows.push(row(chalk.dim(`  … and ${hiddenBelow} more queued`)));
    }

    const rows = [top, headerRow, modelRow, ...appRows, bottom];
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
    output += "\x1b[?25l";
    output += rows.join("\n") + "\n";
    output += "\x1b[J";
    prevTotalRows = totalRows;

    process.stderr.write(output);
  }

  function emergencyRestore() {
    try {
      process.stderr.write("\x1b[?1000l\x1b[?1006l\x1b[?25h");
    } catch {
      /* best-effort during exit */
    }
    if (stdinTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* best-effort during exit */
      }
    }
  }

  function handleSignal(signal: NodeJS.Signals) {
    if (signalHandled) return;
    signalHandled = true;
    process.removeListener("exit", emergencyRestore);
    emergencyRestore();
    const sigNum = osConstants.signals[signal] ?? 2;
    process.exit(128 + sigNum);
  }

  function enableMouse(): void {
    if (!stdinTTY || stdinListener) return;
    wasRawMode = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    try {
      process.stderr.write("\x1b[?1000h\x1b[?1006h");
    } catch {
      try {
        process.stdin.setRawMode(wasRawMode);
      } catch {
        /* best-effort */
      }
      return;
    }
    process.on("exit", emergencyRestore);
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
    stdinListener = (data: Buffer) => {
      const str = data.toString();
      if (str.includes("\x03")) {
        if (signalHandled) return;
        signalHandled = true;
        process.removeListener("exit", emergencyRestore);
        emergencyRestore();
        process.exit(128 + (osConstants.signals.SIGINT ?? 2));
        return;
      }
      // SGR mouse: \x1b[<btn;col;rowM  (64=wheel up, 65=wheel down)
      // eslint-disable-next-line no-control-regex
      const match = str.match(/\x1b\[<(\d+);\d+;\d+[Mm]/);
      if (!match) return;
      const btn = parseInt(match[1], 10);
      const termRows = process.stderr.rows || 24;
      const maxAppRows = Math.max(3, termRows - 6);
      if (btn === 64) {
        // Scroll up — show earlier apps
        viewportStart = Math.max(0, viewportStart - SCROLL_STEP);
        userScrolled = true;
        render();
      } else if (btn === 65) {
        // Scroll down — show later apps
        const maxStart = Math.max(0, apps.length - maxAppRows + 1);
        viewportStart = Math.min(maxStart, viewportStart + SCROLL_STEP);
        // Re-enable auto-advance when scrolled to the bottom region
        if (viewportStart >= maxStart) {
          userScrolled = false;
        }
        render();
      }
    };
    process.stdin.on("data", stdinListener);
  }

  function disableMouse(): void {
    process.removeListener("exit", emergencyRestore);
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    signalHandled = false;
    if (stdinListener) {
      process.stdin.removeListener("data", stdinListener);
      stdinListener = null;
    }
    if (stdinTTY) {
      try {
        process.stderr.write("\x1b[?1000l\x1b[?1006l");
      } catch {
        /* stderr may be unavailable */
      }
      try {
        process.stdin.setRawMode(wasRawMode);
      } catch {
        /* stdin may be unavailable */
      }
      process.stdin.unref();
    }
  }

  function startTimer(): void {
    if (timer || !isTTY) return;
    enableMouse();
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

  function advanceViewport(maxAppRows: number): void {
    if (userScrolled) return; // don't override manual scroll position
    const maxStart = Math.max(0, apps.length - maxAppRows + 1);
    const firstActive = apps.findIndex(
      (a) => a.state !== "done" && a.state !== "failed",
    );
    const newStart =
      firstActive === -1 ? maxStart : Math.max(0, firstActive - 2);
    viewportStart = Math.min(maxStart, Math.max(viewportStart, newStart));
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
      if (!entry) {
        const warning = `Warning: updateApp called with unknown appId "${appId}"`;
        if (!isTTY) {
          printLine(warning);
        } else {
          try {
            process.stderr.write(`\n${warning}\n`);
          } catch {
            /* best-effort */
          }
        }
        return;
      }

      if (entry.startTime == null && state !== "queued") {
        entry.startTime = Date.now();
      }
      if ((state === "done" || state === "failed") && entry.startTime != null) {
        entry.elapsed = Date.now() - entry.startTime;
      }
      entry.state = state;

      if (state === "done" || state === "failed") {
        const termRows = process.stderr.rows || 24;
        advanceViewport(Math.max(3, termRows - 6));
      }

      if (!isTTY) {
        const elapsedStr =
          entry.elapsed != null ? ` (${formatElapsed(entry.elapsed)})` : "";
        printLine(`${appId}: ${state}${elapsedStr}`);
        return;
      }
      render();
    },

    setStatus(text: string): void {
      statusText = text.replace(/[\r\n]+/g, " ").trim();
      if (!isTTY) {
        printLine(statusText);
        return;
      }
      render();
    },

    stop(summary: string, isError = false): void {
      if (stopped) return;
      stopped = true;
      stopTimer();
      disableMouse();

      const elapsed = overallElapsed();

      if (!isTTY) {
        printLine(summary);
        return;
      }

      const frameWidth = getFrameWidth();
      const inner = frameWidth - 2;
      const titleStr = " LLM Agents ";
      const topFill = inner - titleStr.length - 1;
      const top =
        chalk.dim("┌─") +
        chalk.bold(titleStr) +
        chalk.dim("─".repeat(Math.max(0, topFill)) + "┐");
      const bottom = chalk.dim("└" + "─".repeat(inner) + "┘");
      const icon = isError ? chalk.red("✗") : chalk.green("✓");
      const summaryRow =
        chalk.dim("│") +
        " " +
        padRight(
          `${icon} ${truncate(summary, inner - 8)}  ${chalk.dim(elapsed)}`,
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
      output += "\x1b[?25h";

      try {
        process.stderr.write(output);
      } finally {
        // Ensure cursor is restored even if the write partially fails
        try {
          process.stderr.write("\x1b[?25h");
        } catch {
          /* best-effort */
        }
      }
    },
  };
}
