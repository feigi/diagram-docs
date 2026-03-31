import { describe, it, expect } from "vitest";
import {
  detectConfigSignals,
  type ConfigSignal,
  type SignalType,
} from "../../src/core/config-signals.js";

/** Helper to reduce boilerplate — detects signals from a single file content string. */
function signalsFor(content: string, path = "test.yml"): ConfigSignal[] {
  return detectConfigSignals([{ path, content }]);
}

describe("detectConfigSignals", () => {
  // -------------------------------------------------------------------------
  // Empty / no-match cases
  // -------------------------------------------------------------------------
  describe("empty and no-match inputs", () => {
    it("returns empty array for empty input array", () => {
      expect(detectConfigSignals([])).toEqual([]);
    });

    it("returns empty array for content with no signals", () => {
      const result = signalsFor("# just a comment\nname: my-app\nversion: 1.0");
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Database URL detection
  // -------------------------------------------------------------------------
  describe("database URL detection", () => {
    it("detects JDBC PostgreSQL URL", () => {
      const result = signalsFor(
        "url=jdbc:postgresql://db.example.com:5432/mydb",
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const signal = result.find((s) => s.matchedPattern === "jdbc-postgresql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
      expect(signal!.line).toBe(1);
      expect(signal!.filePath).toBe("test.yml");
    });

    it("detects JDBC MySQL URL", () => {
      const result = signalsFor("url=jdbc:mysql://mysql.host:3306/app");
      const signal = result.find((s) => s.matchedPattern === "jdbc-mysql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects JDBC Oracle URL", () => {
      const result = signalsFor(
        "url=jdbc:oracle:thin:@//oracle.host:1521/ORCL",
      );
      const signal = result.find((s) => s.matchedPattern === "jdbc-oracle");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects JDBC SQLite URL", () => {
      const result = signalsFor("url=jdbc:sqlite:/data/app.db");
      const signal = result.find((s) => s.matchedPattern === "jdbc-sqlite");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects JDBC H2 URL", () => {
      const result = signalsFor("url=jdbc:h2:mem:testdb");
      const signal = result.find((s) => s.matchedPattern === "jdbc-h2");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects MongoDB connection string", () => {
      const result = signalsFor(
        "uri=mongodb+srv://user:pass@cluster.mongodb.net/db",
      );
      const signal = result.find((s) => s.matchedPattern === "mongodb-url");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });
  });

  // -------------------------------------------------------------------------
  // Message broker detection
  // -------------------------------------------------------------------------
  describe("message broker detection", () => {
    it("detects Kafka bootstrap server", () => {
      const result = signalsFor(
        "bootstrap.servers=kafka-broker.example.com:9092",
      );
      const signal = result.find((s) => s.matchedPattern === "kafka-bootstrap");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("message-broker");
    });

    it("detects Kafka topic config", () => {
      const result = signalsFor("topic=order-events");
      const signal = result.find((s) => s.matchedPattern === "kafka-topic");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("message-broker");
    });

    it("detects Kafka destination config", () => {
      const result = signalsFor("destination: order-events");
      const signal = result.find((s) => s.matchedPattern === "kafka-topic");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("message-broker");
    });

    it("detects AMQP/RabbitMQ URL", () => {
      const result = signalsFor("uri=amqp://rabbitmq.host:5672/vhost");
      const signal = result.find((s) => s.matchedPattern === "amqp-url");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("message-broker");
    });
  });

  // -------------------------------------------------------------------------
  // Cache endpoint detection
  // -------------------------------------------------------------------------
  describe("cache endpoint detection", () => {
    it("detects Redis URL", () => {
      const result = signalsFor("url=redis://cache.example.com:6379/0");
      const signal = result.find((s) => s.matchedPattern === "redis-url");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("cache-endpoint");
    });

    it("detects Redis host:port", () => {
      const result = signalsFor("host=cache-host.example.com:6379");
      const signal = result.find((s) => s.matchedPattern === "redis-host");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("cache-endpoint");
    });

    it("detects Memcached host:port", () => {
      const result = signalsFor("host=memcached.example.com:11211");
      const signal = result.find((s) => s.matchedPattern === "memcached-host");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("cache-endpoint");
    });
  });

  // -------------------------------------------------------------------------
  // Search engine detection
  // -------------------------------------------------------------------------
  describe("search engine detection", () => {
    it("detects Elasticsearch host:9200", () => {
      const result = signalsFor("host=search.example.com:9200");
      const signal = result.find(
        (s) => s.matchedPattern === "elasticsearch-url",
      );
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("search-endpoint");
    });
  });

  // -------------------------------------------------------------------------
  // Object storage detection
  // -------------------------------------------------------------------------
  describe("object storage detection", () => {
    it("detects S3 endpoint", () => {
      const result = signalsFor("endpoint=s3.us-east-1.amazonaws.com");
      const signal = result.find((s) => s.matchedPattern === "s3-endpoint");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("object-storage");
    });

    it("detects S3 bucket config", () => {
      const result = signalsFor("bucket=my-app-assets");
      const signal = result.find((s) => s.matchedPattern === "s3-bucket");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("object-storage");
    });
  });

  // -------------------------------------------------------------------------
  // Service URL detection
  // -------------------------------------------------------------------------
  describe("service URL detection", () => {
    it("detects non-noise HTTPS URLs as service endpoints", () => {
      const result = signalsFor(
        "payment-url=https://api.payment-service.com/v1",
      );
      const signal = result.find((s) => s.matchedPattern === "service-url");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("service-endpoint");
    });
  });

  // -------------------------------------------------------------------------
  // Server config detection
  // -------------------------------------------------------------------------
  describe("server config detection", () => {
    it("detects server.port property", () => {
      const result = signalsFor("server.port=8443");
      const signal = result.find((s) => s.matchedPattern === "server-port");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("server-config");
    });

    it("detects listen port in YAML", () => {
      const result = signalsFor("listen: 3000");
      const signal = result.find((s) => s.matchedPattern === "server-port");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("server-config");
    });
  });

  // -------------------------------------------------------------------------
  // Environment variable detection
  // -------------------------------------------------------------------------
  describe("env-infrastructure detection", () => {
    it("detects ${DATABASE_URL} env var reference", () => {
      const result = signalsFor("url=${DATABASE_URL}");
      const signal = result.find((s) => s.matchedPattern === "env-infra-ref");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("env-infrastructure");
    });

    it("detects ${KAFKA_BOOTSTRAP_SERVERS} env var reference", () => {
      const result = signalsFor("servers=${KAFKA_BOOTSTRAP_SERVERS}");
      const signal = result.find((s) => s.matchedPattern === "env-infra-ref");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("env-infrastructure");
    });

    it("detects ${REDIS_HOST} env var reference", () => {
      const result = signalsFor("host=${REDIS_HOST}");
      const signal = result.find((s) => s.matchedPattern === "env-infra-ref");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("env-infrastructure");
    });
  });

  // -------------------------------------------------------------------------
  // Noise filtering
  // -------------------------------------------------------------------------
  describe("noise filtering", () => {
    it("filters out XML namespace URIs (w3.org)", () => {
      const result = signalsFor('xmlns="http://www.w3.org/2001/XMLSchema"');
      expect(result).toEqual([]);
    });

    it("filters out Java EE namespace URIs (xmlns.jcp.org)", () => {
      const result = signalsFor('xmlns="http://xmlns.jcp.org/xml/ns/javaee"');
      expect(result).toEqual([]);
    });

    it("filters out Maven repository URLs", () => {
      const result = signalsFor("repo=https://repo.maven.apache.org/maven2");
      expect(result).toEqual([]);
    });

    it("filters out localhost URLs", () => {
      const result = signalsFor("url=http://localhost:8080/api");
      expect(result).toEqual([]);
    });

    it("filters out 127.0.0.1 URLs", () => {
      const result = signalsFor("url=http://127.0.0.1:3000");
      expect(result).toEqual([]);
    });

    it("filters out documentation links", () => {
      const result = signalsFor("url=https://docs.example.com/api");
      expect(result).toEqual([]);
    });

    it("filters out SOAP schema URIs", () => {
      const result = signalsFor(
        'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"',
      );
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-format support
  // -------------------------------------------------------------------------
  describe("multi-format support", () => {
    it("detects JDBC URL in YAML format", () => {
      const result = signalsFor("url: jdbc:postgresql://host:5432/db");
      const signal = result.find((s) => s.matchedPattern === "jdbc-postgresql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects JDBC URL in properties format", () => {
      const result = signalsFor(
        "spring.datasource.url=jdbc:postgresql://host:5432/db",
      );
      const signal = result.find((s) => s.matchedPattern === "jdbc-postgresql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects JDBC URL in XML format", () => {
      const result = signalsFor("<url>jdbc:postgresql://host:5432/db</url>");
      const signal = result.find((s) => s.matchedPattern === "jdbc-postgresql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });

    it("detects JDBC URL in JSON format", () => {
      const result = signalsFor('"url": "jdbc:postgresql://host:5432/db"');
      const signal = result.find((s) => s.matchedPattern === "jdbc-postgresql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url");
    });
  });

  // -------------------------------------------------------------------------
  // Deterministic output
  // -------------------------------------------------------------------------
  describe("deterministic output", () => {
    it("produces identical output for identical input (pure function)", () => {
      const files = [
        {
          path: "app.yml",
          content:
            "url: jdbc:postgresql://host:5432/db\nredis.host: cache:6379",
        },
      ];
      const result1 = detectConfigSignals(files);
      const result2 = detectConfigSignals(files);
      expect(result1).toEqual(result2);
    });

    it("sorts output by filePath, then line, then type", () => {
      const files = [
        { path: "b.yml", content: "url: jdbc:postgresql://host:5432/db" },
        { path: "a.yml", content: "redis.host: cache:6379" },
      ];
      const result = detectConfigSignals(files);
      expect(result.length).toBeGreaterThanOrEqual(2);
      // a.yml should come before b.yml
      const firstFile = result[0].filePath;
      expect(firstFile).toBe("a.yml");
    });

    it("produces same output regardless of input file order", () => {
      const filesA = [
        { path: "first.yml", content: "url: jdbc:postgresql://host:5432/db" },
        { path: "second.yml", content: "redis.host: cache:6379" },
      ];
      const filesB = [
        { path: "second.yml", content: "redis.host: cache:6379" },
        { path: "first.yml", content: "url: jdbc:postgresql://host:5432/db" },
      ];
      const resultA = detectConfigSignals(filesA);
      const resultB = detectConfigSignals(filesB);
      expect(resultA).toEqual(resultB);
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------
  describe("deduplication", () => {
    it("keeps only first occurrence per value+type in same file", () => {
      const content = [
        "url=jdbc:postgresql://host:5432/db",
        "backup-url=jdbc:postgresql://host:5432/db",
      ].join("\n");
      const result = signalsFor(content);
      const pgSignals = result.filter(
        (s) => s.matchedPattern === "jdbc-postgresql",
      );
      expect(pgSignals).toHaveLength(1);
      expect(pgSignals[0].line).toBe(1); // first occurrence
    });
  });

  // -------------------------------------------------------------------------
  // Signal metadata completeness
  // -------------------------------------------------------------------------
  describe("signal metadata", () => {
    it("includes all required fields with correct values", () => {
      const result = signalsFor(
        "url=jdbc:postgresql://db.example.com:5432/mydb",
        "config/application.yml",
      );
      const signal = result.find((s) => s.matchedPattern === "jdbc-postgresql");
      expect(signal).toBeDefined();
      expect(signal!.type).toBe("database-url" satisfies SignalType);
      expect(signal!.value).toContain("jdbc:postgresql://");
      expect(signal!.line).toBe(1);
      expect(signal!.matchedPattern).toBe("jdbc-postgresql");
      expect(signal!.filePath).toBe("config/application.yml");
    });
  });
});
