import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema strict mode (reject typos)", () => {
  it("rejects unknown key at top level", () => {
    expect(() => configSchema.parse({ levls: { code: true } })).toThrow(
      /unrecognized|Unrecognized/,
    );
  });

  it("rejects unknown key inside levels (e.g. 'cod' typo)", () => {
    expect(() =>
      configSchema.parse({ levels: { code: true, cod: true } }),
    ).toThrow(/unrecognized|Unrecognized/);
  });

  it("rejects unknown key inside code", () => {
    expect(() => configSchema.parse({ code: { minElementz: 3 } })).toThrow(
      /unrecognized|Unrecognized/,
    );
  });

  it("rejects unknown key inside scan", () => {
    expect(() => configSchema.parse({ scan: { excluded: ["foo"] } })).toThrow(
      /unrecognized|Unrecognized/,
    );
  });

  it("still accepts valid configs", () => {
    expect(() =>
      configSchema.parse({
        levels: { context: true, container: true, component: true, code: true },
        code: { minElements: 3, includePrivate: true },
      }),
    ).not.toThrow();
  });
});
