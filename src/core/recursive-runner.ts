/**
 * Recursive descent orchestrator.
 *
 * `processFolder` is the main entry point — it classifies a folder,
 * generates the appropriate C4 diagrams, scaffolds user-facing D2 files,
 * and recurses into children.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { Config, FolderRole } from "../config/schema.js";
import type { ScanConfig } from "../analyzers/types.js";
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
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getExcludeDirs(config: Config): Set<string> {
  // Use the first path segment of docsDir to avoid recursing into the docs
  // output tree.  Note: for multi-segment paths like "internal/docs", this
  // excludes the entire "internal/" directory, which may be overly broad.
  const docsDirFirstSegment = config.output.docsDir.split(/[\\/]/)[0] || config.output.docsDir;
  return new Set([
    "node_modules",
    ".git",
    "build",
    "dist",
    "target",
    ".diagram-docs",
    "__pycache__",
    ".venv",
    "venv",
    "test",
    "tests",
    "__tests__",
    docsDirFirstSegment,
  ]);
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

/**
 * Map of file extensions to analyzer language IDs.
 * Only includes languages with `analyzeModule` support (used for L4 code diagrams).
 * Keep in sync with analyzers that implement `analyzeModule`.
 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ".java": "java",
  ".py": "python",
  ".c": "c",
  ".h": "c",
};

/**
 * Detect the dominant language in a folder by scanning file extensions.
 */
