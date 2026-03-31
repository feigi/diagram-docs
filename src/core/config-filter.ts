/**
 * Config file filtering module. Uses the signal detection engine to separate
 * zero-signal config files from signal-bearing ones, and enriches
 * ScannedApplication with detected architecture signals.
 */

import { detectConfigSignals, type ConfigSignal } from "./config-signals.js";
import type { ScannedApplication } from "../analyzers/types.js";

export interface FilterResult {
  kept: Array<{ path: string; content: string }>;
  dropped: string[];
  signals: ConfigSignal[];
}

/**
 * Filter config files by architecture signal presence. Files with at least
 * one detected signal are kept; files with zero signals are dropped.
 *
 * Returns the kept files (with content), dropped file paths, and all
 * detected signals. Pure function — identical input produces identical output.
 */
export function filterConfigFiles(
  configFiles: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>,
): FilterResult {
  if (configFiles.length === 0) {
    return { kept: [], dropped: [], signals: [] };
  }

  const allSignals = detectConfigSignals(configFiles);
  const filesWithSignals = new Set(allSignals.map((s) => s.filePath));

  const kept: Array<{ path: string; content: string }> = [];
  const dropped: string[] = [];

  for (const file of configFiles) {
    if (filesWithSignals.has(file.path)) {
      kept.push({ path: file.path, content: file.content });
    } else {
      dropped.push(file.path);
    }
  }

  return { kept, dropped, signals: allSignals };
}

/**
 * Apply config filtering to a list of ScannedApplications. For each app
 * with configFiles, runs filterConfigFiles and mutates the app:
 * - Sets configFiles to kept files (or undefined if all dropped)
 * - Sets signals to detected signals (or undefined if none)
 *
 * Returns a Map keyed by app.id with the FilterResult for each processed app.
 * Apps without configFiles (undefined or empty) are skipped.
 */
export function applyConfigFiltering(
  applications: ScannedApplication[],
): Map<string, FilterResult> {
  const results = new Map<string, FilterResult>();

  for (const app of applications) {
    if (!app.configFiles || app.configFiles.length === 0) continue;

    const result = filterConfigFiles(app.configFiles);
    results.set(app.id, result);

    app.configFiles = result.kept.length > 0 ? result.kept : undefined;
    app.signals = result.signals.length > 0 ? result.signals : undefined;
  }

  return results;
}
