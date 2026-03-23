import { describe, it, expect } from "vitest";
import {
  detectRole,
  detectExternalSystems,
  inferRelationshipLabel,
  inferExternalRelationshipLabel,
  inferComponentTech,
} from "../../src/core/patterns.js";
import type { Role } from "../../src/core/patterns.js";

describe("detectRole", () => {
  it("returns undefined for empty annotations", () => {
    expect(detectRole("")).toBeUndefined();
  });

  it("returns undefined for annotations with no matching role", () => {
    expect(detectRole("Transactional,Component")).toBeUndefined();
  });

  // Controller patterns
  it("detects controller from Controller annotation", () => {
    expect(detectRole("Controller")).toBe("controller");
  });

  it("detects controller from RestController annotation (case-insensitive)", () => {
    expect(detectRole("restcontroller")).toBe("controller");
  });

  it("detects controller from RestController mixed case", () => {
    expect(detectRole("RestController")).toBe("controller");
  });

  it("detects controller from Resource annotation", () => {
    expect(detectRole("Resource")).toBe("controller");
  });

  it("detects controller from Endpoint annotation", () => {
    expect(detectRole("Endpoint")).toBe("controller");
  });

  it("detects controller from Route annotation", () => {
    expect(detectRole("Route")).toBe("controller");
  });

  it("detects controller from Handler annotation", () => {
    expect(detectRole("Handler")).toBe("controller");
  });

  it("detects controller from comma-separated list", () => {
    expect(detectRole("Transactional,RestController,Validated")).toBe("controller");
  });

  // Listener patterns
  it("detects listener from Listener annotation", () => {
    expect(detectRole("Listener")).toBe("listener");
  });

  it("detects listener from Consumer annotation", () => {
    expect(detectRole("Consumer")).toBe("listener");
  });

  it("detects listener from Subscriber annotation", () => {
    expect(detectRole("Subscriber")).toBe("listener");
  });

  it("detects listener from comma-separated list", () => {
    expect(detectRole("Component,KafkaListener,Transactional")).toBe("listener");
  });

  // Repository patterns
  it("detects repository from Repository annotation", () => {
    expect(detectRole("Repository")).toBe("repository");
  });

  it("detects repository from Dao annotation", () => {
    expect(detectRole("Dao")).toBe("repository");
  });

  it("detects repository from DAO uppercase", () => {
    expect(detectRole("DAO")).toBe("repository");
  });

  // Service patterns
  it("detects service from Service annotation", () => {
    expect(detectRole("Service")).toBe("service");
  });

  it("detects service from lowercase service", () => {
    expect(detectRole("service")).toBe("service");
  });

  it("detects service from comma-separated list", () => {
    expect(detectRole("Transactional,Service")).toBe("service");
  });

  // Substring matching
  it("matches controller as substring of longer annotation", () => {
    expect(detectRole("MyRestController")).toBe("controller");
  });

  it("matches repository as substring of longer annotation", () => {
    expect(detectRole("JpaRepository")).toBe("repository");
  });
});

