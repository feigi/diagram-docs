import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";
import { D2Writer } from "../../src/generator/d2/writer.js";

const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");

describe("D2 Writer", () => {
  it("generates shapes with labels", () => {
    const w = new D2Writer();
    w.shape("my-shape", "My Label");
    expect(w.toString()).toContain("my-shape: My Label");
  });

  it("generates connections", () => {
    const w = new D2Writer();
    w.connection("a", "b", "calls");
    expect(w.toString()).toContain("a -> b: calls");
  });

  it("generates containers with nested content", () => {
    const w = new D2Writer();
    w.container("outer", "Outer", () => {
      w.shape("inner", "Inner");
    });
    const out = w.toString();
    expect(out).toContain("outer: Outer {");
    expect(out).toContain("  inner: Inner");
    expect(out).toContain("}");
  });
});

describe("D2 Context Diagram", () => {
  it("generates valid context diagram", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateContextDiagram(model);

    expect(d2).toContain("# C4 Context Diagram");
    expect(d2).toContain("user");
    expect(d2).toContain("system");
    expect(d2).toContain("email-provider");
    expect(d2).toContain("class: person");
    expect(d2).toContain("class: system");
    expect(d2).toContain("class: external-system");
  });

  it("is deterministic across runs", () => {
    const model = loadModel(MODEL_PATH);
    const d2a = generateContextDiagram(model);
    const d2b = generateContextDiagram(model);
    expect(d2a).toBe(d2b);
  });
});

describe("D2 Container Diagram", () => {
  it("generates valid container diagram", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateContainerDiagram(model);

    expect(d2).toContain("# C4 Container Diagram");
    expect(d2).toContain("user-api");
    expect(d2).toContain("order-service");
    expect(d2).toContain("class: container");
    // Containers should be inside system boundary
    expect(d2).toContain("system:");
  });

  it("is deterministic across runs", () => {
    const model = loadModel(MODEL_PATH);
    const d2a = generateContainerDiagram(model);
    const d2b = generateContainerDiagram(model);
    expect(d2a).toBe(d2b);
  });
});

describe("D2 Component Diagram", () => {
  it("generates valid component diagram for user-api", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateComponentDiagram(model, "user-api");

    expect(d2).toContain("# C4 Component Diagram");
    expect(d2).toContain("User Controller");
    expect(d2).toContain("User Repository");
    expect(d2).toContain("class: component");
  });

  it("throws for unknown container", () => {
    const model = loadModel(MODEL_PATH);
    expect(() => generateComponentDiagram(model, "nonexistent")).toThrow(
      "Container not found",
    );
  });

  it("is deterministic across runs", () => {
    const model = loadModel(MODEL_PATH);
    const d2a = generateComponentDiagram(model, "user-api");
    const d2b = generateComponentDiagram(model, "user-api");
    expect(d2a).toBe(d2b);
  });
});
