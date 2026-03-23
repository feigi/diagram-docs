/**
 * Pattern registry for architectural role detection and external system identification.
 * Provides framework-agnostic matching of code metadata to C4 model concepts.
 */

export type Role = "controller" | "listener" | "repository" | "service";

export type SystemType = "Database" | "Message Broker" | "Cache" | "Search Engine" | "Object Storage";

export interface DetectedExternalSystem {
  readonly keyword: string;
  readonly type: SystemType;
  readonly technology: string;
}

// ---------------------------------------------------------------------------
// Role detection
// ---------------------------------------------------------------------------

/**
 * Maps substring patterns (lowercased) to roles.
 * First match wins, so order matters if patterns could overlap.
 */
const ROLE_PATTERNS: Array<{ pattern: string; role: Role; exact?: boolean }> = [
  // restcontroller and controller both map to "controller". "controller" is a
  // substring of "restcontroller", so the restcontroller entry matches first for
  // that specific token. Kept for documentation: it makes the intent explicit
  // that Spring's @RestController is a first-class controller pattern.
  { pattern: "restcontroller", role: "controller" },
  { pattern: "controller", role: "controller" },
  // "resource" is exact-match only to avoid false positives on ResourceConfig,
  // ResourceBundle, AutoConfigureResources, etc.
  { pattern: "resource", role: "controller", exact: true },
  { pattern: "endpoint", role: "controller" },
  { pattern: "route", role: "controller" },
  // "handler" uses exact match to avoid false positives on ExceptionHandler,
  // ErrorHandler, etc. Specific handler patterns use substring matching.
  { pattern: "requesthandler", role: "controller" },
  { pattern: "lambdahandler", role: "controller" },
  { pattern: "handler", role: "controller", exact: true },
  { pattern: "listener", role: "listener" },
  { pattern: "consumer", role: "listener" },
  { pattern: "subscriber", role: "listener" },
  { pattern: "repository", role: "repository" },
  { pattern: "dao", role: "repository" },
  { pattern: "service", role: "service" },
];

/**
 * Detect an architectural role from a comma-separated annotation string.
 * Performs case-insensitive substring matching against each annotation token.
 * Returns the first match found, or undefined if none match.
 */
export function detectRole(annotations: string): Role | undefined {
  if (!annotations) return undefined;

  const tokens = annotations.split(",").map((t) => t.trim().toLowerCase());

  for (const token of tokens) {
    for (const { pattern, role, exact } of ROLE_PATTERNS) {
      if (exact ? token === pattern : token.includes(pattern)) {
        return role;
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// External system detection
// ---------------------------------------------------------------------------

/**
 * Maps substring keywords (lowercased) to external system descriptors.
 * keyword is the canonical keyword stored in DetectedExternalSystem.
 */
const EXTERNAL_SYSTEM_PATTERNS: Array<{
  keyword: string;
  type: SystemType;
  technology: string;
  boundaryRegex?: RegExp;
}> = [
  // Databases
  { keyword: "postgresql", type: "Database", technology: "PostgreSQL" },
  { keyword: "mysql", type: "Database", technology: "MySQL" },
  // "oracle" is too broad (matches GraalVM, OCI SDK, etc.). Real Oracle
  // Database deps use "ojdbc" (e.g. "com.oracle.database.jdbc:ojdbc8",
  // "oracle:ojdbc14"). This keyword is unambiguous.
  { keyword: "ojdbc", type: "Database", technology: "Oracle" },
  { keyword: "sqlite", type: "Database", technology: "SQLite" },
  // "h2database" matches the Maven group ID (com.h2database:h2). The bare "h2"
  // keyword is too short and risks false positives (e.g. "auth2-client").
  { keyword: "h2database", type: "Database", technology: "H2" },
  // Message brokers
  { keyword: "kafka", type: "Message Broker", technology: "Apache Kafka" },
  { keyword: "rabbitmq", type: "Message Broker", technology: "RabbitMQ" },
  { keyword: "amqp", type: "Message Broker", technology: "RabbitMQ" },
  // Caches
  { keyword: "redis", type: "Cache", technology: "Redis" },
  { keyword: "jedis", type: "Cache", technology: "Redis" },
  { keyword: "lettuce", type: "Cache", technology: "Redis" },
  { keyword: "memcached", type: "Cache", technology: "Memcached" },
  // Search engines
  { keyword: "elasticsearch", type: "Search Engine", technology: "Elasticsearch" },
  { keyword: "opensearch", type: "Search Engine", technology: "OpenSearch" },
  // Object storage
  // "s3" requires word-boundary matching to avoid false positives on "css3",
  // "es3", "js3". Real deps are named like "aws-java-sdk-s3" or
  // "software.amazon.awssdk:s3" where s3 appears as a separate token.
  { keyword: "s3", type: "Object Storage", technology: "S3", boundaryRegex: /(?:^|[^a-z])s3(?:$|[^a-z0-9])/i },
  { keyword: "minio", type: "Object Storage", technology: "S3" },
];

/**
 * Detect external systems from a list of dependency names.
 * Performs case-insensitive substring matching.
 * Deduplicates results by type+technology, keeping the first match found.
 */
export function detectExternalSystems(depNames: string[]): DetectedExternalSystem[] {
  const seen = new Set<string>();
  const results: DetectedExternalSystem[] = [];

  for (const dep of depNames) {
    const depLower = dep.toLowerCase();
    for (const { keyword, type, technology, boundaryRegex } of EXTERNAL_SYSTEM_PATTERNS) {
      const matches = boundaryRegex
        ? boundaryRegex.test(depLower)
        : depLower.includes(keyword);
      if (matches) {
        const dedupeKey = `${type}::${technology}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push({ keyword, type, technology });
        }
        break; // stop checking patterns for this dep once matched
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Relationship label inference
// ---------------------------------------------------------------------------

/**
 * Infer a relationship label between two components based on their roles.
 * - controller source → "Delegates to"
 * - repository target → "Persists via"
 * - fallback → "Uses"
 *
 * Source role takes priority over target role when both match
 * (e.g. controller → repository yields "Delegates to", not "Persists via").
 */
export function inferRelationshipLabel(
  sourceRole: Role | undefined,
  targetRole: Role | undefined,
): string {
  if (sourceRole === "controller") return "Delegates to";
  if (targetRole === "repository") return "Persists via";
  return "Uses";
}

/**
 * Infer a relationship label from a component to an external system.
 */
const EXTERNAL_RELATIONSHIP_LABELS: Record<SystemType, string> = {
  "Database": "Reads/writes data in",
  "Message Broker": "Publishes/consumes messages via",
  "Cache": "Caches data in",
  "Search Engine": "Indexes/queries",
  "Object Storage": "Stores objects in",
};

export function inferExternalRelationshipLabel(systemType: SystemType): string {
  return EXTERNAL_RELATIONSHIP_LABELS[systemType];
}

// ---------------------------------------------------------------------------
// Component technology inference
// ---------------------------------------------------------------------------

const ROLE_TECH_LABELS: Record<Role, string> = {
  controller: "REST Controller",
  listener: "Message Listener",
  repository: "Repository",
  service: "Service",
};

/**
 * Infer a technology label for a component from its annotations and language.
 * Examples:
 *   ("RestController", "java") → "Java REST Controller"
 *   ("Service", "python")      → "Python Service"
 *   ("Transactional", "java")  → "Java"
 */
export function inferComponentTech(annotations: string, language: string): string {
  const lang = language.charAt(0).toUpperCase() + language.slice(1);
  const role = detectRole(annotations);
  if (!role) return lang;
  return `${lang} ${ROLE_TECH_LABELS[role]}`;
}
