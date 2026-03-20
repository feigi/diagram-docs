import { describe, it, expect } from "vitest";
import { extractPythonSymbols } from "../../src/analyzers/python/symbols.js";

describe("extractPythonSymbols", () => {
  it("extracts class with inheritance", () => {
    const source = `
class BaseService:
    pass

class OrderService(BaseService):
    def __init__(self, repo: OrderRepository):
        self.repo = repo

    def create_order(self, request: dict) -> Order:
        return self.repo.save(request)
`;
    const result = extractPythonSymbols([{ path: "service.py", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderService", kind: "class" }),
    );
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "BaseService", kind: "class" }),
    );
    const rel = result.relationships.find((r) => r.kind === "extends");
    expect(rel).toBeDefined();
    expect(rel!.sourceId).toContain("order");
    expect(rel!.targetId).toContain("base");
  });

  it("filters relationships to unknown parent classes", () => {
    const source = `
class OrderService(ExternalBase):
    pass
`;
    const result = extractPythonSymbols([{ path: "service.py", content: source }]);
    expect(result.symbols).toHaveLength(1);
    expect(result.relationships).toHaveLength(0);
  });

  it("extracts top-level functions", () => {
    const source = `
def process_payment(order_id: str, amount: float) -> bool:
    return True

def validate_order(order: dict) -> bool:
    return True
`;
    const result = extractPythonSymbols([{ path: "utils.py", content: source }]);
    expect(result.symbols).toHaveLength(2);
    expect(result.symbols[0].kind).toBe("function");
  });

  it("ignores private methods inside classes", () => {
    const source = `
class Foo:
    def public_method(self):
        pass

    def _private_method(self):
        pass
`;
    const result = extractPythonSymbols([{ path: "foo.py", content: source }]);
    // Only the class itself should be a symbol, not its methods
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe("Foo");
  });
});
