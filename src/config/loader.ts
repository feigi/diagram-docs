import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { configSchema, type Config } from "./schema.js";
import { humanizeName } from "../core/humanize.js";
import { getRegistry } from "../analyzers/registry.js";
import type { LanguageAnalyzer } from "../analyzers/types.js";

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
 * Build default config values in memory without writing to disk.
 */
export function buildDefaultConfig(dir: string): {
  config: Config;
  configPath: string;
  defaults: Record<string, unknown>;
} {
  const dirName = path.basename(dir);
  const defaults: Record<string, unknown> = {
    system: {
      name: humanizeName(dirName),
      description: "",
    },
    scan: {
      include: ["**"],
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
    llm: {
      concurrency: 10,
    },
  };

  const configPath = path.join(dir, "diagram-docs.yaml");
  const config = configSchema.parse(defaults);
  return { config, configPath, defaults };
}

/**
 * Write a default diagram-docs.yaml to the given directory.
 * Returns the written config and file path.
 */
export function writeDefaultConfig(dir: string): {
  config: Config;
  configPath: string;
} {
  const { config, configPath, defaults } = buildDefaultConfig(dir);
  fs.writeFileSync(
    configPath,
    stringifyYaml(defaults, { lineWidth: 120 }),
    "utf-8",
  );
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
    const { config } = buildDefaultConfig(cwd);
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
  fs.writeFileSync(
    configPath,
    stringifyYaml(parsed, { lineWidth: 120 }),
    "utf-8",
  );
  return configSchema.parse(parsed);
}

/**
 * Compute effective exclude patterns by merging:
 *   1. User config `scan.exclude` (includes Zod defaults if unset)
 *   2. `defaultExcludes` from all registered analyzers
 * Then subtract any patterns listed in `scan.forceInclude`.
 */
export function computeEffectiveExcludes(
  config: Config,
  analyzers: LanguageAnalyzer[],
): string[] {
  const combined = new Set(config.scan.exclude);

  for (const analyzer of analyzers) {
    for (const pattern of analyzer.defaultExcludes ?? []) {
      combined.add(pattern);
    }
  }

  const forceInclude = new Set(config.scan.forceInclude);
  return [...combined].filter((p) => !forceInclude.has(p));
}

/**
 * Build a Config with `scan.exclude` replaced by the fully-resolved effective
 * excludes (user patterns + analyzer defaults − forceInclude). Use this at the
 * boundary between CLI/orchestration code and any consumer that reads
 * `config.scan.exclude` — so the effective set is computed exactly once per
 * command invocation and flows through the rest of the pipeline explicitly.
 */
export function buildEffectiveConfig(config: Config): Config {
  return {
    ...config,
    scan: {
      ...config.scan,
      exclude: computeEffectiveExcludes(config, getRegistry()),
    },
  };
}
