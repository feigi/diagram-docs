/**
 * Signal detection engine for identifying architecture-relevant patterns
 * in config file content. Provides a pattern registry and noise denylist
 * for deterministic extraction of infrastructure signals.
 */

export type SignalType =
  | "database-url"
  | "message-broker"
  | "cache-endpoint"
  | "search-endpoint"
  | "object-storage"
  | "service-endpoint"
  | "server-config"
  | "env-infrastructure";

export interface ConfigSignal {
  readonly type: SignalType;
  readonly value: string;
  readonly line: number;
  readonly matchedPattern: string;
  readonly filePath: string;
}

// ---------------------------------------------------------------------------
// Signal pattern registry
// ---------------------------------------------------------------------------

interface SignalPattern {
  readonly name: string;
  readonly type: SignalType;
  readonly regex: RegExp;
}

/**
 * Pattern registry for architecture signal detection. Each entry maps a regex
 * to a signal type and pattern name. Order matters: specific protocol patterns
 * (jdbc:, amqp:, redis:, mongodb:) come before the generic service-url pattern
 * so they match first.
 *
 * CRITICAL: No /g flag on any regex — prevents lastIndex state leakage.
 */
const SIGNAL_PATTERNS: readonly SignalPattern[] = [
  // Database URLs
  {
    name: "jdbc-postgresql",
    type: "database-url",
    regex: /jdbc:postgresql:\/\/[^\s'"`,)}>]+/i,
  },
  {
    name: "jdbc-mysql",
    type: "database-url",
    regex: /jdbc:mysql:\/\/[^\s'"`,)}>]+/i,
  },
  {
    name: "jdbc-oracle",
    type: "database-url",
    regex: /jdbc:oracle:[^\s'"`,)}>]+/i,
  },
  {
    name: "jdbc-sqlite",
    type: "database-url",
    regex: /jdbc:sqlite:[^\s'"`,)}>]+/i,
  },
  {
    name: "jdbc-h2",
    type: "database-url",
    regex: /jdbc:h2:[^\s'"`,)}>]+/i,
  },
  {
    name: "mongodb-url",
    type: "database-url",
    regex: /mongodb(\+srv)?:\/\/[^\s'"`,)}>]+/i,
  },

  // Message Brokers
  {
    name: "kafka-bootstrap",
    type: "message-broker",
    regex: /[\w.-]+:\s*(?:9092|9093|9094)\b/i,
  },
  {
    name: "kafka-topic",
    type: "message-broker",
    regex: /(?:topic|destination)[=:\s]+\s*["']?[\w.-]+["']?/i,
  },
  {
    name: "amqp-url",
    type: "message-broker",
    regex: /amqps?:\/\/[^\s'"`,)}>]+/i,
  },

  // Caches
  {
    name: "redis-url",
    type: "cache-endpoint",
    regex: /rediss?:\/\/[^\s'"`,)}>]+/i,
  },
  {
    name: "redis-host",
    type: "cache-endpoint",
    regex: /[\w.-]+:\s*6379\b/i,
  },
  {
    name: "memcached-host",
    type: "cache-endpoint",
    regex: /[\w.-]+:\s*11211\b/i,
  },

  // Search
  {
    name: "elasticsearch-url",
    type: "search-endpoint",
    regex: /[\w.-]+:\s*9200\b/i,
  },

  // Object Storage
  {
    name: "s3-endpoint",
    type: "object-storage",
    regex: /s3[.:/][\w.-]*amazonaws\.com/i,
  },
  {
    name: "s3-bucket",
    type: "object-storage",
    regex: /(?:bucket)[=:\s]+\s*["']?[\w.-]+["']?/i,
  },

  // Service URLs — MUST come after specific protocol patterns
  {
    name: "service-url",
    type: "service-endpoint",
    regex: /https?:\/\/[^\s'"`,{}<>]+/i,
  },

  // Server Config
  {
    name: "server-port",
    type: "server-config",
    regex: /(?:server[._-]?port|listen)[=:\s]+\s*\d+/i,
  },

  // Environment Variables
  {
    name: "env-infra-ref",
    type: "env-infrastructure",
    regex:
      /\$\{?\s*(?:DATABASE|DB|REDIS|KAFKA|RABBIT|AMQP|ELASTICSEARCH|MONGO|MEMCACHED|S3)[A-Z_]*\s*\}?/i,
  },
];

// ---------------------------------------------------------------------------
// Noise denylist
// ---------------------------------------------------------------------------

/**
 * Patterns that match noise — signals whose values match any of these are
 * filtered out. Applied to the matched value string, not the full line.
 */
const NOISE_DENYLIST: readonly RegExp[] = [
  // XML namespace/schema URIs
  /https?:\/\/www\.w3\.org\//i,
  /https?:\/\/xmlns\.jcp\.org\//i,
  /https?:\/\/schemas\./i,
  /https?:\/\/xml\.apache\.org\//i,

  // Maven/build tool repositories
  /https?:\/\/repo\.maven\.apache\.org\//i,
  /https?:\/\/repo1\.maven\.org\//i,
  /https?:\/\/plugins\.gradle\.org\//i,
  /https?:\/\/registry\.npmjs\.org\//i,

  // Documentation / spec links
  /https?:\/\/docs\./i,
  /https?:\/\/javadoc\./i,
  /https?:\/\/tools\.ietf\.org\//i,
  /https?:\/\/www\.oracle\.com\/.*\.dtd/i,
  /https?:\/\/hibernate\.org\/dtd\//i,

  // Spring Actuator management paths
  /\/actuator\b/i,
  /\/health\b/i,
  /\/info\b/i,

  // Localhost (not real architecture signals)
  /https?:\/\/localhost[:/]/i,
  /https?:\/\/127\.0\.0\.1[:/]/i,
  /https?:\/\/0\.0\.0\.0[:/]/i,
  /https?:\/\/\[::1\][:/]/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNoise(value: string): boolean {
  return NOISE_DENYLIST.some((pattern) => pattern.test(value));
}

const COMMENT_LINE = /^\s*[#!]/;
const XML_COMMENT_LINE = /^\s*<!--/;

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detect architecture-relevant signals in config file content.
 *
 * Takes an array of config files (path + content) and returns a sorted,
 * deduplicated array of ConfigSignal objects. Pure function — identical
 * input always produces identical output.
 */
export function detectConfigSignals(
  configFiles: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>,
): ConfigSignal[] {
  const signals: ConfigSignal[] = [];

  for (const file of configFiles) {
    const lines = file.content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // Skip empty lines and comment-only lines
      if (!line.trim()) continue;
      if (COMMENT_LINE.test(line) || XML_COMMENT_LINE.test(line)) continue;

      for (const pattern of SIGNAL_PATTERNS) {
        const match = pattern.regex.exec(line);
        if (match && !isNoise(match[0].trim())) {
          signals.push({
            type: pattern.type,
            value: match[0].trim(),
            line: lineIdx + 1,
            matchedPattern: pattern.name,
            filePath: file.path,
          });
        }
      }
    }
  }

  // Deduplicate: keep only first occurrence per filePath::type::value
  const seen = new Set<string>();
  const deduplicated = signals.filter((signal) => {
    const key = `${signal.filePath}::${signal.type}::${signal.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Deterministic sort: filePath → line → type
  deduplicated.sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      a.line - b.line ||
      a.type.localeCompare(b.type),
  );

  return deduplicated;
}
