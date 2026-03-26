import { describe, it, expect } from "vitest";
import {
  isProgrammingError,
  isSystemResourceError,
  rethrowIfFatal,
  isRecoverableLLMError,
  LLMCallError,
  LLMOutputError,
  LLMUnavailableError,
} from "../../src/core/llm-model-builder.js";

describe("isProgrammingError", () => {
  it("returns true for TypeError", () => {
    expect(isProgrammingError(new TypeError("x"))).toBe(true);
  });

  it("returns true for RangeError", () => {
    expect(isProgrammingError(new RangeError("x"))).toBe(true);
  });

  it("returns true for ReferenceError", () => {
    expect(isProgrammingError(new ReferenceError("x"))).toBe(true);
  });

  it("returns true for SyntaxError", () => {
    expect(isProgrammingError(new SyntaxError("x"))).toBe(true);
  });

  it("returns true for URIError", () => {
    expect(isProgrammingError(new URIError("x"))).toBe(true);
  });

  it("returns true for EvalError", () => {
    expect(isProgrammingError(new EvalError("x"))).toBe(true);
  });

  it("returns false for generic Error", () => {
    expect(isProgrammingError(new Error("x"))).toBe(false);
  });

  it("returns false for LLMCallError", () => {
    expect(isProgrammingError(new LLMCallError("x"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isProgrammingError("string")).toBe(false);
    expect(isProgrammingError(42)).toBe(false);
    expect(isProgrammingError(null)).toBe(false);
    expect(isProgrammingError(undefined)).toBe(false);
  });
});

describe("isSystemResourceError", () => {
  function makeErrnoError(code: string): NodeJS.ErrnoException {
    const err = new Error(`${code} error`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  }

  it("returns true for E2BIG", () => {
    expect(isSystemResourceError(makeErrnoError("E2BIG"))).toBe(true);
  });

  it("returns true for ENOMEM", () => {
    expect(isSystemResourceError(makeErrnoError("ENOMEM"))).toBe(true);
  });

  it("returns true for ENOSPC", () => {
    expect(isSystemResourceError(makeErrnoError("ENOSPC"))).toBe(true);
  });

  it("returns true for EMFILE", () => {
    expect(isSystemResourceError(makeErrnoError("EMFILE"))).toBe(true);
  });

  it("returns true for ENFILE", () => {
    expect(isSystemResourceError(makeErrnoError("ENFILE"))).toBe(true);
  });

  it("returns false for ENOENT", () => {
    expect(isSystemResourceError(makeErrnoError("ENOENT"))).toBe(false);
  });

  it("returns false for EACCES", () => {
    expect(isSystemResourceError(makeErrnoError("EACCES"))).toBe(false);
  });

  it("returns false for generic Error without code", () => {
    expect(isSystemResourceError(new Error("x"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isSystemResourceError("ENOMEM")).toBe(false);
    expect(isSystemResourceError(null)).toBe(false);
  });
});

describe("rethrowIfFatal", () => {
  it("rethrows programming errors", () => {
    expect(() => rethrowIfFatal(new TypeError("x"))).toThrow(TypeError);
  });

  it("rethrows system resource errors", () => {
    const err = new Error("ENOMEM") as NodeJS.ErrnoException;
    err.code = "ENOMEM";
    expect(() => rethrowIfFatal(err)).toThrow(err);
  });

  it("rethrows E2BIG (argument list too long)", () => {
    const err = new Error("E2BIG") as NodeJS.ErrnoException;
    err.code = "E2BIG";
    expect(() => rethrowIfFatal(err)).toThrow(err);
  });

  it("does not throw for generic Error", () => {
    expect(() => rethrowIfFatal(new Error("x"))).not.toThrow();
  });

  it("does not throw for LLMCallError", () => {
    expect(() => rethrowIfFatal(new LLMCallError("x"))).not.toThrow();
  });

  it("does not throw for LLMOutputError", () => {
    expect(() => rethrowIfFatal(new LLMOutputError("x"))).not.toThrow();
  });

  it("does not throw for non-Error values", () => {
    expect(() => rethrowIfFatal("string")).not.toThrow();
    expect(() => rethrowIfFatal(null)).not.toThrow();
    expect(() => rethrowIfFatal(undefined)).not.toThrow();
  });
});

describe("isRecoverableLLMError", () => {
  it("returns true for LLMCallError", () => {
    expect(isRecoverableLLMError(new LLMCallError("x"))).toBe(true);
  });

  it("returns true for LLMOutputError", () => {
    expect(isRecoverableLLMError(new LLMOutputError("x"))).toBe(true);
  });

  it("returns false for LLMUnavailableError", () => {
    expect(isRecoverableLLMError(new LLMUnavailableError("x"))).toBe(false);
  });

  it("returns false for generic Error", () => {
    expect(isRecoverableLLMError(new Error("x"))).toBe(false);
  });

  it("returns false for TypeError", () => {
    expect(isRecoverableLLMError(new TypeError("x"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRecoverableLLMError("string")).toBe(false);
    expect(isRecoverableLLMError(null)).toBe(false);
  });
});
