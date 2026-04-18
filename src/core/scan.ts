/**
 * Core scan pipeline: discover applications and run static analysis.
 * Reusable by both the `scan` CLI command and the `generate` auto-scan fallback.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverApplications } from "./discovery.js";
import {
  computeChecksum,
  computeProjectSourceHash,
  mixFingerprint,
} from "./checksum.js";
import {
  readManifest,
  writeManifest,
  createDefaultManifest,
} from "./manifest.js";
import {
  readProjectCache,
  writeProjectScan,
  isScanStale,
} from "./per-project-cache.js";
import { getAnalyzer } from "../analyzers/registry.js";
import { slugify } from "./slugify.js";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../cli/terminal-utils.js";
import type { Config } from "../config/schema.js";
import type { RawStructure, ScannedApplication } from "../analyzers/types.js";
import type { DiscoveredProject } from "./discovery.js";
import { applyConfigFiltering } from "./config-filter.js";
import { applyConfigExtraction } from "./config-extraction.js";

export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanError";
  }
}

export interface ScanOptions {
  rootDir: string;
  config: Config;
  force?: boolean;
  verbose?: boolean;
}

export interface ScanResult {
  rawStructure: RawStructure;
  fromCache: boolean;
}

/**
 * Build the config fingerprint fed into the scan cache checksum. Any config
 * key that an analyzer or scan-phase code path branches on MUST be included
 * here — otherwise toggling that key silently hits stale cache and the
 * downstream feature appears disabled. The whole-repo scan also folds in
 * `scan.include` (via `includeScanInclude`); per-project scans operate on
 * already-discovered paths so it's omitted there.
 */
/**
 * Bump when the scan output format changes in a way that would make old
 * cached `scan.json` incompatible with the current analyzers — e.g. a new
 * field that downstream stages now rely on. The version is mixed into the
 * cache fingerprint so stale caches from the previous format are rebuilt
 * instead of silently feeding incomplete data into model building.
 *
 * 2: added CodeElement.qualifiedName + RawCodeReference.targetQualifiedName
 *    (commit 7678554) — without this, resolver falls back to simple-name
 *    and reports spurious collisions. Bumped alongside this fingerprint
 *    change so previously-written scan caches get rebuilt on next run.
 */
export const SCAN_SCHEMA_VERSION = 2;

/**
 * Bump when L1–L3 model-building logic changes in a way that would make
 * previously cached per-project `model.yaml` fragments inconsistent with
 * the current builder — e.g. a change in how components are grouped.
 *
 * Kept separate from SCAN_SCHEMA_VERSION so that scan-output-format bumps
 * don't needlessly invalidate model caches (and vice versa).
 */
export const MODEL_SCHEMA_VERSION = 1;

/**
 * Build the fingerprint used to decide whether the L1–L3 architecture model
 * is stale. Must contain every config key that affects `model-builder.ts`
 * output (containers, components, relationships). Must NOT contain L4-only
 * knobs (`levels.code`, `code.*`) — those re-invalidate the scan but the
 * cached model can be reused and L4 re-attached from the fresh scan.
 *
 * Contract: any new config key that influences L1–L3 must be added here AND
 * in `buildScanFingerprint`. The tripwire test in
 * `tests/config/fingerprint-coverage.test.ts` enforces explicit
 * classification of every top-level config key.
 */
export function buildModelFingerprint(
  effectiveExcludes: string[],
  config: Config,
  options?: { includeScanInclude?: boolean },
): string {
  const fingerprint: Record<string, unknown> = {
    modelSchemaVersion: MODEL_SCHEMA_VERSION,
    exclude: effectiveExcludes,
    abstraction: config.abstraction,
  };
  if (options?.includeScanInclude) {
    fingerprint.include = config.scan.include;
  }
  return JSON.stringify(fingerprint);
}

export function buildScanFingerprint(
  effectiveExcludes: string[],
  config: Config,
  options?: { includeScanInclude?: boolean },
): string {
  const fingerprint: Record<string, unknown> = {
    schemaVersion: SCAN_SCHEMA_VERSION,
    exclude: effectiveExcludes,
    abstraction: config.abstraction,
    levels: config.levels,
    code: config.code,
  };
  if (options?.includeScanInclude) {
    fingerprint.include = config.scan.include;
  }
  return JSON.stringify(fingerprint);
}

/**
 * Post-scan pass: match externalDependencies against other apps'
 * publishedAs coordinates. Matches are promoted to internalImports.
 */
