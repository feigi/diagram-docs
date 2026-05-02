import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";
import { D2Writer, wrapText } from "../../src/generator/d2/writer.js";

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

describe("wrapText", () => {
  it("returns short text unchanged", () => {
    expect(wrapText("hello world", 50)).toBe("hello world");
  });

  it("wraps text at word boundaries with D2 newline escape", () => {
    const result = wrapText(
      "This is a long description that needs wrapping",
      25,
      5,
    );
    expect(result).toContain("\\n");
    for (const line of result.split("\\n")) {
      expect(line.length).toBeLessThanOrEqual(25);
    }
  });

  it("truncates with ellipsis beyond maxLines", () => {
    const result = wrapText("word ".repeat(20).trim(), 15, 2);
    const lines = result.split("\\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("...");
  });

  it("does not truncate when lines fit within maxLines", () => {
    const result = wrapText("short text here", 50, 2);
    expect(result).not.toContain("...");
  });

  it("handles single-line maxLines", () => {
    const result = wrapText("This text is too long to fit on one line", 20, 1);
    const lines = result.split("\\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("...");
  });

  it("handles empty string", () => {
    expect(wrapText("", 50)).toBe("");
  });
});

describe("D2 Context Diagram", () => {
  it("generates valid context diagram", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateContextDiagram(model);

    expect(d2).toContain("# C4 Context Diagram");
    expect(d2).toContain("user");
    expect(d2).toContain("system");
    expect(d2).toContain("email_provider");
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
    expect(d2).toContain("user_api");
    expect(d2).toContain("order_service");
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

  it("includes link properties when componentLinks is enabled", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateContainerDiagram(model, {
      componentLinks: true,
      format: "svg",
    });

    // Each container should have a link to its component diagram
    for (const container of model.containers) {
      expect(d2).toContain(
        `link: ./containers/${container.id}/c3-component.svg`,
      );
    }
  });

  it("does not include link properties by default", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateContainerDiagram(model);

    expect(d2).not.toContain("link:");
  });

  it("uses png extension when format is png", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateContainerDiagram(model, {
      componentLinks: true,
      format: "png",
    });

    expect(d2).toContain("component.png");
    expect(d2).not.toContain("component.svg");
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

  it("renders cross-container component reference with friendly name (no refId suffix)", () => {
    // Drift verdict: actors render at L3 + no refId suffix on cross-container labels.
    const model = loadModel(MODEL_PATH);
    // order-service's order-handler has a relationship to user-controller (in user-api)
    const d2 = generateComponentDiagram(model, "order-service");

    expect(d2).toContain("User Controller");
    expect(d2).toContain("user_controller"); // D2 ID form (hyphens → underscores)
    expect(d2).toContain("class: component");
    // The "in User API" debug suffix is intentionally absent — dropped by projection.
    expect(d2).not.toContain("in User API");
    // The raw "| refId" debug suffix is intentionally absent.
    expect(d2).not.toContain("| user-controller");
  });

  it("adds code-level link only for components in codeLinks set", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateComponentDiagram(model, "user-api", {
      codeLinks: new Set(["user-controller"]),
      format: "svg",
    });

    expect(d2).toContain("link: ./components/user-controller/c4-code.svg");
    expect(d2).not.toContain("./components/user-repository/c4-code");
  });

  it("omits code-level links when codeLinks is not provided", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateComponentDiagram(model, "user-api");

    expect(d2).not.toContain("c4-code");
    expect(d2).not.toContain("link:");
  });

  it("honors format for code-level link extension", () => {
    const model = loadModel(MODEL_PATH);
    const d2 = generateComponentDiagram(model, "user-api", {
      codeLinks: new Set(["user-controller"]),
      format: "png",
    });

    expect(d2).toContain("./components/user-controller/c4-code.png");
    expect(d2).not.toContain("c4-code.svg");
  });
});
