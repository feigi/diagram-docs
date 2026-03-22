import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { repairLLMYaml } from "../../src/core/llm-model-builder.js";

describe("repairLLMYaml", () => {
  it("passes through valid YAML unchanged", () => {
    const valid = [
      "version: 1",
      "system:",
      '  name: "Test"',
      "containers:",
      '  - id: "foo"',
      '    name: "Foo"',
    ].join("\n");

    const result = repairLLMYaml(valid);
    expect(result.yaml).toBe(valid);
    expect(result.linesSplit).toBe(0);
    expect(result.linesRemoved).toBe(0);
    expect(result.removedLines).toEqual([]);
  });

  it("splits smashed list items onto separate lines", () => {
    const broken = [
      "    moduleIds:",
      '      - "los-some-id"      - "los-other-id"',
    ].join("\n");

    const result = repairLLMYaml(broken);
    // Should produce two separate list items
    expect(result.yaml).toContain('- "los-some-id"');
    expect(result.yaml).toContain('- "los-other-id"');
    // Both should be on separate lines
    const lines = result.yaml.split("\n");
    const itemLines = lines.filter((l) => l.trim().startsWith("- "));
    expect(itemLines).toHaveLength(2);
    expect(result.linesSplit).toBe(1);
  });

  it("repaired smashed list items produce valid YAML", () => {
    const broken = [
      "components:",
      '  - id: "comp-a"',
      "    moduleIds:",
      '      - "mod-one"      - "mod-two"',
      '  - id: "comp-b"',
      "    moduleIds:",
      '      - "mod-three"',
    ].join("\n");

    const result = repairLLMYaml(broken);
    const parsed = parseYaml(result.yaml) as {
      components: { id: string; moduleIds: string[] }[];
    };
    expect(parsed.components[0].moduleIds).toEqual(["mod-one", "mod-two"]);
    expect(parsed.components[1].moduleIds).toEqual(["mod-three"]);
  });

  it("removes trailing line with unclosed quote (truncated output)", () => {
    const truncated = [
      "version: 1",
      "system:",
      '  name: "Test"',
      '  description: "This was cut off mid-sen',
    ].join("\n");

    const result = repairLLMYaml(truncated);
    expect(result.yaml).not.toContain("cut off");
    expect(result.linesRemoved).toBe(1);
    expect(result.removedLines).toHaveLength(1);
    expect(result.removedLines[0]).toContain("cut off");
    // Should still be parseable
    const parsed = parseYaml(result.yaml) as { system: { name: string } };
    expect(parsed.system.name).toBe("Test");
  });

  it("removes trailing incomplete list item", () => {
    const truncated = [
      "containers:",
      '  - id: "foo"',
      '    name: "Foo"',
      "  - ",
    ].join("\n");

    const result = repairLLMYaml(truncated);
    const parsed = parseYaml(result.yaml) as {
      containers: { id: string }[];
    };
    expect(parsed.containers).toHaveLength(1);
    expect(parsed.containers[0].id).toBe("foo");
    expect(result.linesRemoved).toBe(1);
  });

  it("removes multiple trailing broken lines", () => {
    const truncated = [
      "version: 1",
      "system:",
      '  name: "OK"',
      '  description: "Also OK"',
      "relationships:",
      '  - sourceId: "a',
    ].join("\n");

    const result = repairLLMYaml(truncated);
    // The broken sourceId line should be removed
    expect(result.yaml).not.toContain("sourceId");
    const parsed = parseYaml(result.yaml) as { system: { name: string } };
    expect(parsed.system.name).toBe("OK");
    expect(result.linesRemoved).toBeGreaterThan(0);
  });

  it("handles smashed items where first item has unclosed quote", () => {
    // Reproduces the exact error pattern from the bug report:
    // - "los-      - "los-cha-app-com-bmw-los-next-charging-infrastructure-dyna..."
    const broken = [
      "    moduleIds:",
      '      - "los-      - "los-cha-app-com-bmw-los-next-charging-infrastructure-dynamodb"',
    ].join("\n");

    const result = repairLLMYaml(broken);
    const parsed = parseYaml(result.yaml) as { moduleIds: string[] };
    expect(parsed.moduleIds).toContain(
      "los-cha-app-com-bmw-los-next-charging-infrastructure-dynamodb",
    );
    expect(result.linesSplit).toBe(1);
  });

  it("handles multiple smashed items with varied spacing", () => {
    const broken = [
      "    moduleIds:",
      '      - "alpha"    - "beta"       - "gamma"',
    ].join("\n");

    const result = repairLLMYaml(broken);
    const parsed = parseYaml(result.yaml) as { moduleIds: string[] };
    expect(parsed.moduleIds).toEqual(["alpha", "beta", "gamma"]);
    expect(result.linesSplit).toBe(1);
  });
});
