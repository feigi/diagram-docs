import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { architectureModelSchema, loadModel } from "../../src/core/model.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

function sampleModel(): ArchitectureModel {
  return {
    version: 1,
    system: { name: "sys", description: "a system" },
    actors: [],
    externalSystems: [],
    containers: [
      {
        id: "user-api",
        applicationId: "user-api",
        name: "User API",
        description: "user api",
        technology: "java",
      },
    ],
    components: [
      {
        id: "user-controller",
        containerId: "user-api",
        name: "UserController",
        description: "controller",
        technology: "java",
        moduleIds: [],
      },
    ],
    relationships: [],
    codeElements: [
      {
        id: "user-controller.UserController",
        componentId: "user-controller",
        kind: "class",
        name: "UserController",
        visibility: "public",
        members: [
          {
            name: "getUser",
            kind: "method",
            signature: "(id: string): User",
            visibility: "public",
          },
          {
            name: "userService",
            kind: "field",
            visibility: "private",
          },
        ],
        tags: ["entrypoint"],
      },
      {
        id: "user-controller.UserRepository",
        componentId: "user-controller",
        kind: "interface",
        name: "UserRepository",
      },
    ],
    codeRelationships: [
      {
        sourceId: "user-controller.UserController",
        targetId: "user-controller.UserRepository",
        kind: "uses",
        label: "queries",
      },
    ],
  };
}

describe("architectureModelSchema round-trip", () => {
  it("preserves codeElements and codeRelationships through parse", () => {
    const original = sampleModel();
    // Simulate what loadModel does: serialize to YAML, parse back via schema.
    const yaml = stringifyYaml(original);
    // Mirror loadModel's flow: YAML -> JS -> Zod schema
    const parsed = architectureModelSchema.parse(
      parseYaml(yaml),
    ) as ArchitectureModel;

    expect(parsed.codeElements).toBeDefined();
    expect(parsed.codeElements).toHaveLength(2);
    expect(parsed.codeElements?.[0].id).toBe("user-controller.UserController");
    expect(parsed.codeElements?.[0].members).toHaveLength(2);
    expect(parsed.codeElements?.[0].members?.[0]).toMatchObject({
      name: "getUser",
      kind: "method",
      signature: "(id: string): User",
      visibility: "public",
    });
    expect(parsed.codeElements?.[0].tags).toEqual(["entrypoint"]);

    expect(parsed.codeRelationships).toBeDefined();
    expect(parsed.codeRelationships).toHaveLength(1);
    expect(parsed.codeRelationships?.[0]).toMatchObject({
      sourceId: "user-controller.UserController",
      targetId: "user-controller.UserRepository",
      kind: "uses",
      label: "queries",
    });
  });

  it("preserves codeElements and codeRelationships through loadModel disk round-trip", () => {
    const original = sampleModel();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-model-"));
    const modelPath = path.join(dir, "architecture-model.yaml");
    try {
      fs.writeFileSync(modelPath, stringifyYaml(original));
      const loaded = loadModel(modelPath);

      expect(loaded.codeElements).toBeDefined();
      expect(loaded.codeElements).toHaveLength(2);
      expect(loaded.codeRelationships).toBeDefined();
      expect(loaded.codeRelationships).toHaveLength(1);
      expect(loaded.codeRelationships?.[0].kind).toBe("uses");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