export function matchCrossAppCoordinates(
  applications: ScannedApplication[],
): void {
  // Build lookup: "group:artifact" → app ID
  const coordToAppId = new Map<string, string>();
  for (const app of applications) {
    if (app.publishedAs) {
      coordToAppId.set(app.publishedAs, app.id);
    }
  }

  for (const app of applications) {
    const remaining: typeof app.externalDependencies = [];

    for (const dep of app.externalDependencies) {
      const coord = dep.name;
      const targetAppId = coordToAppId.get(coord);

      if (targetAppId && targetAppId !== app.id) {
        app.internalImports.push({
          sourceModuleId: app.id,
          targetApplicationId: targetAppId,
          targetPath:
            applications.find((a) => a.id === targetAppId)?.path ?? targetAppId,
        });
      } else {
        remaining.push(dep);
      }
    }

    app.externalDependencies = remaining;
  }
}

/**
 * Post-scan pass: merge subproject apps into their shell parent's identity.
 *
 * A "shell parent" is an app with 0 modules whose path is a prefix of at least
 * one other app's path — typically a Gradle/Maven multi-module root that has no
 * source code of its own.
 *
 * - Root (`.`) shell parents are skipped (monorepo roots, not single deployable units).
 * - Single child → child inherits parent's ID, name, and path.
 * - Multiple children → modules/deps are merged under the parent's identity.
 *
 * All `internalImports.targetApplicationId` references across ALL apps are
 * rewritten so downstream consumers never see the old child IDs.
 */
