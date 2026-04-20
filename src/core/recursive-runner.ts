/**
 * Recursive descent orchestrator.
 *
 * `processFolder` is the main entry point — it classifies a folder,
 * generates the appropriate C4 diagrams, scaffolds user-facing D2 files,
 * and recurses into children.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import picomatch from "picomatch";

import type { Config, FolderRole } from "../config/schema.js";
import type { ScanConfig, ScannedApplication } from "../analyzers/types.js";
import { collectSignals, inferRole } from "./classifier.js";
import { agentClassify, loadAgentCache, saveAgentCache, type CacheEntry } from "./agent-assist.js";
import { humanizeName } from "./humanize.js";
import { buildModel } from "./model-builder.js";
import { generateContextDiagram } from "../generator/d2/context.js";
import { generateContainerDiagram } from "../generator/d2/container.js";
import { generateComponentDiagram } from "../generator/d2/component.js";
import { generateCodeDiagram } from "../generator/d2/code.js";
import { discoverApplications } from "./discovery.js";
import { getAnalyzer } from "../analyzers/registry.js";
import { scaffoldForRole } from "../generator/d2/scaffold.js";

/* ------------------------------------------------------------------ */
/*  Public result types                                                */
/* ------------------------------------------------------------------ */

export interface ProcessFailures {
  /** Agent classification fell back to heuristic due to an LLM error. */
  llm: number;
  /** An analyzer threw while scanning an application. */
  analyzer: number;
  /** Diagram generation threw for a folder's role. */
  generation: number;
  /** Scaffolding threw while writing user-facing D2 files. */
  scaffold: number;
}

export interface ProcessResult {
  d2Files: string[];
  failures: ProcessFailures;
}

function emptyFailures(): ProcessFailures {
  return { llm: 0, analyzer: 0, generation: 0, scaffold: 0 };
}

function mergeFailures(a: ProcessFailures, b: ProcessFailures): ProcessFailures {
  return {
    llm: a.llm + b.llm,
    analyzer: a.analyzer + b.analyzer,
    generation: a.generation + b.generation,
    scaffold: a.scaffold + b.scaffold,
  };
}

