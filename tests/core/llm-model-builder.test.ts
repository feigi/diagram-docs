import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserMessage,
  buildPerAppUserMessage,
} from "../../src/core/llm-model-builder.js";
import type {
  ScannedApplication,
  RawStructure,
} from "../../src/analyzers/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeApp(
  overrides: Partial<ScannedApplication> = {},
): ScannedApplication {
  return {
    id: "order-service",
    path: "services/order-service",
    name: "Order Service",
    language: "java",
    buildFile: "build.gradle",
    modules: [],
    externalDependencies: [],
    internalImports: [],
    ...overrides,
  };
}

function makeRawStructure(apps: ScannedApplication[]): RawStructure {
  return {
    version: 1,
    scannedAt: "2025-01-01T00:00:00Z",
    checksum: "abc123",
    applications: apps,
  };
}

/**
 * Extract and parse the JSON portion from buildUserMessage / buildPerAppUserMessage output.
 * The JSON follows "## raw-structure.json\n" and precedes the next section or end of string.
 */
function parseJsonFromMessage(message: string): any {
  const jsonStart = message.indexOf("{");
  const boundaries = [
    "\n\n## diagram-docs.yaml",
    "\n\n## Deterministic anchor",
    "\n\nWrite the architecture-model.yaml",
    "\n\nProduce the architecture-model.yaml",
  ];
  let jsonEnd = message.length;
  for (const boundary of boundaries) {
    const idx = message.indexOf(boundary);
    if (idx !== -1 && idx < jsonEnd) jsonEnd = idx;
  }
  return JSON.parse(message.substring(jsonStart, jsonEnd));
}

// ---------------------------------------------------------------------------
// Tests: summarizeForLLM config condensation (via buildUserMessage)
// ---------------------------------------------------------------------------

describe("summarizeForLLM config condensation (via buildUserMessage)", () => {
  it("produces config string field instead of configFiles array", () => {
    const app = makeApp({
      configFiles: [
        {
          path: "src/main/resources/application.yml",
          content: "spring.datasource.url: jdbc:postgresql://db:5432/orders",
        },
      ],
    });
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);

    expect(parsed.applications[0].config).toBeTypeOf("string");
    expect(parsed.applications[0].configFiles).toBeUndefined();
    expect(parsed.applications[0].config).toContain(
      "spring.datasource.url: jdbc:postgresql://db:5432/orders",
    );
  });

  it("includes # filename provenance comment", () => {
    const app = makeApp({
      configFiles: [
        {
          path: "src/main/resources/application.yml",
          content: "spring.datasource.url: jdbc:postgresql://db:5432/orders",
        },
      ],
    });
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);

    expect(parsed.applications[0].config).toContain("# application.yml");
  });

  it("omits config field when no configFiles", () => {
    const app = makeApp();
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);

    expect(parsed.applications[0].config).toBeUndefined();
    expect(parsed.applications[0].configFiles).toBeUndefined();
  });

  it("preserves all signals — no data loss", () => {
    const app = makeApp({
      configFiles: [
        {
          path: "application.yml",
          content:
            "kafka.bootstrap-servers: broker:9092\nspring.datasource.url: jdbc:postgresql://db:5432/orders\nserver.port: 8080",
        },
      ],
    });
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);
    const config: string = parsed.applications[0].config;

    expect(config).toContain("kafka.bootstrap-servers: broker:9092");
    expect(config).toContain(
      "spring.datasource.url: jdbc:postgresql://db:5432/orders",
    );
    expect(config).toContain("server.port: 8080");
  });

  it("deduplicates identical key+value across files", () => {
    const app = makeApp({
      configFiles: [
        {
          path: "application.yml",
          content: "spring.datasource.url: jdbc:postgresql://db:5432/orders",
        },
        {
          path: "application-prod.yml",
          content:
            "spring.datasource.url: jdbc:postgresql://db:5432/orders\nspring.datasource.pool-size: 20",
        },
      ],
    });
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);
    const config: string = parsed.applications[0].config;

    // Identical key+value should appear only once
    const occurrences =
      config.split("spring.datasource.url: jdbc:postgresql://db:5432/orders")
        .length - 1;
    expect(occurrences).toBe(1);

    // Unique entry from second file should still be present
    expect(config).toContain("spring.datasource.pool-size: 20");
  });

  it("keeps different values for same key path", () => {
    const app = makeApp({
      configFiles: [
        {
          path: "application.yml",
          content: "spring.datasource.url: ${DB_URL}",
        },
        {
          path: "application-prod.yml",
          content: "spring.datasource.url: jdbc:postgresql://db:5432/orders",
        },
      ],
    });
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);
    const config: string = parsed.applications[0].config;

    expect(config).toContain("spring.datasource.url: ${DB_URL}");
    expect(config).toContain(
      "spring.datasource.url: jdbc:postgresql://db:5432/orders",
    );
  });

  it("first file alphabetically wins dedup", () => {
    const app = makeApp({
      configFiles: [
        { path: "z-config.yml", content: "db.url: same-value" },
        { path: "a-config.yml", content: "db.url: same-value" },
      ],
    });
    const message = buildUserMessage({
      rawStructure: makeRawStructure([app]),
    });
    const parsed = parseJsonFromMessage(message);
    const config: string = parsed.applications[0].config;

    // Sorted alphabetically: a-config.yml comes first and wins dedup
    expect(config).toContain("# a-config.yml");

    // z-config.yml section is omitted because all its lines were deduplicated
    expect(config).not.toContain("# z-config.yml");

    // Deduplicated: db.url appears once
    const occurrences = config.split("db.url: same-value").length - 1;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildPerAppUserMessage config condensation
// ---------------------------------------------------------------------------

describe("buildPerAppUserMessage config condensation", () => {
  it("produces config string field instead of configFiles array", () => {
    const app = makeApp({
      configFiles: [
        {
          path: "src/main/resources/application.yml",
          content: "spring.datasource.url: jdbc:postgresql://db:5432/orders",
        },
      ],
    });
    const message = buildPerAppUserMessage({
      app,
      anchorYaml: "containers: []",
    });
    const parsed = parseJsonFromMessage(message);

    expect(parsed.applications[0].config).toBeTypeOf("string");
    expect(parsed.applications[0].configFiles).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: buildSystemPrompt config references
// ---------------------------------------------------------------------------

describe("buildSystemPrompt config references", () => {
  it("references config field not configFiles", () => {
    const prompt = buildSystemPrompt();

    // Should NOT contain the word "configFiles"
    expect(prompt).not.toMatch(/\bconfigFiles\b/);

    // Should reference config near relevant context
    expect(prompt).toMatch(/\bconfig\b/);
  });
});
