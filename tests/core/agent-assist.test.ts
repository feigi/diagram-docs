import { describe, it, expect } from "vitest";
import {
  computeSignalHash,
} from "../../src/core/agent-assist.js";
import type { FolderSignals } from "../../src/core/classifier.js";

const mockSignals: FolderSignals = {
  buildFiles: ["pom.xml"],
  childrenWithBuildFiles: 0,
  infraFiles: ["Dockerfile"],
  sourceFileCount: 25,
  sourceLanguages: ["java"],
  hasPackageStructure: true,
  hasSourceFiles: true,
  isPackageDir: false,
  depth: 1,
  childFolderNames: ["src", "test"],
  readmeSnippet: "Order service handles...",
};

describe("computeSignalHash", () => {
  it("returns consistent hash for same signals", () => {
    const h1 = computeSignalHash(mockSignals);
    const h2 = computeSignalHash(mockSignals);
    expect(h1).toBe(h2);
  });

  it("returns different hash for different signals", () => {
    const h1 = computeSignalHash(mockSignals);
    const h2 = computeSignalHash({ ...mockSignals, sourceFileCount: 100 });
    expect(h1).not.toBe(h2);
  });

  it("returns a 16-char hex string", () => {
    const hash = computeSignalHash(mockSignals);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});
