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
