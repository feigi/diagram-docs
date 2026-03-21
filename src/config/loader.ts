import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema, type Config } from "./schema.js";
import { humanizeName } from "../core/humanize.js";

const CONFIG_FILENAMES = ["diagram-docs.yaml", "diagram-docs.yml"];

export function findConfigFile(startDir: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(startDir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function loadConfig(configPath?: string): {
  config: Config;
  configDir: string;
} {
  const resolvedPath = configPath ?? findConfigFile(process.cwd());

  if (!resolvedPath) {
    const dirName = path.basename(process.cwd());
    const config = configSchema.parse({
      system: { name: humanizeName(dirName) },
    });
    return {
      config,
      configDir: process.cwd(),
    };
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(raw);
  const config = configSchema.parse(parsed ?? {});

  return {
    config,
    configDir: path.dirname(path.resolve(resolvedPath)),
  };
}
