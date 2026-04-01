/**
 * Config signal line extraction module. Takes signal-bearing config files and
 * replaces their raw content with flat dotted key-value pairs for each detected
 * architecture signal. Follows the same in-place mutation pattern as config-filter.ts.
 */

import type { ConfigSignal } from "./config-signals.js";
import type { ScannedApplication } from "../analyzers/types.js";

export interface ExtractionResult {
  filePath: string;
  originalLineCount: number;
  extractedSignalCount: number;
}

export function extractSignalLines(
  _content: string,
  _filePath: string,
  _signals: readonly ConfigSignal[],
): string {
  throw new Error("Not implemented");
}

export function applyConfigExtraction(
  _applications: ScannedApplication[],
): Map<string, ExtractionResult[]> {
  throw new Error("Not implemented");
}
