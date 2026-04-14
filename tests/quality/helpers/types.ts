/**
 * Quality metric types used across all quality tests.
 */

export interface SetMetrics {
  precision: number;
  recall: number;
  f1: number;
  found: number;
  expected: number;
  matched: number;
  missing: string[];
  extra: string[];
}

export interface CorrectnessReport {
  fixture: string;
  language: string;
  categories: Record<string, SetMetrics>;
  overallF1: number;
  suggestions: string[];
}

export interface DriftReport {
  scenario: string;
  /** Fraction of output that stayed identical (0-1) */
  stabilityScore: number;
  /** Lines added + deleted vs total lines */
  lineChurn: number;
  /** Number of D2 shape IDs that changed */
  idChanges: number;
  /** D2 shape IDs that were renamed (old -> new) */
  renames: Array<{ old: string; new: string }>;
  /** Whether user files would be broken */
  userFilesBroken: boolean;
  suggestions: string[];
}

export interface TokenReport {
  fixture: string;
  /** Token count of raw-structure.json (pretty) */
  prettyTokens: number;
  /** Token count of raw-structure.json (compact) */
  compactTokens: number;
  /** Number of entities (modules + imports + deps) */
  entityCount: number;
  /** Tokens per entity */
  tokensPerEntity: number;
  /** Savings from compact vs pretty (fraction) */
  compactSavings: number;
  suggestions: string[];
}

/**
 * Ground truth expected output for a single fixture application.
 * Only specifies what MUST be found — the test measures what's missing or extra.
 */
export interface ExpectedApplication {
  language: "java" | "python" | "c" | "typescript";
  modules: Array<{
    /** Module name (package name for Java, module name for Python, dir name for C) */
    name: string;
    /** Public exports that must be found */
    exports: string[];
  }>;
  imports: Array<{
    /** The import source string */
    source: string;
    /** Which module this import is in */
    inModule: string;
    /** Whether this import is external */
    isExternal: boolean;
  }>;
  externalDependencies: Array<{
    name: string;
  }>;
  metadata: Record<string, Record<string, string>>;
  /** Expected C4 code-level elements (name + kind only). */
  codeElements?: Array<{
    name: string;
    kind: string;
  }>;
}