export function rollUpShellParents(
  applications: ScannedApplication[],
): ScannedApplication[] {
  // Identify non-root shell parents
  const shellParents = applications.filter(
    (app) =>
      app.modules.length === 0 &&
      app.path !== "." &&
      applications.some(
        (other) =>
          other.path !== app.path && isDirectChild(app.path, other.path),
      ),
  );

  if (shellParents.length === 0) return applications;

  // Map: old child ID → new (parent) ID
  const remap = new Map<string, string>();
  const removedIds = new Set<string>();

  const merged: ScannedApplication[] = [];

  for (const parent of shellParents) {
    const children = applications.filter(
      (a) => a.path !== parent.path && isDirectChild(parent.path, a.path),
    );
    if (children.length === 0) continue;

    removedIds.add(parent.id);
    for (const child of children) {
      removedIds.add(child.id);
      remap.set(child.id, parent.id);
    }

    // Also remap the parent's own ID (in case something references it)
    // This is a no-op mapping but keeps the logic uniform
    remap.set(parent.id, parent.id);

    const mergedApp = mergeIntoParent(parent, children);

    // Remove intra-group internalImports (children referencing each other)
    mergedApp.internalImports = mergedApp.internalImports.filter(
      (imp) => !removedIds.has(imp.targetApplicationId),
    );

    merged.push(mergedApp);
  }

  // Build final list: keep apps not involved in any roll-up, then add merged
  const result = applications.filter((a) => !removedIds.has(a.id));
  result.push(...merged);

  // Rewrite internalImports across all remaining apps
  for (const app of result) {
    for (const imp of app.internalImports) {
      const newId = remap.get(imp.targetApplicationId);
      if (newId) {
        imp.targetApplicationId = newId;
        // Also update targetPath to the merged app's path
        const target = result.find((a) => a.id === newId);
        if (target) imp.targetPath = target.path;
      }
    }
  }

  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function isDirectChild(parentPath: string, candidatePath: string): boolean {
  if (!candidatePath.startsWith(parentPath + "/")) return false;
  const rest = candidatePath.slice(parentPath.length + 1);
  return !rest.includes("/");
}

function mergeIntoParent(
  parent: ScannedApplication,
  children: ScannedApplication[],
): ScannedApplication {
  const first = children[0];

  // Deduplicate external deps by name
  const seenDeps = new Set<string>();
  const externalDependencies = [];
  for (const child of children) {
    for (const dep of child.externalDependencies) {
      if (!seenDeps.has(dep.name)) {
        seenDeps.add(dep.name);
        externalDependencies.push(dep);
      }
    }
  }

  return {
    id: parent.id,
    path: parent.path,
    name: parent.name,
    language: first.language,
    buildFile: first.buildFile,
    modules: children.flatMap((c) => c.modules),
    externalDependencies,
    internalImports: children.flatMap((c) => c.internalImports),
    publishedAs: children.find((c) => c.publishedAs)?.publishedAs,
    configFiles: children.flatMap((c) => c.configFiles ?? []),
  };
}

/**
 * Expects `config.scan.exclude` to already be the effective set
 * (see `buildEffectiveConfig` in src/config/loader.ts). Callers compute it
 * once at the CLI boundary and thread it through.
 */
export async function runScan({
  rootDir,
  config: effectiveConfig,
  force,
  verbose,
}: ScanOptions): Promise<ScanResult> {
  const effectiveExcludes = effectiveConfig.scan.exclude;

  // Discover applications
  console.error("Discovering applications...");
  const discovered = await discoverApplications(rootDir, effectiveConfig, {
    onSearching: (language, pattern) => {
      console.error(`  Searching: ${language} (${pattern})`);
    },
    onFound: (app) => {
      console.error(`  Found: ${app.path} (${app.buildFile})`);
    },
  });

  if (discovered.length === 0) {
    throw new ScanError(
      "No applications discovered. Check your scan.include patterns.",
    );
  }

  console.error(`Discovered ${discovered.length} application(s):`);
  for (const app of discovered) {
    console.error(`  ${app.language}: ${app.path} (${app.buildFile})`);
  }

  // Check cache — include scan-relevant config so config changes invalidate it
  const manifest = readManifest(rootDir) ?? createDefaultManifest();
  const configFingerprint = buildScanFingerprint(
    effectiveExcludes,
    effectiveConfig,
    { includeScanInclude: true },
  );
  let spinnerIdx = 0;
  const isTTY = process.stderr.isTTY;
  const spinnerTimer = isTTY
    ? setInterval(() => {
        process.stderr.write(
          `\r${SPINNER_FRAMES[spinnerIdx++ % SPINNER_FRAMES.length]} Computing checksum...`,
        );
      }, SPINNER_INTERVAL)
    : undefined;
  const checksum = await computeChecksum(
    rootDir,
    discovered.map((d) => d.path),
    effectiveExcludes,
    configFingerprint,
  );
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    process.stderr.write("\r\x1b[K✔ Checksum computed\n");
  }

  if (!force && manifest.lastScan?.checksum === checksum) {
    const cachedPath = path.resolve(
      rootDir,
      ".diagram-docs",
      manifest.rawStructure,
    );
    if (fs.existsSync(cachedPath)) {
      const cached = fs.readFileSync(cachedPath, "utf-8");
      const rawStructure: RawStructure = JSON.parse(cached);
      return { rawStructure, fromCache: true };
    }
  }

  // Run analyzers
  const scanConfig = {
    exclude: effectiveExcludes,
    abstraction: effectiveConfig.abstraction,
    levels: effectiveConfig.levels,
    code: effectiveConfig.code,
  };

  const applications: ScannedApplication[] = [];
  const rootPrefix = slugify(rootDir);
  const total = discovered.length;
  for (let i = 0; i < total; i++) {
    const app = discovered[i];
    const analyzer = getAnalyzer(app.analyzerId);
    if (!analyzer) {
      console.error(`No analyzer found for ${app.analyzerId}`);
      continue;
    }
    console.error(`Analyzing (${i + 1}/${total}): ${app.path}`);
    const result = await analyzer.analyze(
      path.resolve(rootDir, app.path),
      scanConfig,
    );
    // Normalize to relative path-based IDs (analyzers receive absolute paths
    // but IDs should be stable and relative to the project root)
    const relativeId = slugify(app.path);
    const absolutePrefix = slugify(path.resolve(rootDir, app.path));

    result.path = app.path;
    result.id = relativeId;

    // Fix module IDs: replace the absolute-path prefix with the relative one
    for (const mod of result.modules) {
      if (mod.id.startsWith(absolutePrefix)) {
        mod.id = relativeId + mod.id.slice(absolutePrefix.length);
      }
    }
    // Fix import resolved references that use the absolute prefix
    for (const mod of result.modules) {
      for (const imp of mod.imports) {
        if (imp.resolved?.startsWith(absolutePrefix)) {
          imp.resolved = relativeId + imp.resolved.slice(absolutePrefix.length);
        }
      }
    }

    // Fix internalImports targetApplicationId: replace absolute-path prefix
    for (const imp of result.internalImports) {
      if (imp.targetApplicationId.startsWith(absolutePrefix)) {
        imp.targetApplicationId =
          relativeId + imp.targetApplicationId.slice(absolutePrefix.length);
      }
      // Also normalize targets that use absolute paths of other apps
      if (imp.targetApplicationId.startsWith(rootPrefix)) {
        imp.targetApplicationId = imp.targetApplicationId.slice(
          rootPrefix.length + 1,
        ); // +1 for the separator
      }
    }

    applications.push(result);
  }

  // Cross-app coordinate matching
  matchCrossAppCoordinates(applications);

  // Roll up shell parent projects (e.g. Gradle multi-module roots with no code)
  const rolledUpApplications = rollUpShellParents(applications);

  // Filter config files by architecture signals (Phase 2)
  const filterResults = applyConfigFiltering(rolledUpApplications);
  if (verbose) {
    for (const [, result] of filterResults) {
      for (const file of result.kept) {
        const count = result.signals.filter(
          (s) => s.filePath === file.path,
        ).length;
        console.error(`  Kept: ${file.path} (${count} signals)`);
      }
      for (const droppedPath of result.dropped) {
        console.error(`  Filtered: ${droppedPath} (0 signals)`);
      }
    }
  }

  // Extract only signal-bearing lines from config files (Phase 3)
  const extractionResults = applyConfigExtraction(rolledUpApplications);
  if (verbose) {
    for (const [, appResults] of extractionResults) {
      for (const r of appResults) {
        console.error(
          `  Extracted: ${r.filePath} (${r.originalLineCount} → ${r.extractedSignalCount} lines)`,
        );
      }
    }
  }

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum,
    applications: rolledUpApplications,
  };

  const json = JSON.stringify(rawStructure, null, 2);

  // Write to .diagram-docs/raw-structure.json
  const manifestDir = path.join(rootDir, ".diagram-docs");
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }
  fs.writeFileSync(path.join(manifestDir, "raw-structure.json"), json, "utf-8");

  // Update manifest
  manifest.lastScan = {
    timestamp: new Date().toISOString(),
    checksum,
  };
  writeManifest(rootDir, manifest);
  console.error("Manifest updated.");

  return { rawStructure, fromCache: false };
}

