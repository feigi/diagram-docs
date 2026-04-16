import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema, type Config } from "../config/schema.js";

const CONFIG_FILENAMES = ["diagram-docs.yaml", "diagram-docs.yml"];

/**
 * Resolve config for a directory by walking up the tree, merging
 * closest-parent-wins (like .eslintrc). Stops at `stopAt` (if given),
 * otherwise stops at a .git boundary or filesystem root.
 *
 * Pass `stopAt` (the root configDir) when scanning projects that may be
 * independent git repos (e.g. submodules) so the root diagram-docs.yaml
 * is still found and inherited.
 */
export function resolveConfig(dir: string, stopAt?: string): Config {
  const configs = collectConfigs(
    path.resolve(dir),
    stopAt ? path.resolve(stopAt) : undefined,
  );

  if (configs.length === 0) {
    return configSchema.parse({});
  }

  // configs is ordered closest-first. Merge from root down so local wins.
  configs.reverse();

  let merged: Record<string, unknown> = {};
  for (const raw of configs) {
    merged = deepMerge(merged, raw);
  }

  return configSchema.parse(merged);
}

/**
 * Find the root config path by walking up from a directory.
 * Returns null if no config found.
 */
export function findRootConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);

  // Walk up past the start dir to find a parent config
  dir = path.dirname(dir);

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) return candidate;
    }

    if (fs.existsSync(path.join(dir, ".git"))) return null;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Collect raw parsed YAML configs from dir upward.
 * Returns closest-first order.
 *
 * If `stopAt` is provided the walk stops after processing that directory
 * (inclusive). This lets callers cross .git boundaries, which is necessary
 * in monorepos where each sub-project is its own git repo (e.g. submodules)
 * but still needs to inherit the root diagram-docs.yaml.
 *
 * Without `stopAt` the walk stops at the first .git boundary or the
 * filesystem root — the original behaviour.
 */
function collectConfigs(
  startDir: string,
  stopAt?: string,
): Record<string, unknown>[] {
  const configs: Record<string, unknown>[] = [];
  let dir = startDir;

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf-8");
        const parsed = parseYaml(raw);
        if (parsed && typeof parsed === "object") {
          configs.push(parsed as Record<string, unknown>);
        }
        break;
      }
    }

    if (stopAt) {
      if (dir === stopAt) break;
    } else {
      if (fs.existsSync(path.join(dir, ".git"))) break;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return configs;
}

/**
 * Deep merge two config objects.
 * - Scalars: override wins
 * - Arrays: override replaces entirely
 * - Objects: recursive merge
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];

    if (Array.isArray(overVal)) {
      result[key] = overVal;
    } else if (
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      );
    } else {
      result[key] = overVal;
    }
  }

  return result;
}
