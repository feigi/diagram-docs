/**
 * Core logic for the `remove` command.
 * Collects and deletes all diagram-docs generated files in a project.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import { parse as parseYaml } from "yaml";
import type { Config } from "../config/schema.js";
import { architectureModelSchema } from "./model.js";

// ---------------------------------------------------------------------------
// Path collection
// ---------------------------------------------------------------------------

/**
 * Collect all paths that `remove` should delete.
 *
 * Default (all=false): tool traces only — config file, scan cache, root model.
 * With all=true: also diagram output dirs (main + submodule architecture folders).
 *
 * Submodule discovery reads architecture-model.yaml (if present) for exact
 * container paths, falling back to a filesystem walk.
 *
 * Returns a sorted, deduplicated list of existing absolute paths.
 */
export async function collectRemovePaths(
  configDir: string,
  configPath: string,
  config: Config,
  all: boolean,
): Promise<string[]> {
  const candidates: string[] = [];

  // 1. diagram-docs.yaml — the tool config file
  candidates.push(configPath);

  // 2. .diagram-docs/ — scan cache, manifest, LLM logs
  candidates.push(path.join(configDir, ".diagram-docs"));

  // 3. architecture-model.yaml — root model (read submodule paths from it first if --all)
  const modelPath = path.join(configDir, "architecture-model.yaml");

  if (all) {
    // Discover submodule architecture dirs before the model is marked for deletion
    const submoduleDirs = await discoverSubmoduleDirs(configDir, modelPath, config);

    // 4. {config.output.dir}/ — entire output folder
    candidates.push(path.resolve(configDir, config.output.dir));

    // 5. submodule {appPath}/{docsDir}/architecture/ dirs
    candidates.push(...submoduleDirs);
  }

  candidates.push(modelPath);

  return [...new Set(candidates)]
    .filter((p) => fs.existsSync(p))
    .sort();
}

/**
 * Discover per-application architecture dirs created by submodule generation.
 *
 * Strategy:
 * 1. Read architecture-model.yaml and use container paths directly.
 * 2. Fallback: glob for `** /architecture/_generated/c3-component.d2` files.
 */
async function discoverSubmoduleDirs(
  configDir: string,
  modelPath: string,
  config: Config,
): Promise<string[]> {
  if (fs.existsSync(modelPath)) {
    try {
      const raw = fs.readFileSync(modelPath, "utf-8");
      const model = architectureModelSchema.parse(parseYaml(raw));
      return model.containers.map((container) => {
        const override = config.submodules.overrides[container.applicationId];
        const appPath =
          container.path ?? container.applicationId.replace(/-/g, "/");
        const docsDir = override?.docsDir ?? config.submodules.docsDir;
        return path.join(configDir, appPath, docsDir, "architecture");
      });
    } catch {
      // Fall through to filesystem walk
    }
  }

  // Filesystem walk fallback: find any architecture/_generated/c3-component.d2
  const matches = await glob("**/architecture/_generated/c3-component.d2", {
    cwd: configDir,
    ignore: ["**/node_modules/**", "**/.git/**"],
    absolute: true,
  });

  // Return the parent architecture/ dirs (strip /_generated/c3-component.d2)
  return [...new Set(matches.map((m) => path.dirname(path.dirname(m))))];
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Remove a single path (file or directory).
 * Silently ignores ENOENT (already gone).
 */
export function removePath(target: string): void {
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