describe("detectExternalSystems", () => {
  it("returns empty array for empty dep list", () => {
    expect(detectExternalSystems([])).toEqual([]);
  });

  it("returns empty array when no deps match", () => {
    expect(detectExternalSystems(["spring-boot", "lombok"])).toEqual([]);
  });

  // Database patterns
  it("detects PostgreSQL", () => {
    const result = detectExternalSystems(["postgresql"]);
    expect(result).toEqual([{ keyword: "postgresql", type: "Database", technology: "PostgreSQL" }]);
  });

  it("detects PostgreSQL case-insensitively", () => {
    const result = detectExternalSystems(["PostgreSQL"]);
    expect(result).toEqual([{ keyword: "postgresql", type: "Database", technology: "PostgreSQL" }]);
  });

  it("detects MySQL", () => {
    const result = detectExternalSystems(["mysql"]);
    expect(result).toEqual([{ keyword: "mysql", type: "Database", technology: "MySQL" }]);
  });

  it("detects Oracle", () => {
    const result = detectExternalSystems(["oracle"]);
    expect(result).toEqual([{ keyword: "oracle", type: "Database", technology: "Oracle" }]);
  });

  it("detects SQLite", () => {
    const result = detectExternalSystems(["sqlite"]);
    expect(result).toEqual([{ keyword: "sqlite", type: "Database", technology: "SQLite" }]);
  });

  it("detects H2 via h2database (primary Maven group ID keyword)", () => {
    const result = detectExternalSystems(["com.h2database:h2"]);
    expect(result).toEqual([{ keyword: "h2database", type: "Database", technology: "H2" }]);
  });

  it("does not match bare h2 to avoid false positives", () => {
    const result = detectExternalSystems(["h2"]);
    expect(result).toEqual([]);
  });

  // Message broker patterns
  it("detects Kafka", () => {
    const result = detectExternalSystems(["kafka"]);
    expect(result).toEqual([{ keyword: "kafka", type: "Message Broker", technology: "Apache Kafka" }]);
  });

  it("detects Kafka as substring (e.g., spring-kafka)", () => {
    const result = detectExternalSystems(["spring-kafka"]);
    expect(result).toEqual([{ keyword: "kafka", type: "Message Broker", technology: "Apache Kafka" }]);
  });

  it("detects RabbitMQ", () => {
    const result = detectExternalSystems(["rabbitmq"]);
    expect(result).toEqual([{ keyword: "rabbitmq", type: "Message Broker", technology: "RabbitMQ" }]);
  });

  it("detects RabbitMQ via amqp", () => {
    const result = detectExternalSystems(["amqp"]);
    expect(result).toEqual([{ keyword: "amqp", type: "Message Broker", technology: "RabbitMQ" }]);
  });

  // Cache patterns
  it("detects Redis", () => {
    const result = detectExternalSystems(["redis"]);
    expect(result).toEqual([{ keyword: "redis", type: "Cache", technology: "Redis" }]);
  });

  it("detects Redis via jedis", () => {
    const result = detectExternalSystems(["jedis"]);
    expect(result).toEqual([{ keyword: "jedis", type: "Cache", technology: "Redis" }]);
  });

  it("detects Redis via lettuce", () => {
    const result = detectExternalSystems(["lettuce-core"]);
    expect(result).toEqual([{ keyword: "lettuce", type: "Cache", technology: "Redis" }]);
  });

  it("detects Memcached", () => {
    const result = detectExternalSystems(["memcached"]);
    expect(result).toEqual([{ keyword: "memcached", type: "Cache", technology: "Memcached" }]);
  });

  // Search engine patterns
  it("detects Elasticsearch", () => {
    const result = detectExternalSystems(["elasticsearch"]);
    expect(result).toEqual([{ keyword: "elasticsearch", type: "Search Engine", technology: "Elasticsearch" }]);
  });

  it("detects OpenSearch", () => {
    const result = detectExternalSystems(["opensearch"]);
    expect(result).toEqual([{ keyword: "opensearch", type: "Search Engine", technology: "OpenSearch" }]);
  });

  // Object storage patterns
  it("detects S3", () => {
    const result = detectExternalSystems(["s3"]);
    expect(result).toEqual([{ keyword: "s3", type: "Object Storage", technology: "S3" }]);
  });

  it("detects MinIO", () => {
    const result = detectExternalSystems(["minio"]);
    expect(result).toEqual([{ keyword: "minio", type: "Object Storage", technology: "S3" }]);
  });

  // Deduplication
  it("deduplicates by type+technology when multiple keywords match the same system", () => {
    const result = detectExternalSystems(["redis", "jedis", "lettuce"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ keyword: "redis", type: "Cache", technology: "Redis" });
  });

  it("returns multiple distinct systems", () => {
    const result = detectExternalSystems(["postgresql", "kafka", "redis"]);
    expect(result).toHaveLength(3);
    const types = result.map((r) => r.type);
    expect(types).toContain("Database");
    expect(types).toContain("Message Broker");
    expect(types).toContain("Cache");
  });

  it("returns multiple database entries when they are different technologies", () => {
    const result = detectExternalSystems(["postgresql", "mysql"]);
    expect(result).toHaveLength(2);
  });
});

