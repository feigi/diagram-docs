import { describe, it, expect } from "vitest";
import rawSchema from "../../src/schemas/raw-structure.schema.json" with { type: "json" };
import modelSchema from "../../src/schemas/architecture-model.schema.json" with { type: "json" };

describe("JSON schemas include code-level fields", () => {
  it("raw-structure schema allows codeElements on a module", () => {
    const modProps =
      (rawSchema as any).definitions?.ScannedModule?.properties ??
      (rawSchema as any).properties?.applications?.items?.properties?.modules
        ?.items?.properties;
    expect(modProps).toBeDefined();
    expect(modProps.codeElements).toBeDefined();
    expect(modProps.codeElements.type).toBe("array");
  });

  it("architecture-model schema defines codeElements and codeRelationships", () => {
    expect((modelSchema as any).properties.codeElements).toBeDefined();
    expect((modelSchema as any).properties.codeRelationships).toBeDefined();
  });
});
