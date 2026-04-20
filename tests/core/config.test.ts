import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("configSchema", () => {
  it("parses empty config with defaults", () => {
    const config = configSchema.parse({});
    expect(config.agent.enabled).toBe(true);
    expect(config.output.docsDir).toBe("docs");
    expect(config.abstraction.codeLevel.minSymbols).toBe(2);
    expect(config.overrides).toEqual({});
  });

  it("strips unknown fields like levels and submodules", () => {
    const config = configSchema.parse({
      levels: { context: true, component: true },
      submodules: { enabled: true },
    });
    expect((config as Record<string, unknown>).levels).toBeUndefined();
    expect((config as Record<string, unknown>).submodules).toBeUndefined();
  });

  it("parses agent config", () => {
    const config = configSchema.parse({
      agent: { enabled: false, provider: "openai", model: "gpt-4o" },
    });
    expect(config.agent.enabled).toBe(false);
    expect(config.agent.provider).toBe("openai");
    expect(config.agent.model).toBe("gpt-4o");
  });

  it("parses overrides", () => {
    const config = configSchema.parse({
      overrides: {
        "services/order-service": {
          role: "container",
          name: "Order Service",
          description: "Handles orders",
        },
        "libs/utils": { role: "skip" },
      },
    });
    expect(config.overrides["services/order-service"].role).toBe("container");
    expect(config.overrides["libs/utils"].role).toBe("skip");
  });

  it("validates role enum in overrides", () => {
    expect(() =>
      configSchema.parse({
        overrides: { foo: { role: "invalid" } },
      }),
    ).toThrow();
  });

  it("validates agent provider enum", () => {
    expect(() =>
      configSchema.parse({
        agent: { provider: "google" },
      }),
    ).toThrow();
  });
});

describe("config migration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-config-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("migrates output.dir to output.docsDir stripping /architecture suffix", async () => {
    const configPath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(configPath, 'output:\n  dir: "my-docs/architecture"\n');

    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadConfig } = await import("../../src/config/loader.js");
    const { config } = loadConfig(configPath);

    expect(config.output.docsDir).toBe("my-docs");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("output.dir"),
    );
  });

  it("migrates output.dir without /architecture suffix as-is", async () => {
    const configPath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(configPath, 'output:\n  dir: "custom-output"\n');

    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadConfig } = await import("../../src/config/loader.js");
    const { config } = loadConfig(configPath);

    expect(config.output.docsDir).toBe("custom-output");
  });

  it("does not migrate when docsDir is already set", async () => {
    const configPath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(
      configPath,
      'output:\n  dir: "old-path"\n  docsDir: "new-path"\n',
    );

    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadConfig } = await import("../../src/config/loader.js");
    const { config } = loadConfig(configPath);

    expect(config.output.docsDir).toBe("new-path");
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("output.dir"),
    );
  });
});
