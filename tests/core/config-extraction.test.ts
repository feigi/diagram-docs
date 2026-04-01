import { describe, it, expect } from "vitest";
import {
  extractSignalLines,
  applyConfigExtraction,
  type ExtractionResult,
} from "../../src/core/config-extraction.js";
import type { ConfigSignal } from "../../src/core/config-signals.js";
import type { ScannedApplication } from "../../src/analyzers/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeApp(overrides: Partial<ScannedApplication>): ScannedApplication {
  return {
    id: "app",
    path: "app",
    name: "App",
    language: "java",
    buildFile: "build.gradle",
    modules: [],
    externalDependencies: [],
    internalImports: [],
    ...overrides,
  };
}

function makeSignal(overrides: Partial<ConfigSignal>): ConfigSignal {
  return {
    type: "database-url",
    value: "jdbc:postgresql://db:5432/orders",
    line: 1,
    matchedPattern: "jdbc-postgresql",
    filePath: "application.yml",
    ...overrides,
  } as ConfigSignal;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// 1. YAML_SPRING — Spring application.yml with nested YAML structure
const YAML_SPRING = {
  path: "src/main/resources/application.yml",
  content:
    "spring:\n  datasource:\n    url: jdbc:postgresql://db:5432/orders\n  kafka:\n    bootstrap-servers: kafka-broker-1:9092\n    topic: order-events\nserver:\n  port: 8080\nlogging:\n  level:\n    root: INFO",
};

const YAML_SPRING_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "database-url",
    value: "jdbc:postgresql://db:5432/orders",
    line: 3,
    matchedPattern: "jdbc-postgresql",
    filePath: YAML_SPRING.path,
  }),
  makeSignal({
    type: "message-broker",
    value: "kafka-broker-1:9092",
    line: 5,
    matchedPattern: "kafka-bootstrap",
    filePath: YAML_SPRING.path,
  }),
  makeSignal({
    type: "message-broker",
    value: "topic: order-events",
    line: 6,
    matchedPattern: "kafka-topic",
    filePath: YAML_SPRING.path,
  }),
  makeSignal({
    type: "server-config",
    value: "port: 8080",
    line: 8,
    matchedPattern: "server-port",
    filePath: YAML_SPRING.path,
  }),
];

// 2. YAML_LIST_ITEMS — YAML with list item signals
const YAML_LIST_ITEMS = {
  path: "bootstrap.yml",
  content:
    "spring:\n  kafka:\n    bootstrap-servers:\n      - kafka-broker-1:9092",
};

const YAML_LIST_ITEMS_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "message-broker",
    value: "kafka-broker-1:9092",
    line: 4,
    matchedPattern: "kafka-bootstrap",
    filePath: YAML_LIST_ITEMS.path,
  }),
];

// 3. YAML_ENV_VARS — YAML with environment variable references
const YAML_ENV_VARS = {
  path: "application.yml",
  content:
    "spring:\n  datasource:\n    url: ${DB_URL}\n  redis:\n    host: ${REDIS_HOST}",
};

const YAML_ENV_VARS_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "env-infrastructure",
    value: "${DB_URL}",
    line: 3,
    matchedPattern: "env-infra-ref",
    filePath: YAML_ENV_VARS.path,
  }),
  makeSignal({
    type: "env-infrastructure",
    value: "${REDIS_HOST}",
    line: 5,
    matchedPattern: "env-infra-ref",
    filePath: YAML_ENV_VARS.path,
  }),
];

// 4. PROPERTIES_FILE — Java properties with explicit keys
const PROPERTIES_FILE = {
  path: "app.properties",
  content:
    "db.url=jdbc:postgresql://db:5432/orders\ndb.driver=org.postgresql.Driver\nserver.port=8080\napp.name=OrderService",
};

const PROPERTIES_FILE_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "database-url",
    value: "jdbc:postgresql://db:5432/orders",
    line: 1,
    matchedPattern: "jdbc-postgresql",
    filePath: PROPERTIES_FILE.path,
  }),
  makeSignal({
    type: "server-config",
    value: "server.port=8080",
    line: 3,
    matchedPattern: "server-port",
    filePath: PROPERTIES_FILE.path,
  }),
];