export interface ProjectScanResult {
  project: DiscoveredProject;
  scan: RawStructure;
  /** True when the project's scan output came from cache (no re-analyze). */
  fromCache: boolean;
  /**
   * True when the L1–L3 model derived from this scan needs to be rebuilt —
   * source files changed or a structural config key (excludes, abstraction,
   * schemaVersion, optional scan.include) changed. L4-only config toggles
   * do NOT set this.
   */
  modelStale: boolean;
}

/**
 * Scan a single project, using per-project cache.
 *
 * Expects `config.scan.exclude` to already be the effective set
 * (see `buildEffectiveConfig` in src/config/loader.ts). Callers compute it
 * once at the CLI boundary and thread it through.
 */
export async function runProjectScan(options: {
  rootDir: string;
  project: DiscoveredProject;
  config: Config;
  force?: boolean;
  verbose?: boolean;
}): Promise<ProjectScanResult> {
  const { rootDir, project, config: effectiveConfig, force, verbose } = options;
  const projectAbsPath = path.resolve(rootDir, project.path);
  const effectiveExcludes = effectiveConfig.scan.exclude;

  const scanFingerprint = buildScanFingerprint(
    effectiveExcludes,
    effectiveConfig,
  );
  const modelFingerprint = buildModelFingerprint(
    effectiveExcludes,
    effectiveConfig,
  );

  const sourceHash = await computeProjectSourceHash(
    projectAbsPath,
    effectiveExcludes,
  );
  const scanChecksum = mixFingerprint(sourceHash, scanFingerprint);
  const modelChecksum = mixFingerprint(sourceHash, modelFingerprint);

  if (!force && !isScanStale(projectAbsPath, scanChecksum)) {
    const cache = readProjectCache(projectAbsPath);
    if (cache) {
      return {
        project,
        scan: cache.scan,
        fromCache: true,
        modelStale: cache.modelChecksum !== modelChecksum,
      };
    }
  }

  // Scan was stale (or missing) — re-run the analyzer.
  const analyzer = getAnalyzer(project.analyzerId);
  if (!analyzer) {
    throw new ScanError(`No analyzer found for ${project.analyzerId}`);
  }

  const scanConfig = {
    exclude: effectiveExcludes,
    abstraction: effectiveConfig.abstraction,
    levels: effectiveConfig.levels,
    code: effectiveConfig.code,
  };

  const result = await analyzer.analyze(projectAbsPath, scanConfig);

  const relativeId = slugify(project.path);
  const absolutePrefix = slugify(projectAbsPath);
  result.path = project.path;
  result.id = relativeId;

  for (const mod of result.modules) {
    if (mod.id.startsWith(absolutePrefix)) {
      mod.id = relativeId + mod.id.slice(absolutePrefix.length);
    }
  }
  for (const mod of result.modules) {
    for (const imp of mod.imports) {
      if (imp.resolved?.startsWith(absolutePrefix)) {
        imp.resolved = relativeId + imp.resolved.slice(absolutePrefix.length);
      }
    }
  }

  const filterResults = applyConfigFiltering([result]);
  if (verbose) {
    for (const [, filterResult] of filterResults) {
      for (const file of filterResult.kept) {
        const count = filterResult.signals.filter(
          (s) => s.filePath === file.path,
        ).length;
        console.error(`  Kept: ${file.path} (${count} signals)`);
      }
      for (const droppedPath of filterResult.dropped) {
        console.error(`  Filtered: ${droppedPath} (0 signals)`);
      }
    }
  }

  const extractionResults = applyConfigExtraction([result]);
  if (verbose) {
    for (const [, appResults] of extractionResults) {
      for (const r of appResults) {
        console.error(
          `  Extracted: ${r.filePath} (${r.originalLineCount} → ${r.extractedSignalCount} lines)`,
        );
      }
    }
  }

  const scan: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: scanChecksum,
    applications: [result],
  };

  // Must read the previous cache BEFORE writing the new one, otherwise
  // modelStale would always be false on every re-scan.
  const prevCache = readProjectCache(projectAbsPath);
  const modelStale = !prevCache || prevCache.modelChecksum !== modelChecksum;

  writeProjectScan(projectAbsPath, scan, scanChecksum, modelChecksum);

  return { project, scan, fromCache: false, modelStale };
}

