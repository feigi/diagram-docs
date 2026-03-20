import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../../config/loader.js";
import { discoverApplications } from "../../core/discovery.js";
import { computeChecksum } from "../../core/checksum.js";
import {
  readManifest,
  writeManifest,
  createDefaultManifest,
} from "../../core/manifest.js";
import { getAnalyzer } from "../../analyzers/registry.js";
import { slugify } from "../../core/slugify.js";
import type { RawStructure, ScannedApplication } from "../../analyzers/types.js";

export const scanCommand = new Command("scan")
  .description("Scan source code and produce raw-structure.json")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("-o, --output <path>", "Output file path (default: stdout)")
  .option("--force", "Skip cache and re-scan everything")
  .action(async (options) => {
    const { config, configDir } = loadConfig(options.config);
    const rootDir = configDir;

    // Discover applications
    const discovered = await discoverApplications(rootDir, config);

    if (discovered.length === 0) {
      console.error("No applications discovered. Check your scan.include patterns.");
      process.exit(1);
    }

    console.error(`Discovered ${discovered.length} application(s):`);
    for (const app of discovered) {
      console.error(`  ${app.language}: ${app.path} (${app.buildFile})`);
    }

    // Check cache
    const manifest = readManifest(rootDir) ?? createDefaultManifest();
    const checksum = await computeChecksum(
      rootDir,
      discovered.map((d) => d.path),
      config.scan.exclude,
    );

    if (
      !options.force &&
      manifest.lastScan?.checksum === checksum
    ) {
      console.error("Source files unchanged since last scan. Use --force to re-scan.");
      const cachedPath = path.resolve(
        rootDir,
        ".diagram-docs",
        manifest.rawStructure,
      );
      if (fs.existsSync(cachedPath)) {
        const cached = fs.readFileSync(cachedPath, "utf-8");
        if (options.output) {
          fs.writeFileSync(options.output, cached, "utf-8");
        } else {
          process.stdout.write(cached);
        }
        return;
      }
    }

    // Run analyzers
    const scanConfig = {
      exclude: config.scan.exclude,
      abstraction: config.abstraction,
    };

    const applications: ScannedApplication[] = [];
    for (const app of discovered) {
      const analyzer = getAnalyzer(app.analyzerId);
      if (!analyzer) {
        console.error(`No analyzer found for ${app.analyzerId}`);
        continue;
      }
      console.error(`Analyzing ${app.path}...`);
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

      applications.push(result);
    }

    const rawStructure: RawStructure = {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum,
      applications,
    };

    const json = JSON.stringify(rawStructure, null, 2);

    // Write output
    if (options.output) {
      fs.writeFileSync(options.output, json, "utf-8");
      console.error(`Written to ${options.output}`);
    } else {
      process.stdout.write(json);
    }

    // Update manifest
    const manifestDir = path.join(rootDir, ".diagram-docs");
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(manifestDir, "raw-structure.json"),
      json,
      "utf-8",
    );

    manifest.lastScan = {
      timestamp: new Date().toISOString(),
      checksum,
    };
    writeManifest(rootDir, manifest);
    console.error("Manifest updated.");
  });
