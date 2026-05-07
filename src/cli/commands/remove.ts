import { Command } from "commander";
import * as path from "node:path";
import { findConfigFile, loadConfig } from "../../config/loader.js";
import { runRemove } from "../../core/remove.js";

export const removeCommand = new Command("remove")
  .description("Remove all diagram-docs generated files")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option(
    "--all",
    "Also remove diagram output folders (docs/architecture and submodule architecture dirs)",
  )
  .option("--dry-run", "Print what would be removed without deleting anything")
  .action(async (options) => {
    // Locate config file without auto-creating one (unlike loadConfig).
    const resolvedConfigPath = options.config
      ? path.resolve(options.config)
      : findConfigFile(process.cwd());

    if (!resolvedConfigPath) {
      console.error("No diagram-docs.yaml found. Nothing to remove.");
      return;
    }

    // Parse config for output.dir and submodules settings.
    // loadConfig is safe here since we already confirmed the file exists.
    const { config, configDir } = loadConfig(resolvedConfigPath);

    const result = await runRemove(configDir, resolvedConfigPath, config, {
      all: options.all ?? false,
      dryRun: options.dryRun ?? false,
    });

    const total = result.removedTargets.length + result.prunedParents.length;
    if (total === 0) {
      console.error("Nothing to remove.");
      return;
    }

    const cwd = process.cwd();
    for (const p of [...result.removedTargets, ...result.prunedParents]) {
      const rel = path.relative(cwd, p);
      if (options.dryRun) {
        console.log(`[dry-run] ${rel}`);
      } else {
        console.error(`Removed: ${rel}`);
      }
    }

    if (!options.dryRun) {
      console.error(`\nRemoved ${total} item(s).`);
    }
  });
