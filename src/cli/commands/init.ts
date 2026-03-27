import { Command } from "commander";
import * as path from "node:path";
import {
  findConfigFile,
  writeDefaultConfig,
  updateConfigLLM,
} from "../../config/loader.js";
import { promptLLMSetup } from "../interactive-setup.js";

export const initCommand = new Command("init")
  .description("Scaffold a diagram-docs.yaml config file")
  .option("-f, --force", "Overwrite existing config file")
  .action(async (options) => {
    const existing = findConfigFile(process.cwd());

    if (existing && !options.force) {
      console.error(
        "diagram-docs.yaml already exists. Use --force to overwrite.",
      );
      process.exit(1);
    }

    // Prompt for LLM setup BEFORE writing anything to disk
    const setup = await promptLLMSetup();

    const { configPath } = writeDefaultConfig(process.cwd());

    if (setup) {
      updateConfigLLM(configPath, setup.provider, setup.model);
    }

    console.log(`Created ${path.relative(process.cwd(), configPath)}`);
  });
