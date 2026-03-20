import { describe, it, expect } from "vitest";
import { generateCodeDiagram } from "../../src/generator/d2/code.js";
import type { ModuleSymbols } from "../../src/analyzers/types.js";

describe("generateCodeDiagram", () => {
  it("generates D2 for classes with inheritance", () => {
    const symbols: ModuleSymbols = {
      symbols: [
        { id: "order", name: "Order", kind: "class", visibility: "public" },
        { id: "premium-order", name: "PremiumOrder", kind: "class", visibility: "public" },
      ],
      relationships: [
        { sourceId: "premium-order", targetId: "order", kind: "extends" },
      ],
    };
    const d2 = generateCodeDiagram(symbols, "Order Service");
    expect(d2).toContain("order:");
    expect(d2).toContain("premium_order:");
    expect(d2).toContain("premium_order -> order");
    expect(d2).toContain("extends");
  });

  it("generates D2 for interfaces and implementations", () => {
    const symbols: ModuleSymbols = {
      symbols: [
        { id: "repo", name: "OrderRepository", kind: "interface" },
        { id: "repo-impl", name: "OrderRepositoryImpl", kind: "class" },
      ],
      relationships: [
        { sourceId: "repo-impl", targetId: "repo", kind: "implements" },
      ],
    };
    const d2 = generateCodeDiagram(symbols, "Order Module");
    expect(d2).toContain("interface");
    expect(d2).toContain("implements");
  });

  it("uses code class for styling", () => {
    const symbols: ModuleSymbols = {
      symbols: [
        { id: "foo", name: "Foo", kind: "class" },
      ],
      relationships: [],
    };
    const d2 = generateCodeDiagram(symbols, "Test");
    expect(d2).toContain("class: code");
  });
});
