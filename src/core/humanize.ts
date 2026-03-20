/**
 * Name conversion utilities for model generation.
 * Transforms machine-readable identifiers into human-friendly names.
 */

/**
 * Convert a kebab-case, snake_case, or dot.separated name to Title Case.
 *
 * Examples:
 *   "user-api"        → "User Api"
 *   "order_service"   → "Order Service"
 *   "com.example.user"→ "User" (last segment)
 */
export function humanizeName(input: string): string {
  // Take the last segment for dot-separated (Java package) names
  const segment = input.includes(".") ? input.split(".").pop()! : input;

  return segment
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Extract the last segment from a dot-separated or slash-separated path.
 *
 * Examples:
 *   "com.example.user" → "user"
 *   "services/user-api" → "user-api"
 */
export function lastSegment(input: string): string {
  if (input.includes(".")) return input.split(".").pop()!;
  if (input.includes("/")) return input.split("/").pop()!;
  return input;
}

/**
 * Infer a technology string from language + external dependencies.
 *
 * Examples:
 *   ("java", ["spring-boot-starter-web"]) → "Java / Spring Boot"
 *   ("python", ["fastapi"])               → "Python / FastAPI"
 *   ("c", [])                             → "C"
 */
export function inferTechnology(
  language: string,
  deps: string[],
): string {
  const lang = language.charAt(0).toUpperCase() + language.slice(1);
  const depsLower = deps.map((d) => d.toLowerCase());

  const framework = detectFramework(depsLower);
  return framework ? `${lang} / ${framework}` : lang;
}

const FRAMEWORK_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /spring-boot/, name: "Spring Boot" },
  { pattern: /spring-web/, name: "Spring MVC" },
  { pattern: /^fastapi$/, name: "FastAPI" },
  { pattern: /^flask$/, name: "Flask" },
  { pattern: /^django/, name: "Django" },
  { pattern: /^express$/, name: "Express" },
  { pattern: /^nestjs/, name: "NestJS" },
  { pattern: /^gin$/, name: "Gin" },
  { pattern: /^actix/, name: "Actix" },
];

function detectFramework(depsLower: string[]): string | null {
  for (const { pattern, name } of FRAMEWORK_PATTERNS) {
    if (depsLower.some((d) => pattern.test(d))) {
      return name;
    }
  }
  return null;
}
