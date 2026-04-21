import { describe, it, expect } from "vitest";
import { buildContextCells } from "../../../src/generator/drawio/context.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

const model: ArchitectureModel = {
  version: 1,
  system: { name: "Shop", description: "desc" },
  actors: [
    { id: "customer", name: "Customer", description: "A paying customer" },
  ],
  externalSystems: [
    {
      id: "payment-api",
      name: "Payment API",
      description: "Stripe adapter",
      technology: "REST",
    },
  ],
  containers: [
    {
      id: "web",
      applicationId: "web",
      name: "Web",
      description: "",
      technology: "TS",
    },
  ],
  components: [],
  relationships: [
    { sourceId: "customer", targetId: "web", label: "uses" },
    { sourceId: "web", targetId: "payment-api", label: "charges" },
  ],
};

describe("buildContextCells", () => {
  it("emits actor, system, external-system vertices", () => {
    const { vertices } = buildContextCells(model);
    const ids = vertices.map((v) => v.id);
    expect(ids).toContain("customer");
    expect(ids).toContain("system");
    expect(ids).toContain("payment-api");
  });

  it("collapses container refs onto the system node", () => {
    const { edges } = buildContextCells(model);
    const srcs = edges.map((e) => e.source);
    const tgts = edges.map((e) => e.target);
    expect(srcs).toContain("system");
    expect(tgts).toContain("system");
    expect(srcs).not.toContain("web");
    expect(tgts).not.toContain("web");
  });

  it("deduplicates collapsed edges", () => {
    const dup: ArchitectureModel = {
      ...model,
      relationships: [
        { sourceId: "web", targetId: "payment-api", label: "charges" },
        { sourceId: "web", targetId: "payment-api", label: "refunds" },
      ],
    };
    const { edges } = buildContextCells(dup);
    const filtered = edges.filter(
      (e) => e.source === "system" && e.target === "payment-api",
    );
    expect(filtered).toHaveLength(1);
  });

  it("libraries are excluded (tag='library')", () => {
    const withLib: ArchitectureModel = {
      ...model,
      externalSystems: [
        ...model.externalSystems,
        { id: "lodash", name: "Lodash", description: "", tags: ["library"] },
      ],
    };
    const { vertices } = buildContextCells(withLib);
    expect(vertices.map((v) => v.id)).not.toContain("lodash");
  });

  it("keeps descriptions out of the actor/system/external values and uses tooltips", () => {
    const { vertices } = buildContextCells(model);
    const actor = vertices.find((v) => v.id === "customer")!;
    expect(actor.value).toBe("Customer\n[Person]");
    expect(actor.tooltip).toBe("A paying customer");
    const system = vertices.find((v) => v.id === "system")!;
    expect(system.value).toBe("Shop\n[Software System]");
    expect(system.tooltip).toBe("desc");
    const external = vertices.find((v) => v.id === "payment-api")!;
    expect(external.value).toBe("Payment API\n[External System]\n[REST]");
    expect(external.tooltip).toBe("Stripe adapter");
  });

  it("moves edge tech tag into edge tooltip and keeps value to the label only", () => {
    const { edges } = buildContextCells(model);
    const edge = edges[0];
    expect(edge).toBeDefined();
    expect(edge.value).toBe("uses");
    expect(edge.tooltip).toBeUndefined();
  });

  it("moves explicit edge tech tag into tooltip", () => {
    const modelWithTech: ArchitectureModel = {
      ...model,
      relationships: [
        {
          sourceId: "customer",
          targetId: "web",
          label: "calls",
          technology: "JSON over HTTPS",
        },
      ],
    };
    const { edges } = buildContextCells(modelWithTech);
    const edge = edges[0];
    expect(edge.value).toBe("calls");
    expect(edge.tooltip).toBe("[JSON over HTTPS]");
  });
});
