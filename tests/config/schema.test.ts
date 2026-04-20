import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema output.generators", () => {
  it("defaults to ['d2']", () => {
    const cfg = configSchema.parse({});
    expect(cfg.output.generators).toEqual(["d2"]);
  });

  it("accepts ['d2']", () => {
    const cfg = configSchema.parse({ output: { generators: ["d2"] } });
    expect(cfg.output.generators).toEqual(["d2"]);
  });

  it("accepts ['d2', 'drawio']", () => {
    const cfg = configSchema.parse({
      output: { generators: ["d2", "drawio"] },
    });
    expect(cfg.output.generators).toEqual(["d2", "drawio"]);
  });

  it("rejects unknown generator", () => {
    expect(() =>
      configSchema.parse({ output: { generators: ["foo"] } }),
    ).toThrow();
  });
});
