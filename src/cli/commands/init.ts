import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { findConfigFile, writeDefaultConfig, updateConfigLLM } from "../../config/loader.js";
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

    const { configPath } = writeDefaultConfig(process.cwd());
    console.log(`Created ${path.relative(process.cwd(), configPath)}`);

    const setup = await promptLLMSetup();
    if (setup) {
      updateConfigLLM(configPath, setup.provider, setup.model);
    }
  });
