import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as stringifyYaml } from "yaml";

const DEFAULT_CONFIG = {
  system: {
    name: "My System",
    description: "Description for context diagram",
  },
  scan: {
    include: ["services/**", "libs/**"],
    exclude: [
      "**/test/**",
      "**/tests/**",
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "**/target/**",
    ],
  },
  levels: {
    context: true,
    container: true,
    component: false,
  },
  abstraction: {
    granularity: "balanced",
    excludePatterns: ["logging", "metrics", "middleware", "config", "utils"],
  },
  output: {
    dir: "docs/architecture",
    theme: 0,
    layout: "elk",
  },
};

export const initCommand = new Command("init")
  .description("Scaffold a diagram-docs.yaml config file")
  .option("-f, --force", "Overwrite existing config file")
  .action((options) => {
    const configPath = path.join(process.cwd(), "diagram-docs.yaml");

    if (fs.existsSync(configPath) && !options.force) {
      console.error(
        "diagram-docs.yaml already exists. Use --force to overwrite.",
      );
      process.exit(1);
    }

    const yaml = stringifyYaml(DEFAULT_CONFIG, { lineWidth: 120 });
    fs.writeFileSync(configPath, yaml, "utf-8");
    console.log("Created diagram-docs.yaml");
  });
