import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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

/**
 * Write a default diagram-docs.yaml to the given directory.
 * Returns the written config and file path.
 */
export function writeDefaultConfig(dir: string): { config: Config; configPath: string } {
  const dirName = path.basename(dir);
  const defaults = {
    system: {
      name: humanizeName(dirName),
      description: "",
    },
    scan: {
      include: ["**"],
      exclude: [
        "**/*test*/**",
        "**/*test*",
        "**/node_modules/**",
        "**/build/**",
        "**/dist/**",
        "**/target/**",
      ],
    },
    levels: {
      context: true,
      container: true,
      component: true,
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

  const configPath = path.join(dir, "diagram-docs.yaml");
  fs.writeFileSync(configPath, stringifyYaml(defaults, { lineWidth: 120 }), "utf-8");
  const config = configSchema.parse(defaults);
  return { config, configPath };
}

export function loadConfig(configPath?: string): {
  config: Config;
  configDir: string;
  /** True when diagram-docs.yaml was just created because none existed. */
  configCreated: boolean;
} {
  const resolvedPath = configPath ?? findConfigFile(process.cwd());

  if (!resolvedPath) {
    const cwd = process.cwd();
    const { config, configPath: writtenPath } = writeDefaultConfig(cwd);
    console.error(`Created ${path.relative(cwd, writtenPath)}`);
    return {
      config,
      configDir: cwd,
      configCreated: true,
    };
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(raw);
  const config = configSchema.parse(parsed ?? {});

  return {
    config,
    configDir: path.dirname(path.resolve(resolvedPath)),
    configCreated: false,
  };
}

/**
 * Patch the llm section of an existing diagram-docs.yaml on disk and return
 * the re-parsed config.  Preserves all other YAML content and comments.
 */
export function updateConfigLLM(
  configPath: string,
  provider: string,
  model: string,
): Config {
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw) ?? {};
  parsed.llm = { ...parsed.llm, provider, model };
  fs.writeFileSync(configPath, stringifyYaml(parsed, { lineWidth: 120 }), "utf-8");
  return configSchema.parse(parsed);
}
