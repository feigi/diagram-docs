/**
 * Core scan pipeline: discover applications and run static analysis.
 * Reusable by both the `scan` CLI command and the `generate` auto-scan fallback.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverApplications } from "./discovery.js";
import { computeChecksum } from "./checksum.js";
import {
  readManifest,
  writeManifest,
  createDefaultManifest,
} from "./manifest.js";
import { getAnalyzer } from "../analyzers/registry.js";
import { slugify } from "./slugify.js";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../cli/terminal-utils.js";
import type { Config } from "../config/schema.js";
import type { RawStructure, ScannedApplication } from "../analyzers/types.js";

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
}

export interface ScanResult {
  rawStructure: RawStructure;
  fromCache: boolean;
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
          targetPath: applications.find((a) => a.id === targetAppId)?.path ?? targetAppId,
        });
      } else {
        remaining.push(dep);
      }
    }

    app.externalDependencies = remaining;
  }
}

export async function runScan({ rootDir, config, force }: ScanOptions): Promise<ScanResult> {
  // Discover applications
  console.error("Discovering applications...");
  const discovered = await discoverApplications(rootDir, config, {
    onSearching: (language, pattern) => {
      console.error(`  Searching: ${language} (${pattern})`);
    },
    onFound: (app) => {
      console.error(`  Found: ${app.path} (${app.buildFile})`);
    },
  });

  if (discovered.length === 0) {
    throw new ScanError("No applications discovered. Check your scan.include patterns.");
  }

  console.error(`Discovered ${discovered.length} application(s):`);
  for (const app of discovered) {
    console.error(`  ${app.language}: ${app.path} (${app.buildFile})`);
  }

  // Check cache — include scan-relevant config so config changes invalidate it
  const manifest = readManifest(rootDir) ?? createDefaultManifest();
  const configFingerprint = JSON.stringify({
    exclude: config.scan.exclude,
    include: config.scan.include,
    abstraction: config.abstraction,
  });
  console.error("Computing checksum...");
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
    config.scan.exclude,
    configFingerprint,
  );
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    process.stderr.write("\r✔ Checksum computed\n");
  }

  if (
    !force &&
    manifest.lastScan?.checksum === checksum
  ) {
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
    exclude: config.scan.exclude,
    abstraction: config.abstraction,
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
        imp.targetApplicationId =
          imp.targetApplicationId.slice(rootPrefix.length + 1); // +1 for the separator
      }
    }

    applications.push(result);
  }

  // Cross-app coordinate matching
  matchCrossAppCoordinates(applications);

  const rawStructure: RawStructure = {
    version: 1,
    scannedAt: new Date().toISOString(),
    checksum,
    applications,
  };

  const json = JSON.stringify(rawStructure, null, 2);

  // Write to .diagram-docs/raw-structure.json
  const manifestDir = path.join(rootDir, ".diagram-docs");
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(manifestDir, "raw-structure.json"),
    json,
    "utf-8",
  );

  // Update manifest
  manifest.lastScan = {
    timestamp: new Date().toISOString(),
    checksum,
  };
  writeManifest(rootDir, manifest);
  console.error("Manifest updated.");

  return { rawStructure, fromCache: false };
}
