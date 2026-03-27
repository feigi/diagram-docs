import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";

// We test the interactive-setup module by mocking commandExists and readline
// and verify the config-writing helpers directly.

import {
  writeDefaultConfig,
  updateConfigLLM,
  loadConfig,
} from "../../src/config/loader.js";
import {
  parseCopilotHelpConfigOutput,
  parseClaudeModelListOutput,
} from "../../src/cli/interactive-setup.js";

describe("updateConfigLLM", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("patches llm.provider and llm.model into existing config", () => {
    const { configPath } = writeDefaultConfig(tmpDir);
    const before = parseYaml(fs.readFileSync(configPath, "utf-8"));
    expect(before.llm?.provider).toBeUndefined(); // provider not written by default
    expect(before.llm?.model).toBeUndefined(); // model not written by default

    const config = updateConfigLLM(configPath, "copilot", "gpt-4o");
    expect(config.llm.provider).toBe("copilot");
    expect(config.llm.model).toBe("gpt-4o");

    // Verify it was persisted to disk
    const onDisk = parseYaml(fs.readFileSync(configPath, "utf-8"));
    expect(onDisk.llm.provider).toBe("copilot");
    expect(onDisk.llm.model).toBe("gpt-4o");
  });

  it("preserves existing config sections when patching llm", () => {
    const { configPath } = writeDefaultConfig(tmpDir);
    updateConfigLLM(configPath, "claude-code", "haiku");

    const onDisk = parseYaml(fs.readFileSync(configPath, "utf-8"));
    // Original sections still present
    expect(onDisk.system).toBeDefined();
    expect(onDisk.scan).toBeDefined();
    expect(onDisk.output).toBeDefined();
    // LLM section updated
    expect(onDisk.llm.provider).toBe("claude-code");
    expect(onDisk.llm.model).toBe("haiku");
  });

  it("overwrites previous llm config on repeated calls", () => {
    const { configPath } = writeDefaultConfig(tmpDir);
    updateConfigLLM(configPath, "claude-code", "sonnet");
    updateConfigLLM(configPath, "copilot", "gpt-4.1");

    const onDisk = parseYaml(fs.readFileSync(configPath, "utf-8"));
    expect(onDisk.llm.provider).toBe("copilot");
    expect(onDisk.llm.model).toBe("gpt-4.1");
  });
});

describe("parseCopilotHelpConfigOutput", () => {
  it("extracts model IDs from the model config section", () => {
    const output = [
      "Configuration Settings:",
      "",
      "  `allowed_urls`: list of URLs ...",
      "",
      "  `model`: AI model to use for Copilot CLI; can be changed with /model.",
      '    - "claude-sonnet-4.6"',
      '    - "gpt-5.2"',
      '    - "gpt-4.1"',
      "",
      "  `mouse`: whether to enable mouse support; defaults to `true`.",
    ].join("\n");

    expect(parseCopilotHelpConfigOutput(output)).toEqual([
      "claude-sonnet-4.6",
      "gpt-5.2",
      "gpt-4.1",
    ]);
  });

  it("stops collecting at the next config key", () => {
    const output = [
      "  `model`: AI model to use.",
      '    - "gpt-5.2"',
      '    - "gpt-4.1"',
      "  `mouse`: whether to enable mouse.",
      '    - "not-a-model"',
    ].join("\n");

    expect(parseCopilotHelpConfigOutput(output)).toEqual([
      "gpt-5.2",
      "gpt-4.1",
    ]);
  });

  it("returns empty array when no model section exists", () => {
    expect(parseCopilotHelpConfigOutput("  `mouse`: foo\n")).toEqual([]);
  });
});

describe("parseClaudeModelListOutput", () => {
  it("extracts model IDs skipping headers and decorations", () => {
    const output = [
      "Available Models",
      "──────────────────",
      "sonnet    Claude Sonnet",
      "haiku     Claude Haiku",
      "opus      Claude Opus",
    ].join("\n");

    expect(parseClaudeModelListOutput(output)).toEqual([
      "sonnet",
      "haiku",
      "opus",
    ]);
  });

  it("returns empty array for empty output", () => {
    expect(parseClaudeModelListOutput("")).toEqual([]);
  });
});

describe("loadConfig configCreated flag", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns configCreated=true when no config exists", () => {
    const result = loadConfig();
    expect(result.configCreated).toBe(true);
    // Config should NOT be written to disk yet (deferred until after prompt)
    expect(fs.existsSync(path.join(tmpDir, "diagram-docs.yaml"))).toBe(false);
  });

  it("returns configCreated=false when config already exists", () => {
    writeDefaultConfig(tmpDir);
    const result = loadConfig();
    expect(result.configCreated).toBe(false);
  });

  it("returns configCreated=false when explicit path is given", () => {
    const { configPath } = writeDefaultConfig(tmpDir);
    const result = loadConfig(configPath);
    expect(result.configCreated).toBe(false);
  });
});
