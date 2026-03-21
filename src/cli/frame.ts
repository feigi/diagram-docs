/**
 * Live-updating boxed frame for stderr output.
 * Fixed-size panel with spinner, status line, and scrolling log area.
 * Falls back to static output when stderr is not a TTY.
 */
import chalk from "chalk";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;
const MIN_LOG_LINES = 3;
const FRAME_OVERHEAD = 5; // top + 2 status rows + separator + bottom

function getFrameWidth(): number {
  if (process.stderr.isTTY && process.stderr.columns) {
    return Math.min(process.stderr.columns, 120);
  }
  return 80;
}

/** Strip newlines and collapse whitespace to produce a single safe line. */
function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export interface FrameLine {
  text: string;
  spinner?: boolean;
}

export interface Frame {
  update(lines: FrameLine[]): void;
  log(text: string, final?: boolean): void;
  stop(lines: FrameLine[]): void;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function padRight(text: string, width: number): string {
  const visible = stripAnsi(text).length;
  const padding = Math.max(0, width - visible);
  return text + " ".repeat(padding);
}

function getMaxLogLines(): number {
  const termRows = process.stderr.isTTY && process.stderr.rows ? process.stderr.rows : 24;
  return Math.max(MIN_LOG_LINES, termRows - FRAME_OVERHEAD);
}

export function createFrame(title: string): Frame {
  const isTTY = process.stderr.isTTY;
  const frameWidth = getFrameWidth();
  const inner = frameWidth - 2;
  const startTime = Date.now();
  const STATUS_ROWS = 2;

  let spinnerIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let firstRender = true;
  let stopped = false;
  let prevTotalRows = 0;

  let statusLines: FrameLine[] = [];
  const logBuffer: string[] = [];
  const logFinalized: Record<number, boolean> = {};

  // Pre-build static parts
  const titleStr = ` ${title} `;
  const topFill = inner - titleStr.length - 1;
  const top = chalk.dim("┌─") + chalk.bold(titleStr) + chalk.dim("─".repeat(Math.max(0, topFill)) + "┐");
  const bottom = chalk.dim("└" + "─".repeat(inner) + "┘");

  function row(content: string): string {
    return chalk.dim("│") + " " + padRight(content, inner - 2) + " " + chalk.dim("│");
  }

  function emptyRow(): string {
    return chalk.dim("│") + " ".repeat(inner) + chalk.dim("│");
  }

  function render() {
    const elapsed = Date.now() - startTime;
    const elapsedStr = formatElapsed(elapsed);
    const spinner = chalk.cyan(SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length]);

    // Compute log area height: grow with content, cap at terminal height
    const maxLogLines = getMaxLogLines();
    const logLines = Math.max(MIN_LOG_LINES, Math.min(logBuffer.length, maxLogLines));
    const totalRows = 1 + STATUS_ROWS + 1 + logLines + 1; // top + status + blank + logs + bottom

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

    // Blank separator
    rows.push(emptyRow());

    // Log rows — grows with content up to terminal height
    const visibleLogs = logBuffer.slice(-logLines);
    for (let i = 0; i < logLines; i++) {
      const entry = visibleLogs[i];
      if (!entry) {
        rows.push(emptyRow());
      } else {
        rows.push(row(chalk.dim(`    ${truncate(entry, inner - 8)}`)));
      }
    }

    const frame = [top, ...rows, bottom].join("\n");

    // Build a single output string: cursor movement + frame
    let output = "";
    if (firstRender) {
      // Reserve space so terminal scrolling doesn't break cursor math
      output += "\n".repeat(totalRows) + `\x1b[${totalRows}A`;
      firstRender = false;
    } else {
      // Move up by previous frame height
      output += `\x1b[${prevTotalRows}A`;
    }
    output += "\x1b[?25l"; // hide cursor
    output += frame + "\n";
    prevTotalRows = totalRows;

    process.stderr.write(output);
  }

  function startTimer() {
    if (timer || !isTTY) return;
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

    log(text: string, final = true) {
      const clean = sanitize(text);
      if (!clean) return;
      const lastIdx = logBuffer.length - 1;
      const lastIsPartial = lastIdx >= 0 && !logFinalized[lastIdx];

      if (lastIsPartial) {
        // Update the existing partial entry
        logBuffer[lastIdx] = clean;
        if (final) logFinalized[lastIdx] = true;
      } else {
        // Append new entry
        logBuffer.push(clean);
        logFinalized[logBuffer.length - 1] = final;
      }

      if (final && !isTTY) {
        process.stderr.write(`  ${chalk.dim(clean)}\n`);
      }
    },

    stop(lines: FrameLine[]) {
      if (stopped) return;
      stopped = true;
      stopTimer();

      if (!isTTY) {
        for (const line of lines) {
          process.stderr.write(`  ${line.text}\n`);
        }
        return;
      }

      const elapsed = formatElapsed(Date.now() - startTime);
      const safeText = sanitize(lines[0]?.text ?? "Done");
      const stopRow = row(
        `${chalk.green("✓")} ${truncate(safeText, inner - 8)}  ${chalk.dim(elapsed)}`,
      );

      let output = "";
      if (!firstRender && prevTotalRows > 0) {
        output += `\x1b[${prevTotalRows}A`;
      }
      output += [top, stopRow, bottom].join("\n") + "\n";
      // Clear any leftover rows from the previous (taller) frame
      const stopHeight = 3; // top + stopRow + bottom
      const leftover = prevTotalRows - stopHeight;
      for (let i = 0; i < leftover; i++) {
        output += "\x1b[2K\n"; // clear line, move down
      }
      output += "\x1b[?25h"; // show cursor

      process.stderr.write(output);
    },
  };
}
