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
