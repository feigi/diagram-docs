import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { loadModel } from "../../src/core/model.js";
import { extractFragment } from "../../src/core/model-fragment.js";

const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");

describe("extractFragment", () => {
  it("extracts a single container and its components", () => {
    const model = loadModel(MODEL_PATH);
    const fragment = extractFragment(model, "user-api");

    expect(fragment.version).toBe(1);
    expect(fragment.system).toEqual(model.system);
    expect(fragment.containers).toHaveLength(1);
    expect(fragment.containers[0].id).toBe("user-api");

    // user-api has 2 components: user-controller, user-repository
    expect(fragment.components).toHaveLength(2);
    expect(fragment.components.every((c) => c.containerId === "user-api")).toBe(
      true,
    );
  });

  it("includes only relevant relationships", () => {
    const model = loadModel(MODEL_PATH);
    const fragment = extractFragment(model, "user-api");

    // Relationships involving user-api or its components
    for (const rel of fragment.relationships) {
      const ids = [
        "user-api",
        "user-controller",
        "user-repository",
        ...fragment.externalSystems.map((e) => e.id),
        ...model.actors.map((a) => a.id),
        ...model.containers.map((c) => c.id),
      ];
      expect(ids.includes(rel.sourceId) || ids.includes(rel.targetId)).toBe(
        true,
      );
    }
  });

  it("includes referenced external systems", () => {
    const model = loadModel(MODEL_PATH);
    const fragment = extractFragment(model, "user-api");

    // user-api -> email-provider relationship exists
    expect(
      fragment.externalSystems.some((e) => e.id === "email-provider"),
    ).toBe(true);
  });

  it("excludes unrelated external systems", () => {
    const model = loadModel(MODEL_PATH);
    const fragment = extractFragment(model, "order-service");

    // order-service doesn't reference email-provider
    expect(
      fragment.externalSystems.some((e) => e.id === "email-provider"),
    ).toBe(false);
  });

  it("has empty actors", () => {
    const model = loadModel(MODEL_PATH);
    const fragment = extractFragment(model, "user-api");
    expect(fragment.actors).toEqual([]);
  });

  it("throws for unknown container", () => {
    const model = loadModel(MODEL_PATH);
    expect(() => extractFragment(model, "nonexistent")).toThrow(
      "Container not found",
    );
  });
});
