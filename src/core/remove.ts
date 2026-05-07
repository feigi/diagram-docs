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

  // 5. submodule diagram-docs.yaml stubs (always removed — scaffolded by `generate`)
  const submoduleConfigStubs = await discoverSubmoduleConfigStubs(
    configDir,
    modelPath,
  );
  candidates.push(...submoduleConfigStubs);

  if (all) {
    // Discover submodule architecture dirs before the model is marked for deletion
    const submoduleDirs = await discoverSubmoduleDirs(
      configDir,
      modelPath,
      config,
    );

    // 6. {config.output.dir}/ — entire output folder
    candidates.push(path.resolve(configDir, config.output.dir));

    // 7. submodule {appPath}/{docsDir}/architecture/ dirs
    candidates.push(...submoduleDirs);
  }

  candidates.push(modelPath);

  return [...new Set(candidates)].filter((p) => fs.existsSync(p)).sort();
}

/**
 * Log a warning when architecture-model.yaml exists but cannot be parsed.
 * Discovery falls back to a filesystem glob, but the user should know the
 * model is unreadable — otherwise corruption is masked until next `generate`.
 */
function warnModelParseFailure(
  configDir: string,
  modelPath: string,
  err: unknown,
): void {
  const reason = err instanceof Error ? err.message : String(err);
  const rel = path.relative(configDir, modelPath);
  console.error(
    `Warning: could not parse ${rel} (${reason}); falling back to filesystem walk.`,
  );
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
    } catch (err) {
      warnModelParseFailure(configDir, modelPath, err);
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
 * Discover per-application diagram-docs.yaml stubs scaffolded by `generate`.
 *
 * Strategy:
 * 1. Read architecture-model.yaml and derive {appPath}/diagram-docs.yaml paths.
 * 2. Fallback: glob for all diagram-docs.yaml files, excluding the root config.
 */
async function discoverSubmoduleConfigStubs(
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
        return path.join(configDir, appPath, "diagram-docs.yaml");
      });
    } catch (err) {
      warnModelParseFailure(configDir, modelPath, err);
    }
  }

  const ignoreOpts = {
    cwd: configDir,
    ignore: ["**/node_modules/**", "**/.git/**"],
    absolute: true,
  };

  const matches = await glob("**/diagram-docs.yaml", ignoreOpts);

  // Exclude the root diagram-docs.yaml (already handled as a direct candidate)
  const rootConfig = path.join(configDir, "diagram-docs.yaml");
  return matches.filter((m) => m !== rootConfig);
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
    } catch (err) {
      warnModelParseFailure(configDir, modelPath, err);
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
// Architecture directories (for parent-dir pruning under `--all`)
// ---------------------------------------------------------------------------

/**
 * An architecture directory and the ancestor boundary the parent-prune walk
 * must not cross. The boundary is the project root for the main output dir,
 * and the submodule app dir for each submodule architecture dir.
 */
export interface ArchitectureDir {
  archDir: string;
  boundary: string;
}

/**
 * Collect all architecture output directories together with the boundary
 * directory the parent-prune walk must stop at.
 *
 * - Root: {config.output.dir} bounded by configDir.
 * - Submodules: {appPath}/{docsDir}/architecture bounded by {appPath}.
 *
 * Returns absolute paths whether or not they currently exist on disk;
 * callers filter to existing entries as needed.
 */
export async function collectArchitectureDirs(
  configDir: string,
  config: Config,
): Promise<ArchitectureDir[]> {
  const result: ArchitectureDir[] = [];

  result.push({
    archDir: path.resolve(configDir, config.output.dir),
    boundary: path.resolve(configDir),
  });

  const modelPath = path.join(configDir, "architecture-model.yaml");
  result.push(
    ...(await discoverSubmoduleArchEntries(configDir, modelPath, config)),
  );

  return result;
}

/**
 * Submodule arch entries (archDir + appPath boundary).
 * Mirrors `discoverSubmoduleDirs` but pairs each dir with its boundary.
 */
async function discoverSubmoduleArchEntries(
  configDir: string,
  modelPath: string,
  config: Config,
): Promise<ArchitectureDir[]> {
  if (fs.existsSync(modelPath)) {
    try {
      const raw = fs.readFileSync(modelPath, "utf-8");
      const model = architectureModelSchema.parse(parseYaml(raw));
      return model.containers.map((container) => {
        const override = config.submodules.overrides[container.applicationId];
        const appPath =
          container.path ?? container.applicationId.replace(/-/g, "/");
        const docsDir = override?.docsDir ?? config.submodules.docsDir;
        const appAbs = path.resolve(configDir, appPath);
        return {
          archDir: path.join(appAbs, docsDir, "architecture"),
          boundary: appAbs,
        };
      });
    } catch (err) {
      warnModelParseFailure(configDir, modelPath, err);
    }
  }

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

  // In fallback mode the submodule's appPath is unknown — use the parent of
  // the architecture dir as a conservative boundary so the prune never
  // crosses out of the submodule's docs dir.
  return [...archDirs].map((archDir) => ({
    archDir,
    boundary: path.dirname(archDir),
  }));
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

/**
 * Walk up from `start`'s parent removing empty ancestor directories, bounded
 * by `boundary` (never removed, never crossed).
 *
 * `planned` is a mutable set of paths considered already-removed when
 * deciding emptiness. Callers seed it with the full deletion target list so
 * dry-run prediction matches actual post-deletion state, and pass the same
 * Set across multiple invocations so sibling architecture dirs converging on
 * a shared parent see each other's pruned ancestors.
 *
 * Returns the parents that were (or would be, in dry-run) removed, in
 * ascend order. Stops on the first non-empty parent or on the boundary.
 */
export function pruneEmptyAncestors(
  start: string,
  boundary: string,
  planned: Set<string>,
): string[] {
  const resolvedBoundary = path.resolve(boundary);
  const removed: string[] = [];
  let parent = path.dirname(path.resolve(start));

  while (
    parent !== resolvedBoundary &&
    parent.startsWith(resolvedBoundary + path.sep)
  ) {
    let entries: string[];
    try {
      entries = fs.readdirSync(parent);
    } catch {
      break;
    }
    const remaining = entries
      .map((e) => path.join(parent, e))
      .filter((p) => !planned.has(p));
    if (remaining.length > 0) break;

    removed.push(parent);
    planned.add(parent);
    parent = path.dirname(parent);
  }

  return removed;
}
