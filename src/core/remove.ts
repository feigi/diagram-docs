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
    const submoduleEntries = await discoverSubmoduleDirs(
      configDir,
      modelPath,
      config,
    );

    // 6. {config.output.dir}/ — entire output folder
    candidates.push(path.resolve(configDir, config.output.dir));

    // 7. submodule {appPath}/{docsDir}/architecture/ dirs
    candidates.push(...submoduleEntries.map((e) => e.archDir));
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

// ---------------------------------------------------------------------------
// Architecture directories
// ---------------------------------------------------------------------------

/**
 * Architecture directory paired with the ancestor boundary that the
 * parent-prune walk must not cross.
 */
export interface ArchitectureDir {
  archDir: string;
  boundary: string;
}

/**
 * Collect all architecture output directories with their prune boundaries.
 *
 * Boundaries (the directory the prune walk must not cross or remove):
 * - Root output dir: configDir.
 * - Submodules from a parsed architecture-model.yaml: each container's
 *   resolved appPath.
 * - Submodules discovered via filesystem walk (model absent or unparseable):
 *   configDir, since the appPath is unknowable from disk alone. Pruning
 *   still halts naturally at the first non-empty parent.
 *
 * Must be called BEFORE any deletion happens — model parsing reads
 * architecture-model.yaml, which `collectRemovePaths` includes in its target
 * list and the CLI removes during the deletion phase.
 */
export async function collectArchitectureDirs(
  configDir: string,
  config: Config,
): Promise<ArchitectureDir[]> {
  const modelPath = path.join(configDir, "architecture-model.yaml");
  return [
    {
      archDir: path.resolve(configDir, config.output.dir),
      boundary: path.resolve(configDir),
    },
    ...(await discoverSubmoduleDirs(configDir, modelPath, config)),
  ];
}

/**
 * Discover per-application architecture dirs created by submodule generation,
 * each paired with the prune boundary that walks must stop at.
 *
 * Strategy:
 * 1. Read architecture-model.yaml and use container paths directly; boundary
 *    is the resolved appPath.
 * 2. Fallback: glob for diagram-docs markers under `** /architecture/`;
 *    boundary is configDir because appPath is unknown.
 */
async function discoverSubmoduleDirs(
  configDir: string,
  modelPath: string,
  config: Config,
): Promise<ArchitectureDir[]> {
  const configAbs = path.resolve(configDir);

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

  return [...archDirs].map((archDir) => ({ archDir, boundary: configAbs }));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RemovalResult {
  /** Targets that were (or would be, in dry-run) removed. */
  removedTargets: string[];
  /**
   * Targets that disappeared between collection and deletion (race). Always
   * empty in dry-run.
   */
  skippedTargets: string[];
  /** Empty parent dirs that were (or would be, in dry-run) pruned. */
  prunedParents: string[];
  /**
   * Parent dirs that the prune walk predicted as removable but `rmdirSync`
   * refused (ENOTEMPTY or ENOTDIR — concurrent writer). Always empty in
   * dry-run.
   */
  failedPrunes: string[];
}

export interface RunRemoveOptions {
  all: boolean;
  dryRun: boolean;
}

/**
 * Execute the `remove` workflow end-to-end.
 *
 * Architecture-dir discovery runs before deletion because
 * `collectArchitectureDirs` reads architecture-model.yaml — and that file
 * is among the targets `collectRemovePaths` returns.
 */
export async function runRemove(
  configDir: string,
  configPath: string,
  config: Config,
  opts: RunRemoveOptions,
): Promise<RemovalResult> {
  const targets = await collectRemovePaths(
    configDir,
    configPath,
    config,
    opts.all,
  );
  const archEntries = opts.all
    ? await collectArchitectureDirs(configDir, config)
    : [];

  const removedTargets: string[] = [];
  const skippedTargets: string[] = [];
  for (const t of targets) {
    if (opts.dryRun) {
      removedTargets.push(t);
    } else if (removePath(t)) {
      removedTargets.push(t);
    } else {
      skippedTargets.push(t);
    }
  }

  const prunedParents: string[] = [];
  const failedPrunes: string[] = [];
  const planned = new Set(targets);
  for (const { archDir, boundary } of archEntries) {
    const parents = pruneEmptyAncestors(archDir, boundary, planned);
    for (const p of parents) {
      if (opts.dryRun) {
        prunedParents.push(p);
        continue;
      }
      // Window between pruneEmptyAncestors' readdir and our rmdir is short,
      // but split-state matters: ENOENT here = benign (parent deleted by
      // another process or concurrent prune walk); ENOTEMPTY/ENOTDIR =
      // surprise we should surface.
      const existedBefore = fs.existsSync(p);
      if (removeEmptyDir(p)) {
        prunedParents.push(p);
      } else if (existedBefore) {
        failedPrunes.push(p);
      }
    }
  }

  return { removedTargets, skippedTargets, prunedParents, failedPrunes };
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Remove a single path (file or directory). Returns true if removal happened,
 * false if the path was already gone (ENOENT). Other errors propagate.
 */
export function removePath(target: string): boolean {
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Remove `target` if it is an empty directory. Returns true on removal,
 * false if `rmdirSync` rejects with ENOENT (already gone), ENOTEMPTY
 * (non-empty), or ENOTDIR (not a directory). Other errors propagate.
 *
 * Tolerating ENOTEMPTY/ENOTDIR keeps `pruneEmptyAncestors` advancing across
 * races where another process writes into a parent between readdir and
 * rmdir.
 */
export function removeEmptyDir(target: string): boolean {
  try {
    fs.rmdirSync(target);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTEMPTY" || code === "ENOTDIR") {
      return false;
    }
    throw err;
  }
}

/**
 * Walk up from `start`'s parent removing empty ancestor directories, bounded
 * by `boundary` (never removed, never crossed).
 *
 * `planned` is a mutable set of paths considered already-removed when
 * deciding emptiness. Callers seed it with the full deletion target list so
 * dry-run prediction matches actual post-deletion state, and pass the same
 * Set across multiple invocations so siblings sharing a boundary see each
 * other's pruned ancestors during the run.
 *
 * Returns the parents that were (or would be, in dry-run) removed, in
 * ascending (child-to-ancestor) order. Stops on the first non-empty parent,
 * on the boundary, or if `start` is not a descendant of `boundary`.
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") break;
      throw err;
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