/**
 * Scan all projects from root, using per-project caching.
 * Returns combined RawStructure + per-project results.
 *
 * When `getProjectConfig` is provided, each project's config is resolved
 * individually (cascading config). Otherwise `config` is used for all projects.
 */
export async function runScanAll(options: {
  rootDir: string;
  config: Config;
  projects: DiscoveredProject[];
  getProjectConfig?: (projectAbsPath: string) => Config;
  force?: boolean;
  verbose?: boolean;
}): Promise<{
  rawStructure: RawStructure;
  projectResults: ProjectScanResult[];
  staleProjects: DiscoveredProject[];
}> {
  const { rootDir, config, projects, getProjectConfig, force, verbose } =
    options;
  const projectResults: ProjectScanResult[] = [];
  const staleProjects: DiscoveredProject[] = [];

  for (const project of projects) {
    console.error(`Scanning: ${project.path} (${project.type})`);
    const projectAbsPath = path.resolve(rootDir, project.path);
    const projectConfig = getProjectConfig
      ? getProjectConfig(projectAbsPath)
      : config;
    const result = await runProjectScan({
      rootDir,
      project,
      config: projectConfig,
      force,
      verbose,
    });

    if (result.fromCache) {
      console.error(`  Cached (unchanged)`);
    } else {
      console.error(`  Scanned`);
      staleProjects.push(project);
    }

    projectResults.push(result);
  }

  // Combine into a single RawStructure
  const allApplications = projectResults.flatMap((r) => r.scan.applications);

  // Cross-app coordinate matching
  matchCrossAppCoordinates(allApplications);

  // Filter config files by architecture signals (Phase 2)
  const filterResults = applyConfigFiltering(allApplications);
  if (verbose) {
    for (const [, filterResult] of filterResults) {
      for (const file of filterResult.kept) {
        const count = filterResult.signals.filter(
          (s) => s.filePath === file.path,
        ).length;
        console.error(`  Kept: ${file.path} (${count} signals)`);
      }
      for (const droppedPath of filterResult.dropped) {
        console.error(`  Filtered: ${droppedPath} (0 signals)`);
      }
    }
  }

  // Extract only signal-bearing lines from config files (Phase 3)
  const extractionResults = applyConfigExtraction(allApplications);
  if (verbose) {
    for (const [, appResults] of extractionResults) {
      for (const r of appResults) {
        console.error(
          `  Extracted: ${r.filePath} (${r.originalLineCount} → ${r.extractedSignalCount} lines)`,
        );
      }
    }
  }

  const combinedChecksum = allApplications
    .map((a) => a.id)
    .sort()
    .join(",");

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum: `combined:${combinedChecksum}`,
    applications: allApplications,
  };

  return { rawStructure, projectResults, staleProjects };
}