describe("inferRelationshipLabel", () => {
  it("returns 'Delegates to' when source role is controller", () => {
    expect(inferRelationshipLabel("controller", "service")).toBe("Delegates to");
  });

  it("returns 'Delegates to' for controller → repository", () => {
    expect(inferRelationshipLabel("controller", "repository")).toBe("Delegates to");
  });

  it("returns 'Persists via' when target role is repository", () => {
    expect(inferRelationshipLabel("service", "repository")).toBe("Persists via");
  });

  it("returns 'Uses' as fallback", () => {
    expect(inferRelationshipLabel("service", "service")).toBe("Uses");
  });

  it("returns 'Uses' when roles are undefined", () => {
    expect(inferRelationshipLabel(undefined, undefined)).toBe("Uses");
  });

  it("returns 'Uses' for listener → service", () => {
    expect(inferRelationshipLabel("listener", "service")).toBe("Uses");
  });

  it("controller takes priority over repository target", () => {
    // controller source → "Delegates to" even if target is repository
    expect(inferRelationshipLabel("controller", "repository")).toBe("Delegates to");
  });
});

describe("inferExternalRelationshipLabel", () => {
  it("returns 'Reads/writes data in' for Database", () => {
    expect(inferExternalRelationshipLabel("Database")).toBe("Reads/writes data in");
  });

  it("returns 'Publishes/consumes messages via' for Message Broker", () => {
    expect(inferExternalRelationshipLabel("Message Broker")).toBe("Publishes/consumes messages via");
  });

  it("returns 'Caches data in' for Cache", () => {
    expect(inferExternalRelationshipLabel("Cache")).toBe("Caches data in");
  });

  it("returns 'Indexes/queries' for Search Engine", () => {
    expect(inferExternalRelationshipLabel("Search Engine")).toBe("Indexes/queries");
  });

  it("returns 'Stores objects in' for Object Storage", () => {
    expect(inferExternalRelationshipLabel("Object Storage")).toBe("Stores objects in");
  });

  it("covers all SystemType values", () => {
    // Ensure every SystemType has a non-empty label
    const systemTypes = ["Database", "Message Broker", "Cache", "Search Engine", "Object Storage"] as const;
    for (const st of systemTypes) {
      expect(inferExternalRelationshipLabel(st)).toBeTruthy();
    }
  });
});

describe("inferComponentTech", () => {
  it("returns 'Java REST Controller' for controller role in Java", () => {
    expect(inferComponentTech("RestController", "java")).toBe("Java REST Controller");
  });

  it("returns 'Java REST Controller' for controller role via Controller annotation", () => {
    expect(inferComponentTech("Controller", "java")).toBe("Java REST Controller");
  });

  it("returns 'Java Message Listener' for listener role in Java", () => {
    expect(inferComponentTech("KafkaListener", "java")).toBe("Java Message Listener");
  });

  it("returns 'Java Repository' for repository role in Java", () => {
    expect(inferComponentTech("Repository", "java")).toBe("Java Repository");
  });

  it("returns 'Java Service' for service role in Java", () => {
    expect(inferComponentTech("Service", "java")).toBe("Java Service");
  });

  it("uses capitalized language name", () => {
    expect(inferComponentTech("Service", "python")).toBe("Python Service");
  });

  it("returns capitalized language only when no role detected", () => {
    expect(inferComponentTech("Transactional", "java")).toBe("Java");
  });

  it("returns language for empty annotations", () => {
    expect(inferComponentTech("", "java")).toBe("Java");
  });
});
