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

export interface FrameLine {
  text: string;
  spinner?: boolean;
}

export type LogKind = "thinking" | "output";

export interface Frame {
  update(lines: FrameLine[]): void;
  log(text: string, final?: boolean, kind?: LogKind): void;
  stop(lines: FrameLine[]): void;
}

/** Word-wrap text to fit within maxWidth, breaking on spaces. */
function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function getMaxLogLines(): number {
  const termRows =
    process.stderr.isTTY && process.stderr.rows ? process.stderr.rows : 24;
  // Reserve 1 extra row for the trailing \n after the frame content.
  // Without this, a full-height frame's trailing \n causes a scroll that
  // pushes the top border into scrollback, unreachable by cursor-up.
  return Math.max(MIN_LOG_LINES, termRows - FRAME_OVERHEAD - 1);
}

export function createFrame(title: string): Frame {
  const isTTY = process.stderr.isTTY;
  const stdinTTY = process.stdin.isTTY;
  const frameWidth = getFrameWidth();
  const inner = frameWidth - 2;
  const startTime = Date.now();
  const STATUS_ROWS = 2;
  const SCROLL_STEP = 3;

  let spinnerIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstRender = true;
  let stopped = false;
  let prevTotalRows = 0;
  let highWaterLogRows = MIN_LOG_LINES; // never shrink the frame

  // Scroll state: 0 = pinned to bottom, >0 = rows scrolled up from bottom
  let scrollOffset = 0;
  let prevLogRowCount = 0;
  let stdinListener: ((data: Buffer) => void) | null = null;
  let wasRawMode = false;

  let statusLines: FrameLine[] = [];
  const logBuffer: { text: string; kind: LogKind }[] = [];
  const logFinalized: Record<number, boolean> = {};

  // Pre-build static parts
  const titleStr = ` ${title} `;
  const topFill = inner - titleStr.length - 1;
  const top =
    chalk.dim("┌─") +
    chalk.bold(titleStr) +
    chalk.dim("─".repeat(Math.max(0, topFill)) + "┐");
  const bottom = chalk.dim("└" + "─".repeat(inner) + "┘");

  function row(content: string): string {
    return (
      chalk.dim("│") + " " + padRight(content, inner - 2) + " " + chalk.dim("│")
    );
  }

  function emptyRow(): string {
    return chalk.dim("│") + " ".repeat(inner) + chalk.dim("│");
  }

  function emergencyDisableMouse() {
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

  // Signal handler that restores the terminal and exits with the conventional
  // 128+signal code.  This is necessary because raw-mode stdin keeps the event
  // loop alive, preventing default signal behavior from terminating the process.
  let signalHandled = false;
  function handleSignal(signal: NodeJS.Signals) {
    if (signalHandled) return;
    signalHandled = true;
    process.removeListener("exit", emergencyDisableMouse);
    emergencyDisableMouse();
    const sigNum = osConstants.signals[signal] ?? 2;
    process.exit(128 + sigNum);
  }

  function enableMouse() {
    if (!stdinTTY || stdinListener) return;
    wasRawMode = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    try {
      process.stderr.write("\x1b[?1000h\x1b[?1006h"); // enable SGR mouse mode
    } catch {
      // stderr unavailable — restore stdin and bail out so the user isn't trapped in raw mode
      try {
        process.stdin.setRawMode(wasRawMode);
      } catch {
        /* best-effort */
      }
      return;
    }
    process.on("exit", emergencyDisableMouse);
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
    stdinListener = (data: Buffer) => {
      const str = data.toString();
      // Ctrl+C in raw mode arrives as \x03 — restore terminal and exit.
      // Uses the same signalHandled guard as handleSignal to prevent double-cleanup if both fire.
      if (str.includes("\x03")) {
        if (signalHandled) return;
        signalHandled = true;
        process.removeListener("exit", emergencyDisableMouse);
        emergencyDisableMouse();
        process.exit(128 + (osConstants.signals.SIGINT ?? 2));
        return;
      }
      // SGR mouse: \x1b[<btn;col;rowM  (64=wheel up, 65=wheel down)
      // eslint-disable-next-line no-control-regex
      const match = str.match(/\x1b\[<(\d+);\d+;\d+[Mm]/);
      if (!match) return;
      const btn = parseInt(match[1], 10);
      if (btn === 64) {
        scrollOffset += SCROLL_STEP;
        render();
      } else if (btn === 65) {
        scrollOffset = Math.max(0, scrollOffset - SCROLL_STEP);
        render();
      }
    };
    process.stdin.on("data", stdinListener);
  }

  function disableMouse() {
    process.removeListener("exit", emergencyDisableMouse);
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    signalHandled = false; // Reset for potential re-enable via next enableMouse() call
    if (stdinListener) {
      process.stdin.removeListener("data", stdinListener);
      stdinListener = null;
    }
    if (stdinTTY) {
      try {
        process.stderr.write("\x1b[?1000l\x1b[?1006l");
      } catch {
        /* stderr may be unavailable */
      } // disable mouse mode
      try {
        process.stdin.setRawMode(wasRawMode);
      } catch {
        /* stdin may be unavailable */
      }
      process.stdin.unref();
    }
  }

  function render() {
    const elapsed = Date.now() - startTime;
    const elapsedStr = formatElapsed(elapsed);
    const spinner = chalk.cyan(
      SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length],
    );

    const maxLogLines = getMaxLogLines();
    const OUTPUT_INDENT = 2; // align with "Model:..." status line
    const THINKING_INDENT = 6; // one tab relative to output
    const thinkingWidth = inner - 2 - THINKING_INDENT; // 2 for row padding
    const outputWidth = inner - 2 - OUTPUT_INDENT;

    // Expand log entries into rendered rows (thinking wraps, output truncates)
    const allLogRows: string[] = [];
    for (const entry of logBuffer) {
      if (entry.kind === "thinking") {
        const wrapped = wordWrap(entry.text, thinkingWidth);
        for (const wl of wrapped) {
          allLogRows.push(
            row(chalk.dim.italic(" ".repeat(THINKING_INDENT) + wl)),
          );
        }
      } else {
        allLogRows.push(
          row(
            chalk.white(
              " ".repeat(OUTPUT_INDENT) + truncate(entry.text, outputWidth),
            ),
          ),
        );
      }
    }

    // Keep viewport stable when content changes while scrolled up.
    // Adjust for both growth (new rows appended) and shrinkage (thinking
    // text re-wrapped to fewer lines or entries removed).
    const currentLogRowCount = allLogRows.length;
    if (scrollOffset > 0 && currentLogRowCount !== prevLogRowCount) {
      scrollOffset = Math.max(
        0,
        scrollOffset + (currentLogRowCount - prevLogRowCount),
      );
    }
    prevLogRowCount = currentLogRowCount;

    // Compute frame height from total content (not viewport position) so
    // highWaterLogRows keeps growing even while the user is scrolled up.
    const naturalRowCount = Math.max(
      MIN_LOG_LINES,
      Math.min(allLogRows.length, maxLogLines),
    );
    highWaterLogRows = Math.max(highWaterLogRows, naturalRowCount);
    const visibleRowCount = Math.min(highWaterLogRows, maxLogLines);

    // Clamp scroll so the viewport always fills the frame
    const maxScroll = Math.max(0, allLogRows.length - visibleRowCount);
    scrollOffset = Math.min(scrollOffset, maxScroll);

    // Compute viewport slice
    const bottomIdx = allLogRows.length - scrollOffset;
    const topIdx = Math.max(0, bottomIdx - visibleRowCount);
    const visibleLogRows = allLogRows.slice(topIdx, bottomIdx);

    // Add scroll indicators when content is clipped
    const hasAbove = topIdx > 0;
    const hasBelow = scrollOffset > 0;
    if (hasAbove && visibleLogRows.length > 0) {
      visibleLogRows[0] = row(chalk.dim(`  ↑ ${topIdx} more`));
    }

    // Pad with empty rows if fewer entries than the frame height
    while (visibleLogRows.length < visibleRowCount) {
      visibleLogRows.push(emptyRow());
    }

    // Place "↓ more" at the actual bottom of the frame
    if (hasBelow && visibleLogRows.length > 1) {
      visibleLogRows[visibleLogRows.length - 1] = row(
        chalk.dim(`  ↓ ${scrollOffset} more`),
      );
    }
    const totalRows = 1 + STATUS_ROWS + visibleRowCount + 1; // top + status + logs + bottom

    // Build status rows
    const rows: string[] = [];
    for (let i = 0; i < STATUS_ROWS; i++) {
      const line = statusLines[i];
      if (!line) {
        rows.push(emptyRow());
        continue;
      }
      const safeText = sanitize(line.text);
      if (line.spinner) {
        const maxText = inner - 10 - elapsedStr.length;
        const text = truncate(safeText, maxText);
        rows.push(row(`${spinner} ${text}  ${chalk.dim(elapsedStr)}`));
      } else {
        rows.push(row(`  ${truncate(safeText, inner - 6)}`));
      }
    }

    // Log rows
    rows.push(...visibleLogRows);

    const frame = [top, ...rows, bottom].join("\n");

    // Build a single output string: cursor movement + frame
    let output = "";
    if (firstRender) {
      // Reserve space so terminal scrolling doesn't break cursor math
      output += "\n".repeat(totalRows) + `\x1b[${totalRows}A`;
      firstRender = false;
    } else {
      // When the frame grows, reserve extra lines so the terminal scrolls
      // correctly and the old top border remains reachable by cursor-up.
      const extra = Math.max(0, totalRows - prevTotalRows);
      output += "\n".repeat(extra);
      output += `\x1b[${prevTotalRows + extra}A`;
    }
    output += "\x1b[?25l"; // hide cursor
    output += frame + "\n";
    // Erase any leftover content below the frame (the frame can shrink
    // when thinking entries are cleared, leaving stale terminal content).
    output += "\x1b[J";
    prevTotalRows = totalRows;

    process.stderr.write(output);
  }

  function startTimer() {
    if (timer || !isTTY) return;
    enableMouse();
    timer = setInterval(() => {
      spinnerIdx++;
      render();
    }, SPINNER_INTERVAL);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    update(lines: FrameLine[]) {
      statusLines = lines;
      if (!isTTY) {
        const elapsed = formatElapsed(Date.now() - startTime);
        for (const line of lines) {
          const prefix = line.spinner ? `[${elapsed}] ` : "  ";
          process.stderr.write(`${prefix}${line.text}\n`);
        }
        return;
      }
      render();
      startTimer();
    },

    log(text: string, final = true, kind: LogKind = "output") {
      const clean = sanitize(text);
      if (!clean) return;

      // Finalize any trailing partial thinking entry so it stays in the
      // buffer as a complete scrollback record before output begins.
      if (
        kind === "output" &&
        logBuffer.length > 0 &&
        logBuffer[logBuffer.length - 1]?.kind === "thinking"
      ) {
        logFinalized[logBuffer.length - 1] = true;
      }

      const lastIdx = logBuffer.length - 1;
      const lastIsPartial = lastIdx >= 0 && !logFinalized[lastIdx];
      const lastSameKind = lastIdx >= 0 && logBuffer[lastIdx]?.kind === kind;

      if (lastIsPartial && lastSameKind) {
        // Update the existing partial entry
        logBuffer[lastIdx] = { text: clean, kind };
        if (final) logFinalized[lastIdx] = true;
      } else {
        // Append new entry
        logBuffer.push({ text: clean, kind });
        logFinalized[logBuffer.length - 1] = final;
      }

      if (final && !isTTY) {
        const prefix = kind === "thinking" ? "  (thinking) " : "  ";
        process.stderr.write(`${prefix}${chalk.dim(clean)}\n`);
      }
    },

    stop(lines: FrameLine[]) {
      if (stopped) return;
      stopped = true;
      stopTimer();
      disableMouse();

      const elapsed = formatElapsed(Date.now() - startTime);

      if (!isTTY) {
        for (const line of lines) {
          process.stderr.write(`  ${line.text}\n`);
        }
        process.stderr.write(`  ${chalk.dim(`Done in ${elapsed}`)}\n`);
        return;
      }

      const safeText = sanitize(lines[0]?.text ?? "Done");
      const stopRow = row(
        `${chalk.green("✓")} ${truncate(safeText, inner - 8)}  ${chalk.dim(elapsed)}`,
      );

      let output = "";
      if (!firstRender && prevTotalRows > 0) {
        output += `\x1b[${prevTotalRows}A`;
      }
      output += [top, stopRow, bottom].join("\n") + "\n";
      // Erase all leftover frame content below the collapsed stop frame
      output += "\x1b[J";
      output += "\x1b[?25h"; // show cursor

      process.stderr.write(output);
    },
  };
}