// 5. XML_CONFIG — XML with nested tags
const XML_CONFIG = {
  path: "persistence.xml",
  content:
    '<persistence>\n  <persistence-unit>\n    <properties>\n      <property name="url" value="jdbc:postgresql://db:5432/orders"/>\n    </properties>\n  </persistence-unit>\n</persistence>',
};

const XML_CONFIG_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "database-url",
    value: "jdbc:postgresql://db:5432/orders",
    line: 4,
    matchedPattern: "jdbc-postgresql",
    filePath: XML_CONFIG.path,
  }),
];

// 6. JSON_CONFIG — JSON with nested objects
const JSON_CONFIG = {
  path: "config.json",
  content:
    '{\n  "database": {\n    "url": "jdbc:postgresql://db:5432/orders"\n  },\n  "kafka": {\n    "bootstrapServers": "kafka-broker:9092"\n  }\n}',
};

const JSON_CONFIG_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "database-url",
    value: "jdbc:postgresql://db:5432/orders",
    line: 3,
    matchedPattern: "jdbc-postgresql",
    filePath: JSON_CONFIG.path,
  }),
  makeSignal({
    type: "message-broker",
    value: "kafka-broker:9092",
    line: 6,
    matchedPattern: "kafka-bootstrap",
    filePath: JSON_CONFIG.path,
  }),
];

// 7. TOML_CONFIG — TOML with section headers
const TOML_CONFIG = {
  path: "config.toml",
  content:
    '[database]\nurl = "jdbc:postgresql://db:5432/orders"\n\n[server]\nport = 8080',
};

const TOML_CONFIG_SIGNALS: ConfigSignal[] = [
  makeSignal({
    type: "database-url",
    value: "jdbc:postgresql://db:5432/orders",
    line: 2,
    matchedPattern: "jdbc-postgresql",
    filePath: TOML_CONFIG.path,
  }),
  makeSignal({
    type: "server-config",
    value: "port = 8080",
    line: 5,
    matchedPattern: "server-port",
    filePath: TOML_CONFIG.path,
  }),
];

// ---------------------------------------------------------------------------
// extractSignalLines
// ---------------------------------------------------------------------------