export function totalFailures(f: ProcessFailures): number {
  return f.llm + f.analyzer + f.generation + f.scaffold;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Always-excluded directories. Mixes VCS/runtime dirs (.git, __pycache__,
// venv) with this tool's own output dirs (_generated, architecture) — both
// are noise for traversal regardless of user config.
const ALWAYS_EXCLUDE_DIRS = new Set([
  ".git",
  ".diagram-docs",
  "__pycache__",
  ".venv",
  "venv",
  "_generated",
  "architecture",
]);

function buildExcludeMatcher(config: Config): (relPath: string) => boolean {
  const docsDir = config.output.docsDir;
  const docsDirFirstSegment = docsDir === "." ? null : (docsDir.split(/[\\/]/)[0] || null);

  const isMatch = picomatch(config.scan.exclude);

  return (childRelPath: string) => {
    const dirName = path.basename(childRelPath);
    if (ALWAYS_EXCLUDE_DIRS.has(dirName)) return true;
    if (docsDirFirstSegment && dirName === docsDirFirstSegment) return true;
    if (isMatch(childRelPath)) return true;
    return false;
  };
}

/**
 * Write a file only if its content has changed. By skipping writes for
 * unchanged content, the file's mtime is preserved for downstream
 * rendering caches (see `isUpToDate` in `render.ts`).
 */
function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return false;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

// Keep in sync with analyzers that implement `analyzeModule` (L4 code-level).
const EXT_TO_LANGUAGE: Record<string, string> = {
  ".java": "java",
  ".py": "python",
  ".c": "c",
  ".h": "c",
};

function detectLanguage(folderPath: string): string | null {
  const counts: Record<string, number> = {};
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE") throw err;
    console.error(
      `Warning: cannot read directory for language detection ${folderPath}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang) {
      counts[lang] = (counts[lang] ?? 0) + 1;
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  return best;
}

function toScanConfig(config: Config): ScanConfig {
  return {
    exclude: config.scan.exclude,
    abstraction: config.abstraction,
  };
}

/**
 * Analyze a set of discovered applications, counting per-app failures.
 * EMFILE/ENFILE/ENOMEM propagate so a saturated fd table doesn't silently
 * produce empty diagrams.
 */
async function analyzeApps(
  folderPath: string,
  apps: Awaited<ReturnType<typeof discoverApplications>>,
  scanConfig: ScanConfig,
): Promise<{ validApps: ScannedApplication[]; analyzerFailures: number }> {
  let analyzerFailures = 0;
  const scanned = await Promise.all(
    apps.map(async (app) => {
      const analyzer = getAnalyzer(app.analyzerId);
      if (!analyzer) {
        console.error(
          `Warning: no analyzer found for language "${app.analyzerId}" (application at ${app.path}). Skipping.`,
        );
        analyzerFailures++;
        return null;
      }
      const absAppPath = path.resolve(folderPath, app.path);
      try {
        return await analyzer.analyze(absAppPath, scanConfig);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EMFILE" || code === "ENFILE" || code === "ENOMEM") {
          throw err;
        }
        // Programming errors in an analyzer are bugs, not recoverable.
        if (
          err instanceof TypeError ||
          err instanceof ReferenceError ||
          err instanceof SyntaxError
        ) {
          throw err;
        }
        console.error(
          `Warning: analysis failed for application at ${app.path}: ${err instanceof Error ? err.message : err}`,
        );
        analyzerFailures++;
        return null;
      }
    }),
  );
  const validApps = scanned.filter((a): a is NonNullable<typeof a> => a !== null);

  if (apps.length > 0 && validApps.length === 0) {
    console.error(
      `Error: all ${apps.length} application(s) in ${folderPath} failed to analyze — no diagrams will be generated for this folder.`,
    );
  }

  return { validApps, analyzerFailures };
}

/* ------------------------------------------------------------------ */
/*  System role: generates context + container diagrams                */
/* ------------------------------------------------------------------ */

async function generateSystemDiagrams(
  folderPath: string,
  config: Config,
  folderName: string,
  folderDesc: string,
  docsDir: string,
): Promise<{ d2Files: string[]; analyzerFailures: number }> {
  const apps = await discoverApplications(folderPath, config);
  const scanConfig = toScanConfig(config);
  const { validApps, analyzerFailures } = await analyzeApps(folderPath, apps, scanConfig);
  const d2Files: string[] = [];

  const model = buildModel({
    config,
    rawStructure: {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum: "",
      applications: validApps,
    },
  });

  model.system.name = folderName;
  model.system.description = folderDesc;

  const outputDir = path.join(folderPath, docsDir, "architecture");
  const generatedDir = path.join(outputDir, "_generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const contextD2 = generateContextDiagram(model);
  writeIfChanged(path.join(generatedDir, "context.d2"), contextD2);
  d2Files.push(path.join(outputDir, "context.d2"));

  const containerD2 = generateContainerDiagram(model, {
    submoduleLinkResolver: (containerId) => {
      const container = model.containers.find((c) => c.id === containerId);
      if (!container?.path) return null;
      const childDocsDir = path.join(
        container.path,
        config.output.docsDir,
        "architecture",
      );
      // Relative to outputDir because the rendered SVG lives there.
      // Normalize to forward slashes for D2 link URLs.
      const relPath = path.relative(outputDir, path.join(folderPath, childDocsDir)).split(path.sep).join("/");
      return `${relPath}/component.${config.output.format}`;
    },
  });
  writeIfChanged(path.join(generatedDir, "container.d2"), containerD2);
  d2Files.push(path.join(outputDir, "container.d2"));

  return { d2Files, analyzerFailures };
}

/* ------------------------------------------------------------------ */
/*  Container role: generates component diagram                       */
/* ------------------------------------------------------------------ */

async function generateContainerDiagrams(
  folderPath: string,
  config: Config,
  folderName: string,
  folderDesc: string,
  docsDir: string,
): Promise<{ d2Files: string[]; analyzerFailures: number }> {
  const apps = await discoverApplications(folderPath, config);
  const scanConfig = toScanConfig(config);
  const { validApps, analyzerFailures } = await analyzeApps(folderPath, apps, scanConfig);
  const d2Files: string[] = [];

  if (validApps.length === 0) return { d2Files, analyzerFailures };

  const model = buildModel({
    config,
    rawStructure: {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum: "",
      applications: validApps,
    },
  });

  model.system.name = folderName;
  model.system.description = folderDesc;

  const outputDir = path.join(folderPath, docsDir, "architecture");
  const generatedDir = path.join(outputDir, "_generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const componentD2 = model.containers
    .map((container) => generateComponentDiagram(model, container.id))
    .join("\n\n");
  writeIfChanged(path.join(generatedDir, "component.d2"), componentD2);
  d2Files.push(path.join(outputDir, "component.d2"));

  return { d2Files, analyzerFailures };
}

/* ------------------------------------------------------------------ */
/*  Component / code-only role: generates code diagram                */
/* ------------------------------------------------------------------ */

async function generateCodeDiagrams(
  folderPath: string,
  config: Config,
  docsDir: string,
): Promise<string[]> {
  const d2Files: string[] = [];

  const language = detectLanguage(folderPath);
  if (!language) {
    console.error(
      `Warning: no supported language detected in ${path.basename(folderPath)}, skipping code diagram.`,
    );
    return d2Files;
  }

  const analyzer = getAnalyzer(language);
  if (!analyzer?.analyzeModule) {
    console.error(
      `Warning: analyzer "${language}" does not support code-level analysis, skipping code diagram for ${path.basename(folderPath)}.`,
    );
    return d2Files;
  }

  const scanConfig = toScanConfig(config);
  let symbols;
  try {
    symbols = await analyzer.analyzeModule(folderPath, scanConfig);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE") throw err;
    console.error(
      `Warning: code-level analysis failed for ${path.basename(folderPath)}: ${err instanceof Error ? err.message : err}`,
    );
    return d2Files;
  }

  if (symbols.symbols.length < config.abstraction.codeLevel.minSymbols) {
    return d2Files;
  }

  const moduleName = humanizeName(path.basename(folderPath));
  const codeD2 = generateCodeDiagram(symbols, moduleName);

  const outputDir = path.join(folderPath, docsDir, "architecture");
  const generatedDir = path.join(outputDir, "_generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  writeIfChanged(path.join(generatedDir, "code.d2"), codeD2);
  d2Files.push(path.join(outputDir, "code.d2"));

  return d2Files;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * A folder with a build file plus package structure (e.g. `src/main/java`
 * under a Maven/Gradle project) is sufficient evidence for "container"
 * even when direct source files are too deeply nested for the shallow
 * signal scan to count them. Refines `inferRole`'s default "skip".
 */
function refineHeuristicRole(
  role: FolderRole,
  signals: { buildFiles: string[]; hasPackageStructure: boolean },
): FolderRole {
  if (role === "skip" && signals.buildFiles.length > 0 && signals.hasPackageStructure) {
    return "container";
  }
  return role;
}

export async function processFolder(
  folderPath: string,
  rootPath: string,
  config: Config,
  parentContext?: string,
  parentFolderPath?: string,
  agentCache?: Map<string, CacheEntry>,
  depth = 0,
): Promise<ProcessResult> {
  const isRootCall = agentCache === undefined;
  const cache = agentCache ?? (config.agent.enabled ? loadAgentCache(rootPath) : undefined);
  // Save cache in finally so a mid-traversal crash (EMFILE deep in the tree,
  // OOM, etc.) still persists LLM classifications the user has paid for.
  try {
    return await processFolderInner(folderPath, rootPath, config, parentContext, parentFolderPath, cache, depth);
  } finally {
    if (isRootCall && cache) saveAgentCache(rootPath, cache);
  }
}

async function processFolderInner(
  folderPath: string,
  rootPath: string,
  config: Config,
  parentContext: string | undefined,
  parentFolderPath: string | undefined,
  cache: Map<string, CacheEntry> | undefined,
  depth: number,
): Promise<ProcessResult> {
  const d2Files: string[] = [];
  const failures = emptyFailures();

  if (depth > config.scan.maxDepth) {
    console.warn(
      `Warning: max recursion depth (${config.scan.maxDepth}) reached at ${path.relative(rootPath, folderPath) || "."}. Skipping subtree.`,
    );
    return { d2Files, failures };
  }

  const relPath = path.relative(rootPath, folderPath);
  const overrideKey = relPath === "" ? "." : relPath;
  const override = config.overrides[overrideKey];

  const signals = collectSignals(folderPath, rootPath);

  // Classification: override > LLM > heuristic. After this block role,
  // folderName, folderDesc reflect the effective classification.
  let role: FolderRole;
  let folderName: string;
  let folderDesc: string;

  if (override?.role) {
    role = override.role;
    folderName = override.name ?? humanizeName(path.basename(folderPath) || "Root");
    folderDesc = override.description ?? "";
  } else if (config.agent.enabled) {
    // Apply heuristic refinement before LLM so the prompt reflects the
    // corrected role.
    const heuristic = refineHeuristicRole(inferRole(signals), signals);
    const classification = await agentClassify(
      folderPath,
      signals,
      heuristic,
      config,
      rootPath,
      parentContext,
      cache,
    );
    role = classification.role;
    folderName = classification.name || humanizeName(path.basename(folderPath) || "Root");
    folderDesc = classification.description || "";
    if (classification.failed) failures.llm++;
    // Apply override name/description on top of LLM classification.
    if (override?.name) folderName = override.name;
    if (override?.description) folderDesc = override.description;
  } else {
    role = refineHeuristicRole(inferRole(signals), signals);
    folderName = override?.name ?? humanizeName(path.basename(folderPath) || "Root");
    folderDesc = override?.description ?? "";
  }

  if (role === "skip") {
    return recurseChildren(
      folderPath, rootPath, config, parentContext, cache, depth,
      d2Files, failures, relPath,
    );
  }

  const effectiveDocsDir = override?.docsDir ?? config.output.docsDir;

  let generationSucceeded = false;
  try {
    switch (role) {
      case "system": {
        const r = await generateSystemDiagrams(folderPath, config, folderName, folderDesc, effectiveDocsDir);
        d2Files.push(...r.d2Files);
        failures.analyzer += r.analyzerFailures;
        break;
      }
      case "container": {
        const r = await generateContainerDiagrams(folderPath, config, folderName, folderDesc, effectiveDocsDir);
        d2Files.push(...r.d2Files);
        failures.analyzer += r.analyzerFailures;
        break;
      }
      case "component":
      case "code-only": {
        const codeFiles = await generateCodeDiagrams(folderPath, config, effectiveDocsDir);
        d2Files.push(...codeFiles);
        break;
      }
      default: {
        const _exhaustive: never = role;
        throw new Error(`Unexpected role: ${_exhaustive}`);
      }
    }
    generationSucceeded = true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // Resource-exhaustion and filesystem-permission errors must not be
    // swallowed — they indicate environmental problems that will recur
    // across every sibling folder, and they mask data-loss scenarios.
    if (
      code === "ENOSPC" || code === "ENOMEM" ||
      code === "EMFILE" || code === "ENFILE" ||
      code === "EACCES" || code === "EPERM" || code === "EROFS" ||
      err instanceof RangeError
    ) {
      throw err;
    }
    // Programming errors are bugs, not recoverable failures.
    if (err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError) {
      throw err;
    }
    failures.generation++;
    console.error(
      `Warning: diagram generation failed for ${relPath || "."} (${role}): ${err instanceof Error ? err.message : err}`,
    );
  }

  if (generationSucceeded) {
    try {
      const outputDir = path.join(folderPath, effectiveDocsDir, "architecture");
      scaffoldForRole(
        outputDir,
        role,
        folderName,
        config,
        parentFolderPath
          ? {
              outputDir: path.join(
                parentFolderPath,
                config.overrides[path.relative(rootPath, parentFolderPath) || "."]?.docsDir ?? config.output.docsDir,
                "architecture",
              ),
            }
          : undefined,
      );
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (
        code === "ENOSPC" || code === "ENOMEM" ||
        code === "EMFILE" || code === "ENFILE" ||
        code === "EACCES" || code === "EPERM" || code === "EROFS"
      ) {
        throw err;
      }
      failures.scaffold++;
      console.error(
        `Warning: scaffolding failed for ${relPath || "."}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const childContext = `${folderName} (${role})`;
  return recurseChildren(
    folderPath, rootPath, config, childContext, cache, depth,
    d2Files, failures, relPath,
  );
}

async function recurseChildren(
  folderPath: string,
  rootPath: string,
  config: Config,
  childContext: string | undefined,
  cache: Map<string, CacheEntry> | undefined,
  depth: number,
  d2Files: string[],
  failures: ProcessFailures,
  relPath: string,
): Promise<ProcessResult> {
  const shouldExclude = buildExcludeMatcher(config);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE") throw err;
    console.error(
      `Warning: cannot read directory ${relPath || "."}: ${err instanceof Error ? err.message : err}. Skipping subtree.`,
    );
    return { d2Files, failures };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const childRelPath = path.join(relPath, entry.name);
    if (shouldExclude(childRelPath)) continue;

    const childResult = await processFolderInner(
      path.join(folderPath, entry.name),
      rootPath,
      config,
      childContext,
      folderPath,
      cache,
      depth + 1,
    );
    d2Files.push(...childResult.d2Files);
    Object.assign(failures, mergeFailures(failures, childResult.failures));
  }

  return { d2Files, failures };
}
