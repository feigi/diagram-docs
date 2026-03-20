import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema", () => {
  it("parses empty config with defaults", () => {
    const config = configSchema.parse({});
    expect(config.agent.enabled).toBe(true);
    expect(config.output.docsDir).toBe("docs");
    expect(config.abstraction.codeLevel.minSymbols).toBe(2);
    expect(config.overrides).toEqual({});
  });

  it("rejects levels and submodules (removed fields)", () => {
    const config = configSchema.parse({
      levels: { context: true },
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
});