describe("extractSignalLines", () => {
  it("extracts YAML nested key paths as dotted pairs", () => {
    const result = extractSignalLines(
      YAML_SPRING.content,
      YAML_SPRING.path,
      YAML_SPRING_SIGNALS,
    );
    expect(result).toBe(
      "server.port: 8080\nspring.datasource.url: jdbc:postgresql://db:5432/orders\nspring.kafka.bootstrap-servers: kafka-broker-1:9092\nspring.kafka.topic: order-events",
    );
  });

  it("handles YAML list items using parent key path", () => {
    const result = extractSignalLines(
      YAML_LIST_ITEMS.content,
      YAML_LIST_ITEMS.path,
      YAML_LIST_ITEMS_SIGNALS,
    );
    expect(result).toContain(
      "spring.kafka.bootstrap-servers: kafka-broker-1:9092",
    );
  });

  it("preserves environment variable references in values", () => {
    const result = extractSignalLines(
      YAML_ENV_VARS.content,
      YAML_ENV_VARS.path,
      YAML_ENV_VARS_SIGNALS,
    );
    expect(result).toContain("spring.datasource.url: ${DB_URL}");
    expect(result).toContain("spring.redis.host: ${REDIS_HOST}");
  });

  it("extracts properties file keys as-is", () => {
    const result = extractSignalLines(
      PROPERTIES_FILE.content,
      PROPERTIES_FILE.path,
      PROPERTIES_FILE_SIGNALS,
    );
    expect(result).toBe(
      "db.url: jdbc:postgresql://db:5432/orders\nserver.port: 8080",
    );
  });

  it("reconstructs XML tag paths", () => {
    const result = extractSignalLines(
      XML_CONFIG.content,
      XML_CONFIG.path,
      XML_CONFIG_SIGNALS,
    );
    expect(result).toContain(
      "persistence.persistence-unit.properties.property: jdbc:postgresql://db:5432/orders",
    );
  });

  it("reconstructs JSON nested key paths", () => {
    const result = extractSignalLines(
      JSON_CONFIG.content,
      JSON_CONFIG.path,
      JSON_CONFIG_SIGNALS,
    );
    expect(result).toContain("database.url: jdbc:postgresql://db:5432/orders");
    expect(result).toContain("kafka.bootstrapServers: kafka-broker:9092");
  });

  it("reconstructs TOML section.key paths", () => {
    const result = extractSignalLines(
      TOML_CONFIG.content,
      TOML_CONFIG.path,
      TOML_CONFIG_SIGNALS,
    );
    expect(result).toBe(
      "database.url: jdbc:postgresql://db:5432/orders\nserver.port: 8080",
    );
  });

  it("sorts output alphabetically by key path", () => {
    const result = extractSignalLines(
      YAML_SPRING.content,
      YAML_SPRING.path,
      YAML_SPRING_SIGNALS,
    );
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^server\./);
    expect(lines[1]).toMatch(/^spring\.datasource/);
  });

  it("deduplicates signals on the same line", () => {
    const dupSignals: ConfigSignal[] = [
      makeSignal({
        type: "database-url",
        value: "jdbc:postgresql://db:5432/orders",
        line: 3,
        filePath: YAML_SPRING.path,
      }),
      makeSignal({
        type: "service-endpoint",
        value: "jdbc:postgresql://db:5432/orders",
        line: 3,
        filePath: YAML_SPRING.path,
      }),
    ];
    const result = extractSignalLines(
      YAML_SPRING.content,
      YAML_SPRING.path,
      dupSignals,
    );
    // Should produce only one line for line 3
    const lines = result.split("\n");
    expect(lines).toHaveLength(1);
  });

  it("preserves original content when extraction produces zero lines", () => {
    // Signal on a line that doesn't produce a valid key path (empty line)
    const content = "spring:\n\n  datasource:";
    const badSignals: ConfigSignal[] = [
      makeSignal({
        type: "database-url",
        value: "something",
        line: 2,
        filePath: "application.yml",
      }),
    ];
    const result = extractSignalLines(content, "application.yml", badSignals);
    // Should fallback to original content since empty line yields no key path
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// applyConfigExtraction
// ---------------------------------------------------------------------------

describe("applyConfigExtraction", () => {
  it("skips apps with no configFiles", () => {
    const app = makeApp({ id: "no-config" });
    const results = applyConfigExtraction([app]);
    expect(results.size).toBe(0);
  });

  it("skips apps with no signals", () => {
    const app = makeApp({
      id: "no-signals",
      configFiles: [{ path: "app.yml", content: "some: content" }],
      signals: undefined,
    });
    const results = applyConfigExtraction([app]);
    expect(results.size).toBe(0);
  });

  it("mutates configFiles content in-place", () => {
    const originalContent = YAML_SPRING.content;
    const app = makeApp({
      id: "mutate-test",
      configFiles: [{ path: YAML_SPRING.path, content: originalContent }],
      signals: YAML_SPRING_SIGNALS,
    });
    applyConfigExtraction([app]);
    expect(app.configFiles![0].content).not.toBe(originalContent);
    expect(app.configFiles![0].content).toContain("spring.datasource.url:");
  });

  it("returns Map keyed by app.id with ExtractionResult[]", () => {
    const app = makeApp({
      id: "my-app",
      configFiles: [{ path: YAML_SPRING.path, content: YAML_SPRING.content }],
      signals: YAML_SPRING_SIGNALS,
    });
    const results = applyConfigExtraction([app]);
    expect(results.has("my-app")).toBe(true);
    const appResults = results.get("my-app")!;
    expect(appResults).toHaveLength(1);
    expect(appResults[0]).toHaveProperty("filePath");
    expect(appResults[0]).toHaveProperty("originalLineCount");
    expect(appResults[0]).toHaveProperty("extractedSignalCount");
  });

  it("reports correct originalLineCount and extractedSignalCount", () => {
    const app = makeApp({
      id: "metrics-test",
      configFiles: [{ path: YAML_SPRING.path, content: YAML_SPRING.content }],
      signals: YAML_SPRING_SIGNALS,
    });
    const results = applyConfigExtraction([app]);
    const appResults = results.get("metrics-test")!;
    // Original content has 11 lines
    expect(appResults[0].originalLineCount).toBe(
      YAML_SPRING.content.split("\n").length,
    );
    // 4 signals for this file
    expect(appResults[0].extractedSignalCount).toBe(4);
  });
});
