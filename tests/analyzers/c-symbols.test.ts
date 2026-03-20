import { describe, it, expect } from "vitest";
import { extractCSymbols } from "../../src/analyzers/c/symbols.js";

describe("extractCSymbols", () => {
  it("extracts struct definition", () => {
    const source = `
typedef struct {
    int id;
    char name[64];
    float amount;
} Order;
`;
    const result = extractCSymbols([{ path: "order.h", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "Order", kind: "struct" }),
    );
  });

  it("extracts function declarations from headers", () => {
    const source = `
Order* order_create(const char* name, float amount);
void order_destroy(Order* order);
int order_validate(const Order* order);
`;
    const result = extractCSymbols([{ path: "order.h", content: source }]);
    expect(result.symbols.filter((s) => s.kind === "function")).toHaveLength(3);
  });

  it("detects param-type relationships", () => {
    const header = `
typedef struct { int id; } Order;
void order_process(Order* order);
`;
    const result = extractCSymbols([{ path: "order.h", content: header }]);
    const rel = result.relationships.find((r) => r.kind === "param-type");
    expect(rel).toBeDefined();
  });
});
