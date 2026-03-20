import type { SetMetrics } from "./types.js";

/**
 * Compute precision, recall, and F1 from two sets of string keys.
 * `found` = what the tool produced, `expected` = ground truth.
 */
export function computeSetMetrics(
  found: string[],
  expected: string[],
): SetMetrics {
  const foundSet = new Set(found);
  const expectedSet = new Set(expected);

  const matched = found.filter((f) => expectedSet.has(f));
  const missing = expected.filter((e) => !foundSet.has(e));
  const extra = found.filter((f) => !expectedSet.has(f));

  const precision = found.length === 0 ? 1 : matched.length / found.length;
  const recall =
    expected.length === 0 ? 1 : matched.length / expected.length;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    found: found.length,
    expected: expected.length,
    matched: matched.length,
    missing,
    extra,
  };
}

/**
 * Macro-average F1 across multiple categories.
 */
export function macroF1(categories: Record<string, SetMetrics>): number {
  const values = Object.values(categories);
  if (values.length === 0) return 0;
  return values.reduce((sum, m) => sum + m.f1, 0) / values.length;
}

/**
 * Extract D2 shape IDs from D2 text content.
 * Finds all identifiers that appear before `:` or in connections.
 */
export function extractD2ShapeIds(d2Content: string): string[] {
  const ids = new Set<string>();

  for (const line of d2Content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Shape declaration: `id: label` or `id.prop: value`
    const shapeMatch = trimmed.match(/^([a-z0-9_.-]+)\s*[:{]/i);
    if (shapeMatch) {
      ids.add(shapeMatch[1].split(".")[0]);
    }

    // Connection: `a -> b` or `a.x -> b.y`
    const connMatch = trimmed.match(
      /^([a-z0-9_.-]+)\s*->\s*([a-z0-9_.-]+)/i,
    );
    if (connMatch) {
      ids.add(connMatch[1].split(".")[0]);
      ids.add(connMatch[2].split(".")[0]);
    }
  }

  return [...ids].sort();
}

/**
 * Compute line-level diff metrics between two strings.
 */
export function computeLineChurn(
  before: string,
  after: string,
): { additions: number; deletions: number; totalLines: number; churn: number } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Simple line diff: count lines only in before (deleted) or only in after (added)
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const deletions = beforeLines.filter((l) => !afterSet.has(l)).length;
  const additions = afterLines.filter((l) => !beforeSet.has(l)).length;
  const totalLines = Math.max(beforeLines.length, afterLines.length);
  const churn = totalLines === 0 ? 0 : (additions + deletions) / totalLines;

  return { additions, deletions, totalLines, churn };
}