function detectLanguage(folderPath: string): string | null {
  const counts: Record<string, number> = {};
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err: unknown) {
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

/**
 * Build a ScanConfig from the top-level Config for passing to analyzers.
 */
function toScanConfig(config: Config): ScanConfig {
  return {
    exclude: config.scan.exclude,
    abstraction: config.abstraction,
  };
}

/* ------------------------------------------------------------------ */
/*  System role: generates context + container diagrams                */
/* ------------------------------------------------------------------ */

async function generateSystemDiagrams(
  folderPath: string,
  rootPath: string,
  config: Config,
  folderName: string,
  folderDesc: string,
): Promise<string[]> {
  const apps = await discoverApplications(folderPath, config);
  const scanConfig = toScanConfig(config);
  const d2Files: string[] = [];

  // Analyze each discovered application
  const scannedApps = await Promise.all(
    apps.map(async (app) => {
      const analyzer = getAnalyzer(app.analyzerId);
      if (!analyzer) {
        console.error(
          `Warning: no analyzer found for language "${app.analyzerId}" (application at ${app.path}). Skipping.`,
        );
        return null;
      }
      const absAppPath = path.resolve(folderPath, app.path);
      return analyzer.analyze(absAppPath, scanConfig);
    }),
  );

  const validApps = scannedApps.filter(
    (a): a is NonNullable<typeof a> => a !== null,
  );

  // Build the model
  const model = buildModel({
    config,
    rawStructure: {
      version: 1,
      scannedAt: new Date().toISOString(),
      checksum: "",
      applications: validApps,
    },
  });

  // Override system name/description from classification
  model.system.name = folderName;
  model.system.description = folderDesc;

  // Write diagrams
  const outputDir = path.join(
    folderPath,
    config.output.docsDir,
    "architecture",
  );
  const generatedDir = path.join(outputDir, "_generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  // Context diagram
  const contextD2 = generateContextDiagram(model);
  const contextPath = path.join(generatedDir, "context.d2");
  writeIfChanged(contextPath, contextD2);
  d2Files.push(contextPath);

  // Container diagram — with submodule link resolver for drill-down
  const containerD2 = generateContainerDiagram(model, {
    submoduleLinkResolver: (containerId) => {
      const container = model.containers.find((c) => c.id === containerId);
      if (!container?.path) return null;
      const childDocsDir = path.join(
        container.path,
        config.output.docsDir,
        "architecture",
      );
      const relPath = path.relative(generatedDir, path.join(folderPath, childDocsDir));
      return `${relPath}/component.${config.output.format}`;
    },
  });
  const containerPath = path.join(generatedDir, "container.d2");
  writeIfChanged(containerPath, containerD2);
  d2Files.push(containerPath);

  return d2Files;
}

/* ------------------------------------------------------------------ */
/*  Container role: generates component diagram                       */
/* ------------------------------------------------------------------ */

async function generateContainerDiagrams(
  folderPath: string,
  config: Config,
  folderName: string,
  folderDesc: string,
): Promise<string[]> {
  const apps = await discoverApplications(folderPath, config);
  const scanConfig = toScanConfig(config);
  const d2Files: string[] = [];

  // Analyze the application(s) at this folder
  const scannedApps = await Promise.all(
    apps.map(async (app) => {
      const analyzer = getAnalyzer(app.analyzerId);
      if (!analyzer) {
        console.error(
          `Warning: no analyzer found for language "${app.analyzerId}" (application at ${app.path}). Skipping.`,
        );
        return null;
      }
      const absAppPath = path.resolve(folderPath, app.path);
      return analyzer.analyze(absAppPath, scanConfig);
    }),
  );

  const validApps = scannedApps.filter(
    (a): a is NonNullable<typeof a> => a !== null,
  );

  if (validApps.length === 0) return d2Files;

  // Build the model
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

  // Write component diagram for each container
  const outputDir = path.join(
    folderPath,
    config.output.docsDir,
    "architecture",
  );
  const generatedDir = path.join(outputDir, "_generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const componentParts = model.containers.map((container) =>
    generateComponentDiagram(model, container.id),
  );
  const componentD2 = componentParts.join("\n\n");
  const componentPath = path.join(generatedDir, "component.d2");
  writeIfChanged(componentPath, componentD2);
  d2Files.push(componentPath);

  return d2Files;
}

/* ------------------------------------------------------------------ */
/*  Component / code-only role: generates code diagram                */
/* ------------------------------------------------------------------ */

async function generateCodeDiagrams(
  folderPath: string,
  config: Config,
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
  const symbols = await analyzer.analyzeModule(folderPath, scanConfig);

  if (symbols.symbols.length < config.abstraction.codeLevel.minSymbols) {
    return d2Files;
  }

  const moduleName = humanizeName(path.basename(folderPath));
  const codeD2 = generateCodeDiagram(symbols, moduleName);

  const outputDir = path.join(
    folderPath,
    config.output.docsDir,
    "architecture",
  );
  const generatedDir = path.join(outputDir, "_generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  const codePath = path.join(generatedDir, "code.d2");
  writeIfChanged(codePath, codeD2);
  d2Files.push(codePath);

  return d2Files;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Recursively process a folder: classify, generate diagrams, scaffold, recurse.
 *
 * @param folderPath - Absolute path to the folder to process
 * @param rootPath   - Absolute path to the project root
 * @param config     - Resolved configuration
 * @param parentContext - Human-readable context string from the parent folder,
 *   formatted as "Name (role)". Passed to the LLM agent for classification context.
 * @param parentFolderPath - Absolute path to the parent folder (for scaffold breadcrumbs)
 * @param agentCache - Shared agent cache map, loaded once at the root call
 * @returns List of generated D2 file paths
 */
export async function processFolder(
  folderPath: string,
  rootPath: string,
  config: Config,
  parentContext?: string,
  parentFolderPath?: string,
  agentCache?: Map<string, CacheEntry>,
): Promise<string[]> {
  // Load agent cache once at the root call, reuse for all recursive calls
  const cache = agentCache ?? (config.agent.enabled ? loadAgentCache(rootPath) : undefined);
  const isRootCall = agentCache === undefined;
  const d2Files: string[] = [];

  // 1. Compute relative path for override lookup
  const relPath = path.relative(rootPath, folderPath);
  const overrideKey = relPath === "" ? "." : relPath;
  const override = config.overrides[overrideKey];

  // 2. Collect signals
  const signals = collectSignals(folderPath, rootPath);

  // 3. Classify
  let role: FolderRole;
  let folderName: string;
  let folderDesc: string;

  if (override?.role) {
    // Config override takes priority
    role = override.role;
    folderName =
      override.name ?? humanizeName(path.basename(folderPath) || "Root");
    folderDesc = override.description ?? "";
  } else if (config.agent.enabled) {
    // Agent classification — apply heuristic refinement before sending to LLM
    // so the prompt reflects the corrected role (e.g. skip → container for
    // folders with build files + package structure like src/main/java).
    let heuristic = inferRole(signals);
    if (heuristic === "skip" && signals.buildFiles.length > 0 && signals.hasPackageStructure) {
      heuristic = "container";
    }
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
  } else {
    // Heuristic classification
    role = inferRole(signals);

    // Refine: a build file + package structure (e.g. src/main/java) is
    // sufficient evidence for "container" even when source files are too
    // deeply nested for the shallow signal scan to count them.
    if (role === "skip" && signals.buildFiles.length > 0 && signals.hasPackageStructure) {
      role = "container";
    }

    folderName = humanizeName(path.basename(folderPath) || "Root");
    folderDesc = "";
  }

  // 4. Skip diagram generation but still recurse into children
  if (role === "skip") {
    const excludeDirs = getExcludeDirs(config);
    let skipEntries: fs.Dirent[];
    try {
      skipEntries = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EMFILE" || code === "ENFILE") {
        throw err;
      }
      console.error(
        `Warning: cannot read directory ${relPath || "."}: ${err instanceof Error ? err.message : err}. Skipping subtree.`,
      );
      return d2Files;
    }
    for (const entry of skipEntries) {
      if (!entry.isDirectory() || excludeDirs.has(entry.name) || entry.name.startsWith(".")) continue;
      const childFiles = await processFolder(
        path.join(folderPath, entry.name),
        rootPath,
        config,
        parentContext,
        folderPath,
        cache,
      );
      d2Files.push(...childFiles);
    }
    if (isRootCall && cache) saveAgentCache(rootPath, cache);
    return d2Files;
  }

  // 5. Generate diagrams based on role
  let generationSucceeded = false;
  try {
    switch (role) {
      case "system": {
        const systemFiles = await generateSystemDiagrams(
          folderPath,
          rootPath,
          config,
          folderName,
          folderDesc,
        );
        d2Files.push(...systemFiles);
        break;
      }
      case "container": {
        const containerFiles = await generateContainerDiagrams(
          folderPath,
          config,
          folderName,
          folderDesc,
        );
        d2Files.push(...containerFiles);
        break;
      }
      case "component":
      case "code-only": {
        const codeFiles = await generateCodeDiagrams(folderPath, config);
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
    if (code === "ENOSPC" || code === "ENOMEM" || err instanceof RangeError) {
      throw err;
    }
    console.error(
      `Warning: diagram generation failed for ${relPath || "."} (${role}): ${err instanceof Error ? err.message : err}`,
    );
  }

  // 6. Scaffold user-facing D2 files only if generation succeeded
  if (generationSucceeded) {
    const outputDir = path.join(folderPath, config.output.docsDir, "architecture");
    scaffoldForRole(
      outputDir,
      role,
      folderName,
      config,
      parentFolderPath
        ? { outputDir: path.join(parentFolderPath, config.output.docsDir, "architecture") }
        : undefined,
    );
  }

  // 7. Recurse into child directories
  const excludeDirs = getExcludeDirs(config);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE") {
      throw err;
    }
    console.error(
      `Warning: cannot read directory ${relPath || "."}: ${err instanceof Error ? err.message : err}. Skipping subtree.`,
    );
    return d2Files;
  }

  const childContext = `${folderName} (${role})`;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (excludeDirs.has(entry.name)) continue;
    // Skip hidden directories
    if (entry.name.startsWith(".")) continue;

    const childPath = path.join(folderPath, entry.name);
    const childFiles = await processFolder(
      childPath,
      rootPath,
      config,
      childContext,
      folderPath,
      cache,
    );
    d2Files.push(...childFiles);
  }

  // Save agent cache once at the root call after full traversal
  if (isRootCall && cache) saveAgentCache(rootPath, cache);

  return d2Files;
}
