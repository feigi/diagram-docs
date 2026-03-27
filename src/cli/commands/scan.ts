import { Command } from "commander";
import * as fs from "node:fs";
import { loadConfig } from "../../config/loader.js";
import { runScan, ScanError } from "../../core/scan.js";

// Re-export for backward compatibility with existing tests
export { matchCrossAppCoordinates } from "../../core/scan.js";

export const scanCommand = new Command("scan")
  .description("Scan source code and produce raw-structure.json")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("-o, --output <path>", "Output file path (default: stdout)")
  .option("--force", "Skip cache and re-scan everything")
  .action(async (options) => {
    const { config, configDir } = loadConfig(options.config);

    try {
      const { rawStructure, fromCache } = await runScan({
        rootDir: configDir,
        config,
        force: options.force,
      });

      if (fromCache) {
        console.error(
          "Source files unchanged since last scan. Use --force to re-scan.",
        );
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
