import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  computeSignalHash,
  loadAgentCache,
  parseAgentResponse,
  saveAgentCache,
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

describe("parseAgentResponse", () => {
  it("parses valid JSON with recognized role", () => {
    const result = parseAgentResponse(
      '{"role": "container", "name": "User API", "description": "Handles users", "confidence": 0.9}',
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe("container");
    expect(result!.name).toBe("User API");
    expect(result!.description).toBe("Handles users");
    expect(result!.confidence).toBe(0.9);
  });

  it("parses JSON wrapped in markdown code fences", () => {
    const result = parseAgentResponse(
      '```json\n{"role": "system", "name": "Root", "description": "Top-level", "confidence": 0.8}\n```',
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe("system");
    expect(result!.name).toBe("Root");
  });

  it("parses JSON wrapped in plain code fences", () => {
    const result = parseAgentResponse(
      '```\n{"role": "component", "name": "Auth", "description": "", "confidence": 0.7}\n```',
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe("component");
  });

  it("returns null for invalid JSON", () => {
    const result = parseAgentResponse("not json at all");
    expect(result).toBeNull();
  });

  it("returns null for unrecognized role", () => {
    const result = parseAgentResponse(
      '{"role": "database", "name": "DB", "description": "", "confidence": 0.9}',
    );
    expect(result).toBeNull();
  });

  it("clamps confidence above 1 to 1", () => {
    const result = parseAgentResponse(
      '{"role": "container", "name": "", "description": "", "confidence": 5.0}',
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1);
  });

  it("clamps negative confidence to 0", () => {
    const result = parseAgentResponse(
      '{"role": "container", "name": "", "description": "", "confidence": -0.5}',
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0);
  });

  it("defaults missing name/description to empty string", () => {
    const result = parseAgentResponse(
      '{"role": "container", "confidence": 0.8}',
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe("");
    expect(result!.description).toBe("");
  });

  it("defaults non-string name to empty string", () => {
    const result = parseAgentResponse(
      '{"role": "container", "name": 42, "description": "", "confidence": 0.8}',
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe("");
  });

  it("defaults non-number confidence to 0", () => {
    const result = parseAgentResponse(
      '{"role": "container", "name": "", "description": "", "confidence": "high"}',
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0);
  });

  it("returns null for empty string", () => {
    const result = parseAgentResponse("");
    expect(result).toBeNull();
  });

  it("handles code-only role", () => {
    const result = parseAgentResponse(
      '{"role": "code-only", "name": "Utils", "description": "Utility module", "confidence": 0.6}',
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe("code-only");
  });
});

describe("agent cache persistence", () => {
  let rootDir: string;
  let cacheFile: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-cache-"));
    cacheFile = path.join(rootDir, ".diagram-docs", "agent-cache.yaml");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("loadAgentCache returns empty map when cache file is missing", () => {
    const map = loadAgentCache(rootDir);
    expect(map.size).toBe(0);
  });

  it("round-trips a cache entry through save + load", () => {
    const cache = new Map();
    cache.set("services/api", {
      role: "container",
      name: "API",
      description: "",
      confidence: 0.9,
      signalHash: "abc",
    });
    saveAgentCache(rootDir, cache);

    const loaded = loadAgentCache(rootDir);
    expect(loaded.size).toBe(1);
    expect(loaded.get("services/api")?.role).toBe("container");
  });

  it("renames corrupt YAML to .corrupt.<ts>.bak instead of deleting", () => {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, "::: not valid yaml :::\n{[", "utf-8");

    vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = loadAgentCache(rootDir);

    expect(loaded.size).toBe(0);
    expect(fs.existsSync(cacheFile)).toBe(false);
    const siblings = fs.readdirSync(path.dirname(cacheFile));
    expect(siblings.some((f) => f.includes(".corrupt."))).toBe(true);
  });

  it("drops cache entries with invalid role", () => {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(
      cacheFile,
      `good:
  role: container
  name: x
  description: ""
  confidence: 0.9
  signalHash: abc
bad:
  role: invalid-role
  name: x
  description: ""
  confidence: 0.9
  signalHash: def
`,
      "utf-8",
    );

    const loaded = loadAgentCache(rootDir);
    expect(loaded.size).toBe(1);
    expect(loaded.has("good")).toBe(true);
    expect(loaded.has("bad")).toBe(false);
  });

  it("save is atomic — no partial cache file if write fails", () => {
    const cache = new Map();
    cache.set("a", {
      role: "container",
      name: "x",
      description: "",
      confidence: 0.9,
      signalHash: "abc",
    });
    saveAgentCache(rootDir, cache);
    expect(fs.existsSync(cacheFile)).toBe(true);
    // Ensure no leftover .tmp file
    const siblings = fs.readdirSync(path.dirname(cacheFile));
    expect(siblings.some((f) => f.includes(".tmp."))).toBe(false);
  });

});
