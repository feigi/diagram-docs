import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema, type Config } from "./schema.js";

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
    return {
      config: configSchema.parse({}),
      configDir: process.cwd(),
    };
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(raw) ?? {};
  migrateConfig(parsed);
  const config = configSchema.parse(parsed);

  return {
    config,
    configDir: path.dirname(path.resolve(resolvedPath)),
  };
}

/**
 * Migrate deprecated config fields to their current equivalents.
 * Mutates the raw parsed object before Zod validation.
 */
function migrateConfig(raw: Record<string, unknown>): void {
  const output = raw.output as Record<string, unknown> | undefined;
  if (output && "dir" in output && !("docsDir" in output)) {
    if (typeof output.dir !== "string") {
      console.error(
        `Warning: config field "output.dir" has unexpected type ${typeof output.dir}, ignoring.`,
      );
      return;
    }
    const dir = output.dir;
    // Old default was "docs/architecture"; new schema splits into
    // docsDir ("docs") + hard-coded "/architecture" suffix.
    const suffix = "/architecture";
    output.docsDir = dir.endsWith(suffix)
      ? dir.slice(0, -suffix.length) || "docs"
      : dir;
    delete output.dir;
    console.error(
      `Warning: config field "output.dir" is deprecated — migrated to "output.docsDir: ${output.docsDir}". Please update your config file.`,
    );
  }
}
