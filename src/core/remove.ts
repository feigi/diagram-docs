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
 * Default (all=false): tool traces only — config file, scan cache (root + all
 * submodule .diagram-docs dirs), root model.
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

  // 4. submodule .diagram-docs/ dirs (always removed — they are tool traces)
  const submoduleCacheDirs = await discoverSubmoduleCacheDirs(
    configDir,
    modelPath,
  );
  candidates.push(...submoduleCacheDirs);

  if (all) {
    // Discover submodule architecture dirs before the model is marked for deletion
    const submoduleDirs = await discoverSubmoduleDirs(
      configDir,
      modelPath,
      config,
    );

    // 5. {config.output.dir}/ — entire output folder
    candidates.push(path.resolve(configDir, config.output.dir));

    // 6. submodule {appPath}/{docsDir}/architecture/ dirs
    candidates.push(...submoduleDirs);
  }

  candidates.push(modelPath);

  return [...new Set(candidates)].filter((p) => fs.existsSync(p)).sort();
}

/**
 * Discover per-application .diagram-docs cache dirs.
 *
 * Strategy:
 * 1. Read architecture-model.yaml and derive {appPath}/.diagram-docs paths.
 * 2. Fallback: glob for all .diagram-docs directories in the project tree.
 */
async function discoverSubmoduleCacheDirs(
  configDir: string,
  modelPath: string,
): Promise<string[]> {
  if (fs.existsSync(modelPath)) {
    try {
      const raw = fs.readFileSync(modelPath, "utf-8");
      const model = architectureModelSchema.parse(parseYaml(raw));
      return model.containers.map((container) => {
        const appPath =
          container.path ?? container.applicationId.replace(/-/g, "/");
        return path.join(configDir, appPath, ".diagram-docs");
      });
    } catch {
      // Fall through to filesystem walk
    }
  }

  const ignoreOpts = {
    cwd: configDir,
    ignore: ["**/node_modules/**", "**/.git/**"],
    absolute: true,
    dot: true,
  };

  const matches = await glob("**/.diagram-docs", ignoreOpts);

  // Exclude the root .diagram-docs (already handled as a direct candidate)
  const rootCache = path.join(configDir, ".diagram-docs");
  return matches.filter((m) => m !== rootCache);
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

  // Filesystem walk fallback: find submodule architecture dirs by looking for
  // well-known diagram-docs markers. We search for both the generated component
  // diagram AND the model fragment since the latter is always written even when
  // component-level diagrams are disabled.
  const ignoreOpts = {
    cwd: configDir,
    ignore: ["**/node_modules/**", "**/.git/**"],
    absolute: true,
  };

  const [componentMatches, fragmentMatches] = await Promise.all([
    glob("**/architecture/_generated/c3-component.d2", ignoreOpts),
    glob("**/architecture/architecture-model.yaml", ignoreOpts),
  ]);

  const archDirs = new Set<string>();
  for (const m of componentMatches) {
    archDirs.add(path.dirname(path.dirname(m)));
  }
  for (const m of fragmentMatches) {
    archDirs.add(path.dirname(m));
  }

  return [...archDirs];
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
