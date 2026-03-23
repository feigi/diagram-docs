/**
 * Shared terminal utilities used by Frame and ParallelProgress components.
 */

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
