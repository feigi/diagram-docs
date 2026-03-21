/**
 * Live-updating boxed frame for stderr output.
 * Shows a bordered panel with spinner animation, elapsed timer, and status lines.
 * Falls back to static output when stderr is not a TTY.
 */
import chalk from "chalk";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;
const MIN_WIDTH = 36;

export interface FrameLine {
  text: string;
  spinner?: boolean;
}

export interface Frame {
  update(lines: FrameLine[]): void;
  stop(lines: FrameLine[]): void;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function pad(text: string, width: number): string {
  const visible = stripAnsi(text);
  const padding = Math.max(0, width - visible.length);
  return text + " ".repeat(padding);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderBox(title: string, lines: string[], width: number): string {
  const inner = width - 2; // subtract left and right border chars
  const titleStr = ` ${title} `;
  const topFill = inner - titleStr.length - 1; // -1 for leading ─
  const top = chalk.dim("┌─") + chalk.bold(titleStr) + chalk.dim("─".repeat(Math.max(0, topFill)) + "┐");
  const bottom = chalk.dim("└" + "─".repeat(inner) + "┘");

  const rows = lines.map((line) => {
    return chalk.dim("│") + " " + pad(line, inner - 2) + " " + chalk.dim("│");
  });

  return [top, ...rows, bottom].join("\n");
}

function createTTYFrame(title: string): Frame {
  const isTTY = process.stderr.isTTY;
  const startTime = Date.now();
  let spinnerIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastLineCount = 0;
  let currentLines: FrameLine[] = [];
  let stopped = false;

  function render() {
    const elapsed = Date.now() - startTime;
    const elapsedStr = formatElapsed(elapsed);
    const spinner = chalk.cyan(SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length]);

    const rendered = currentLines.map((line) => {
      if (line.spinner) {
        return `${spinner} ${line.text}  ${chalk.dim(elapsedStr)}`;
      }
      return `  ${line.text}`;
    });

    // Determine box width from content
    const contentWidths = rendered.map((l) => stripAnsi(l).length + 4); // +4 for borders + padding
    const width = Math.max(MIN_WIDTH, ...contentWidths);

    const box = renderBox(title, rendered, width);

    // Move cursor up to overwrite previous frame
    if (lastLineCount > 0) {
      process.stderr.write(`\x1b[${lastLineCount}A\x1b[0J`);
    }

    process.stderr.write(box + "\n");
    lastLineCount = currentLines.length + 2; // lines + top + bottom border
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
      currentLines = lines;
      if (!isTTY) {
        // Non-TTY: print static lines
        const elapsed = formatElapsed(Date.now() - startTime);
        for (const line of lines) {
          const prefix = line.spinner ? `[${elapsed}] ` : "  ";
          process.stderr.write(`${prefix}${line.text}\n`);
        }
        return;
      }
      render();
      if (lines.some((l) => l.spinner)) {
        startTimer();
      } else {
        stopTimer();
      }
    },

    stop(lines: FrameLine[]) {
      if (stopped) return;
      stopped = true;
      stopTimer();
      currentLines = lines;

      if (!isTTY) {
        for (const line of lines) {
          process.stderr.write(`  ${line.text}\n`);
        }
        return;
      }

      // Final render with checkmark instead of spinner
      const rendered = lines.map((line) => {
        return `${chalk.green("✓")} ${line.text}`;
      });

      const contentWidths = rendered.map((l) => stripAnsi(l).length + 4);
      const width = Math.max(MIN_WIDTH, ...contentWidths);
      const box = renderBox(title, rendered, width);

      if (lastLineCount > 0) {
        process.stderr.write(`\x1b[${lastLineCount}A\x1b[0J`);
      }
      process.stderr.write(box + "\n");
    },
  };
}

export function createFrame(title: string): Frame {
  return createTTYFrame(title);
}
