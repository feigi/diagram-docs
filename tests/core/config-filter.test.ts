import { describe, it, expect } from "vitest";
import {
  filterConfigFiles,
  applyConfigFiltering,
  type FilterResult,
} from "../../src/core/config-filter.js";
import type { ScannedApplication } from "../../src/analyzers/types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Zero-signal fixture: logback logging config (no architecture signals)
const LOGBACK_XML = {
  path: "src/main/resources/logback-spring.xml",
  content: `<?xml version="1.0" encoding="UTF-8"?>\n<configuration>\n  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">\n    <encoder><pattern>%d{HH:mm:ss} %-5level %logger{36} - %msg%n</pattern></encoder>\n  </appender>\n  <root level="INFO"><appender-ref ref="STDOUT"/></root>\n</configuration>`,
};

// Zero-signal fixture: geographic data JSON (no architecture signals)
const GEO_DATA_JSON = {
  path: "src/main/resources/un-country-centroids.json",
  content: JSON.stringify([
    { name: "Norway", lat: 60.47, lng: 8.47 },
    { name: "Sweden", lat: 60.13, lng: 18.64 },
  ]),
};

// Signal-bearing fixture: Spring application.yml with JDBC + Kafka
const APPLICATION_YML = {
  path: "src/main/resources/application.yml",
  content: `spring:\n  datasource:\n    url: jdbc:postgresql://db.example.com:5432/mydb\n  kafka:\n    bootstrap-servers: kafka-broker:9092\n    topic: order-events\nserver:\n  port: 8080`,
};

// ---------------------------------------------------------------------------
// Helper
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

// ---------------------------------------------------------------------------
// filterConfigFiles
// ---------------------------------------------------------------------------

describe("filterConfigFiles", () => {
  it("returns empty results for empty input array", () => {
    const result = filterConfigFiles([]);
    expect(result).toEqual({ kept: [], dropped: [], signals: [] });
  });

  it("drops all zero-signal files (logback, geo data)", () => {
    const result = filterConfigFiles([LOGBACK_XML, GEO_DATA_JSON]);
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([LOGBACK_XML.path, GEO_DATA_JSON.path]);
    expect(result.signals).toEqual([]);
  });

  it("keeps all signal-bearing files (application.yml with jdbc + kafka)", () => {
    const result = filterConfigFiles([APPLICATION_YML]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].path).toBe(APPLICATION_YML.path);
    expect(result.dropped).toEqual([]);
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
  });

  it("separates mixed files: keeps signal-bearing, drops zero-signal", () => {
    const result = filterConfigFiles([
      LOGBACK_XML,
      APPLICATION_YML,
      GEO_DATA_JSON,
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].path).toBe(APPLICATION_YML.path);
    expect(result.dropped).toEqual([LOGBACK_XML.path, GEO_DATA_JSON.path]);
    expect(result.signals.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves full file content in kept files", () => {
    const result = filterConfigFiles([APPLICATION_YML]);
    expect(result.kept[0].content).toBe(APPLICATION_YML.content);
  });

  it("returns all detected signals for kept files", () => {
    const result = filterConfigFiles([APPLICATION_YML]);
    // application.yml has at least: jdbc:postgresql (database-url),
    // kafka-broker:9092 (message-broker), topic: order-events (message-broker),
    // server port: 8080 (server-config)
    const signalTypes = new Set(result.signals.map((s) => s.type));
    expect(signalTypes.has("database-url")).toBe(true);
    expect(signalTypes.has("message-broker")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyConfigFiltering
// ---------------------------------------------------------------------------

describe("applyConfigFiltering", () => {
  it("skips app with no configFiles (undefined), returns empty map", () => {
    const app = makeApp({ id: "no-config" });
    const results = applyConfigFiltering([app]);
    expect(results.size).toBe(0);
    expect(app.configFiles).toBeUndefined();
  });

  it("skips app with empty configFiles array, returns empty map", () => {
    const app = makeApp({ id: "empty-config", configFiles: [] });
    const results = applyConfigFiltering([app]);
    expect(results.size).toBe(0);
  });

  it("sets configFiles=undefined and signals=undefined when all files dropped", () => {
    const app = makeApp({
      id: "all-dropped",
      configFiles: [LOGBACK_XML, GEO_DATA_JSON],
    });
    const results = applyConfigFiltering([app]);
    expect(results.size).toBe(1);
    expect(app.configFiles).toBeUndefined();
    expect(app.signals).toBeUndefined();
  });

  it("sets configFiles to kept files and signals to detected signals", () => {
    const app = makeApp({
      id: "has-signals",
      configFiles: [LOGBACK_XML, APPLICATION_YML],
    });
    const results = applyConfigFiltering([app]);
    expect(results.size).toBe(1);
    expect(app.configFiles).toHaveLength(1);
    expect(app.configFiles![0].path).toBe(APPLICATION_YML.path);
    expect(app.signals).toBeDefined();
    expect(app.signals!.length).toBeGreaterThanOrEqual(1);
  });

  it("processes multiple apps independently", () => {
    const app1 = makeApp({
      id: "app1",
      configFiles: [LOGBACK_XML],
    });
    const app2 = makeApp({
      id: "app2",
      configFiles: [APPLICATION_YML],
    });
    const results = applyConfigFiltering([app1, app2]);
    expect(results.size).toBe(2);
    // app1: all dropped
    expect(app1.configFiles).toBeUndefined();
    expect(app1.signals).toBeUndefined();
    // app2: kept with signals
    expect(app2.configFiles).toHaveLength(1);
    expect(app2.signals).toBeDefined();
  });

  it("returns Map keyed by app.id with FilterResult per app", () => {
    const app = makeApp({
      id: "my-app-id",
      configFiles: [APPLICATION_YML],
    });
    const results = applyConfigFiltering([app]);
    expect(results.has("my-app-id")).toBe(true);
    const result = results.get("my-app-id")!;
    expect(result.kept).toBeDefined();
    expect(result.dropped).toBeDefined();
    expect(result.signals).toBeDefined();
  });
});
