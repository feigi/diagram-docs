import { describe, it, expect } from "vitest";
import { extractJavaSymbols } from "../../src/analyzers/java/symbols.js";

describe("extractJavaSymbols", () => {
  it("extracts class declaration", () => {
    const source = `
package com.example;

public class OrderService {
  private final OrderRepository repo;

  public Order createOrder(CreateOrderRequest request) {
    return repo.save(new Order(request));
  }
}`;
    const result = extractJavaSymbols([{ path: "OrderService.java", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderService", kind: "class", visibility: "public" }),
    );
  });

  it("extracts interface", () => {
    const source = `
package com.example;

public interface OrderRepository {
  Order save(Order order);
  Order findById(String id);
}`;
    const result = extractJavaSymbols([{ path: "OrderRepository.java", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderRepository", kind: "interface" }),
    );
  });

  it("extracts enum", () => {
    const source = `
package com.example;

public enum OrderStatus {
  PENDING, CONFIRMED, SHIPPED, DELIVERED
}`;
    const result = extractJavaSymbols([{ path: "OrderStatus.java", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "OrderStatus", kind: "enum" }),
    );
  });

  it("extracts record", () => {
    const source = `
package com.example;

public record CreateOrderRequest(String item, int quantity) {}`;
    const result = extractJavaSymbols([{ path: "CreateOrderRequest.java", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "CreateOrderRequest", kind: "class", visibility: "public" }),
    );
  });

  it("detects extends relationship", () => {
    const source = `
public class PremiumOrder extends Order {
}`;
    const result = extractJavaSymbols([
      { path: "Order.java", content: "public class Order {}" },
      { path: "PremiumOrder.java", content: source },
    ]);
    const rel = result.relationships.find((r) => r.kind === "extends");
    expect(rel).toBeDefined();
    expect(rel!.sourceId).toContain("premiumorder");
    expect(rel!.targetId).toContain("order");
  });

  it("detects implements relationship", () => {
    const source = `
public class OrderServiceImpl implements OrderService {
}`;
    const result = extractJavaSymbols([
      { path: "OrderService.java", content: "public interface OrderService {}" },
      { path: "OrderServiceImpl.java", content: source },
    ]);
    const rel = result.relationships.find((r) => r.kind === "implements");
    expect(rel).toBeDefined();
  });

  it("detects field-type relationship", () => {
    const source = `
public class OrderService {
  private OrderRepository repository;
}`;
    const result = extractJavaSymbols([
      { path: "OrderRepository.java", content: "public interface OrderRepository {}" },
      { path: "OrderService.java", content: source },
    ]);
    const rel = result.relationships.find((r) => r.kind === "field-type");
    expect(rel).toBeDefined();
  });

  it("extracts private class", () => {
    const source = `
class InternalHelper {
}`;
    const result = extractJavaSymbols([{ path: "InternalHelper.java", content: source }]);
    expect(result.symbols).toContainEqual(
      expect.objectContaining({ name: "InternalHelper", kind: "class", visibility: "private" }),
    );
  });

  it("handles multiple implements", () => {
    const source = `
public class OrderServiceImpl implements OrderService, Serializable {
}`;
    const result = extractJavaSymbols([
      { path: "OrderService.java", content: "public interface OrderService {}" },
      { path: "OrderServiceImpl.java", content: source },
    ]);
    const rels = result.relationships.filter((r) => r.kind === "implements");
    // Should find at least the one for OrderService (Serializable is not a known symbol)
    expect(rels.length).toBeGreaterThanOrEqual(1);
    expect(rels.some((r) => r.targetId.includes("orderservice"))).toBe(true);
  });
});
