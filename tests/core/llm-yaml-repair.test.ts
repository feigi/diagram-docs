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

    expect(repairLLMYaml(valid)).toBe(valid);
  });

  it("splits smashed list items onto separate lines", () => {
    const broken = [
      "    moduleIds:",
      '      - "los-some-id"      - "los-other-id"',
    ].join("\n");

    const repaired = repairLLMYaml(broken);
    // Should produce two separate list items
    expect(repaired).toContain('- "los-some-id"');
    expect(repaired).toContain('- "los-other-id"');
    // Both should be on separate lines
    const lines = repaired.split("\n");
    const itemLines = lines.filter((l) => l.trim().startsWith("- "));
    expect(itemLines).toHaveLength(2);
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

    const repaired = repairLLMYaml(broken);
    const parsed = parseYaml(repaired) as {
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

    const repaired = repairLLMYaml(truncated);
    expect(repaired).not.toContain("cut off");
    // Should still be parseable
    const parsed = parseYaml(repaired) as { system: { name: string } };
    expect(parsed.system.name).toBe("Test");
  });

  it("removes trailing incomplete list item", () => {
    const truncated = [
      "containers:",
      '  - id: "foo"',
      '    name: "Foo"',
      "  - ",
    ].join("\n");

    const repaired = repairLLMYaml(truncated);
    const parsed = parseYaml(repaired) as {
      containers: { id: string }[];
    };
    expect(parsed.containers).toHaveLength(1);
    expect(parsed.containers[0].id).toBe("foo");
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

    const repaired = repairLLMYaml(truncated);
    // The broken sourceId line should be removed
    expect(repaired).not.toContain("sourceId");
    const parsed = parseYaml(repaired) as { system: { name: string } };
    expect(parsed.system.name).toBe("OK");
  });

  it("handles smashed items where first item has unclosed quote", () => {
    // Reproduces the exact error pattern from the bug report:
    // - "los-      - "los-cha-app-com-bmw-los-next-charging-infrastructure-dyna..."
    const broken = [
      "    moduleIds:",
      '      - "los-      - "los-cha-app-com-bmw-los-next-charging-infrastructure-dynamodb"',
    ].join("\n");

    const repaired = repairLLMYaml(broken);
    const parsed = parseYaml(repaired) as { moduleIds: string[] };
    expect(parsed.moduleIds).toContain(
      "los-cha-app-com-bmw-los-next-charging-infrastructure-dynamodb",
    );
  });

  it("handles multiple smashed items with varied spacing", () => {
    const broken = [
      "    moduleIds:",
      '      - "alpha"    - "beta"       - "gamma"',
    ].join("\n");

    const repaired = repairLLMYaml(broken);
    const parsed = parseYaml(repaired) as { moduleIds: string[] };
    expect(parsed.moduleIds).toEqual(["alpha", "beta", "gamma"]);
  });
});
