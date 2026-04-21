import { describe, it, expect } from "vitest";
import { buildContainerCells } from "../../../src/generator/drawio/container.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "desc" },
  actors: [
    { id: "customer", name: "Customer", description: "A paying customer" },
  ],
  externalSystems: [
    {
      id: "payment",
      name: "Payment",
      description: "Stripe adapter",
      technology: "REST",
    },
  ],
  containers: [
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "Storefront UI",
      technology: "TS",
    },
    {
      id: "api",
      applicationId: "api",
      name: "API",
      description: "Public HTTP API",
      technology: "Go",
    },
    {
      id: "orphan",
      applicationId: "orphan",
      name: "Orphan",
      description: "unused",
      technology: "?",
    },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    {
      sourceId: "web",
      targetId: "api",
      label: "calls",
      technology: "JSON over HTTPS",
    },
    {
      sourceId: "api",
      targetId: "payment",
      label: "charges",
      technology: "REST",
    },
  ],
};

describe("buildContainerCells", () => {
  it("emits system boundary vertex with containers as children", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "system")).toBeDefined();
    expect(vertices.find((v) => v.id === "web")?.parent).toBe("system");
  });

  it("drops containers with no relationships", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "orphan")).toBeUndefined();
  });

  it("emits actor and external-system vertices at top level", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "customer")?.parent).toBeUndefined();
    expect(vertices.find((v) => v.id === "payment")?.parent).toBeUndefined();
  });

  it("edges reference containers directly (not via system)", () => {
    const { edges } = buildContainerCells(model);
    expect(
      edges.find((e) => e.source === "web" && e.target === "api"),
    ).toBeDefined();
  });

  it("keeps description out of vertex value and surfaces it as tooltip", () => {
    const { vertices } = buildContainerCells(model);
    const web = vertices.find((v) => v.id === "web")!;
    expect(web.value).toBe("Web\n[Container: TS]");
    expect(web.tooltip).toBe("Storefront UI");
    const customer = vertices.find((v) => v.id === "customer")!;
    expect(customer.value).toBe("Customer\n[Person]");
    expect(customer.tooltip).toBe("A paying customer");
    const payment = vertices.find((v) => v.id === "payment")!;
    expect(payment.value).toBe("Payment\n[External System]\n[REST]");
    expect(payment.tooltip).toBe("Stripe adapter");
  });

  it("keeps edge labels short and moves [tech] into edge tooltip", () => {
    const { edges } = buildContainerCells(model);
    const webToApi = edges.find(
      (e) => e.source === "web" && e.target === "api",
    )!;
    expect(webToApi.value).toBe("calls");
    expect(webToApi.tooltip).toBe("[JSON over HTTPS]");
  });

  it("tags every vertex with the matching StyleKey", () => {
    const { vertices } = buildContainerCells(model);
    expect(vertices.find((v) => v.id === "customer")?.kind).toBe("person");
    expect(vertices.find((v) => v.id === "system")?.kind).toBe(
      "system-boundary",
    );
    expect(vertices.find((v) => v.id === "web")?.kind).toBe("container");
    expect(vertices.find((v) => v.id === "payment")?.kind).toBe(
      "external-system",
    );
  });
});
