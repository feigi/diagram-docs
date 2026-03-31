import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, computeEffectiveExcludes } from "../../config/loader.js";
import {
  runScan,
  ScanError,
  runProjectScan,
  runScanAll,
} from "../../core/scan.js";
import { discoverApplications } from "../../core/discovery.js";
import { getRegistry } from "../../analyzers/registry.js";

// Re-export for backward compatibility with existing tests
export { matchCrossAppCoordinates } from "../../core/scan.js";

/**
 * Detect if the given directory is a project directory (has a build file).
 * Returns the matching DiscoveredProject-like info, or null if not a project dir.
 */
function detectBuildFile(
  dir: string,
): { buildFile: string; language: string; analyzerId: string } | null {
  for (const analyzer of getRegistry()) {
    for (const pattern of analyzer.buildFilePatterns) {
      if (fs.existsSync(path.join(dir, pattern))) {
        return {
          buildFile: pattern,
          language: analyzer.id,
          analyzerId: analyzer.id,
        };
      }
    }
  }
  return null;
}

export const scanCommand = new Command("scan")
  .description("Scan source code and produce raw-structure.json")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("-o, --output <path>", "Output file path (default: stdout)")
  .option("--force", "Skip cache and re-scan everything")
  .option("-v, --verbose", "Show detailed filtering decisions")
  .action(async (options) => {
    const { config, configDir } = loadConfig(options.config);
    const cwd = process.cwd();

    try {
      // Check if we're in a project subdirectory (has a build file)
      const buildInfo = detectBuildFile(cwd);
      const isProjectDir =
        buildInfo !== null && path.resolve(cwd) !== path.resolve(configDir);

      let rawStructure;

      if (isProjectDir) {
        // Single-project scan from a container/library directory
        const relPath = path.relative(configDir, cwd);
        console.error(`Scanning project: ${relPath}`);

        const result = await runProjectScan({
          rootDir: configDir,
          project: {
            path: relPath,
            buildFile: buildInfo.buildFile,
            language: buildInfo.language,
            analyzerId: buildInfo.analyzerId,
            type: "container", // Default; classification happens at discovery
          },
          config,
          force: options.force,
          verbose: options.verbose,
        });

        if (result.fromCache) {
          console.error(
            "Source files unchanged since last scan. Use --force to re-scan.",
          );
        }

        rawStructure = result.scan;
      } else {
        // Root-level scan: discover all projects and scan them
        const effectiveExcludes = computeEffectiveExcludes(
          config,
          getRegistry(),
        );
        const effectiveConfig = {
          ...config,
          scan: { ...config.scan, exclude: effectiveExcludes },
        };
        const discovered = await discoverApplications(
          configDir,
          effectiveConfig,
          {
            onSearching: (language, pattern) => {
              console.error(`  Searching: ${language} (${pattern})`);
            },
            onFound: (app) => {
              console.error(
                `  Found: ${app.path} (${app.type}: ${app.buildFile})`,
              );
            },
          },
        );

        if (discovered.length === 0) {
          // Fall back to legacy single-scan for non-monorepo projects
          const { rawStructure: legacyResult, fromCache } = await runScan({
            rootDir: configDir,
            config,
            force: options.force,
            verbose: options.verbose,
          });

          if (fromCache) {
            console.error(
              "Source files unchanged since last scan. Use --force to re-scan.",
            );
          }

          rawStructure = legacyResult;
        } else {
          const { rawStructure: combined } = await runScanAll({
            rootDir: configDir,
            config,
            projects: discovered,
            force: options.force,
            verbose: options.verbose,
          });

          rawStructure = combined;
        }
      }

      const json = JSON.stringify(rawStructure, null, 2);
      if (options.output) {
        fs.writeFileSync(options.output, json, "utf-8");
        console.error(`Written to ${options.output}`);
      } else {
        process.stdout.write(json);
      }
    } catch (err) {
      if (err instanceof ScanError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
  });
