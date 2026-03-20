import type {
  CorrectnessReport,
  DriftReport,
  TokenReport,
  SetMetrics,
} from "./types.js";

/**
 * Format a correctness report with suggestions for improvement.
 */
export function formatCorrectnessReport(report: CorrectnessReport): string {
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(70)}`);
  lines.push(`CORRECTNESS: ${report.fixture} (${report.language})`);
  lines.push(`${"=".repeat(70)}`);

  for (const [category, metrics] of Object.entries(report.categories)) {
    const status = metrics.f1 >= 0.95 ? "PASS" : metrics.f1 >= 0.8 ? "WARN" : "FAIL";
    lines.push(
      `  [${status}] ${category}: P=${fmt(metrics.precision)} R=${fmt(metrics.recall)} F1=${fmt(metrics.f1)} (${metrics.matched}/${metrics.expected} matched, ${metrics.extra.length} extra)`,
    );
    if (metrics.missing.length > 0) {
      lines.push(`         missing: ${metrics.missing.join(", ")}`);
    }
    if (metrics.extra.length > 0) {
      lines.push(`         extra:   ${metrics.extra.join(", ")}`);
    }
  }

  lines.push(`  Overall F1: ${fmt(report.overallF1)}`);

  if (report.suggestions.length > 0) {
    lines.push(`\n  Suggestions:`);
    for (const s of report.suggestions) {
      lines.push(`    - ${s}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a drift report with suggestions.
 */
export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = [];
  const status =
    report.stabilityScore >= 0.95
      ? "PASS"
      : report.stabilityScore >= 0.8
        ? "WARN"
        : "FAIL";

  lines.push(`\n${"=".repeat(70)}`);
  lines.push(`DRIFT: ${report.scenario}`);
  lines.push(`${"=".repeat(70)}`);
  lines.push(`  [${status}] Stability: ${fmt(report.stabilityScore)} | Line churn: ${fmt(report.lineChurn)} | ID changes: ${report.idChanges}`);

  if (report.renames.length > 0) {
    lines.push(`  Renames:`);
    for (const r of report.renames) {
      lines.push(`    ${r.old} -> ${r.new}`);
    }
  }

  if (report.userFilesBroken) {
    lines.push(`  [FAIL] User files would break after this change`);
  }

  if (report.suggestions.length > 0) {
    lines.push(`\n  Suggestions:`);
    for (const s of report.suggestions) {
      lines.push(`    - ${s}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a token efficiency report with suggestions.
 */
export function formatTokenReport(report: TokenReport): string {
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(70)}`);
  lines.push(`TOKEN EFFICIENCY: ${report.fixture}`);
  lines.push(`${"=".repeat(70)}`);
  lines.push(`  Pretty:  ${report.prettyTokens} tokens`);
  lines.push(`  Compact: ${report.compactTokens} tokens (${fmt(report.compactSavings * 100)}% smaller)`);
  lines.push(`  Entities: ${report.entityCount} | Tokens/entity: ${fmt(report.tokensPerEntity)}`);

  if (report.suggestions.length > 0) {
    lines.push(`\n  Suggestions:`);
    for (const s of report.suggestions) {
      lines.push(`    - ${s}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate suggestions from correctness metrics.
 */
export function generateCorrectnessSuggestions(
  fixture: string,
  categories: Record<string, SetMetrics>,
): string[] {
  const suggestions: string[] = [];

  for (const [category, metrics] of Object.entries(categories)) {
    if (metrics.recall < 1.0 && metrics.missing.length > 0) {
      suggestions.push(
        `${category}: missed ${metrics.missing.length} item(s) — recall is ${fmt(metrics.recall)}. Missing: ${metrics.missing.slice(0, 3).join(", ")}${metrics.missing.length > 3 ? "..." : ""}`,
      );
    }
    if (metrics.precision < 1.0 && metrics.extra.length > 0) {
      suggestions.push(
        `${category}: found ${metrics.extra.length} extra item(s) — precision is ${fmt(metrics.precision)}. Extra: ${metrics.extra.slice(0, 3).join(", ")}${metrics.extra.length > 3 ? "..." : ""}`,
      );
    }
  }

  return suggestions;
}

/**
 * Generate suggestions from drift metrics.
 */
export function generateDriftSuggestions(report: DriftReport): string[] {
  const suggestions: string[] = [];

  if (report.renames.length > 0) {
    suggestions.push(
      `${report.renames.length} ID rename(s) detected. Consider decoupling D2 shape IDs from file paths — use build-file metadata (artifactId, project name) for more stable IDs.`,
    );
  }

  if (report.lineChurn > 0.3) {
    suggestions.push(
      `Line churn is ${fmt(report.lineChurn * 100)}%. Investigate which output sections changed — sorting instability or whitespace differences may be inflating churn.`,
    );
  }

  if (report.userFilesBroken) {
    suggestions.push(
      `User files reference generated shape IDs that no longer exist. Consider a migration mechanism or alias system to preserve user customizations across renames.`,
    );
  }

  if (report.idChanges === 0 && report.lineChurn === 0) {
    suggestions.push(`No drift detected — output is stable for this scenario.`);
  }

  return suggestions;
}

/**
 * Generate suggestions from token metrics.
 */
export function generateTokenSuggestions(report: TokenReport): string[] {
  const suggestions: string[] = [];

  if (report.compactSavings > 0.15) {
    suggestions.push(
      `Compact JSON saves ${fmt(report.compactSavings * 100)}%. Consider a --compact flag for agent consumption.`,
    );
  }

  if (report.tokensPerEntity > 50) {
    suggestions.push(
      `${fmt(report.tokensPerEntity)} tokens/entity is high. Consider omitting ScannedModule.files[] (list of file paths) to reduce verbosity — agents rarely need individual file names.`,
    );
  }

  if (report.prettyTokens > 10000) {
    suggestions.push(
      `Output exceeds 10k tokens. For large repos, consider a --summary mode that omits module-level detail and only reports application-level structure.`,
    );
  }

  return suggestions;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}
