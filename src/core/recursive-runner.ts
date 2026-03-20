/**
 * Recursive descent orchestrator.
 *
 * `processFolder` is the main entry point — it classifies a folder,
 * generates the appropriate C4 diagrams, and recurses into children.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { Config, FolderRole } from "../config/schema.js";
import type { ArchitectureModel, ScanConfig } from "../analyzers/types.js";
import { collectSignals, inferRole } from "./classifier.js";
import { agentClassify } from "./agent-assist.js";
import { humanizeName } from "./humanize.js";
import { buildModel } from "./model-builder.js";
import { generateContextDiagram } from "../generator/d2/context.js";
import { generateContainerDiagram } from "../generator/d2/container.js";
import { generateComponentDiagram } from "../generator/d2/component.js";
import { generateCodeDiagram } from "../generator/d2/code.js";
import { discoverApplications } from "./discovery.js";
import { getAnalyzer } from "../analyzers/registry.js";
import { slugify } from "./slugify.js";
import { scaffoldForRole } from "../generator/d2/scaffold.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getExcludeDirs(config: Config): Set<string> {
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
    config.output.docsDir,
  ]);
}

/**
 * Write a file only if its content has changed (preserves mtime for
 * downstream rendering caches).
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
 * Map of file extension to analyzer language ID.
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
  } catch {
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
      if (!analyzer) return null;
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
      const relPath = path.relative(outputDir, path.join(folderPath, childDocsDir));
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
      if (!analyzer) return null;
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

  for (const container of model.containers) {
    const componentD2 = generateComponentDiagram(model, container.id);
    const componentPath = path.join(generatedDir, "component.d2");
    writeIfChanged(componentPath, componentD2);
    d2Files.push(componentPath);
  }

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
  if (!language) return d2Files;

  const analyzer = getAnalyzer(language);
  if (!analyzer?.analyzeModule) return d2Files;

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
 * Recursively process a folder: classify, generate diagrams, recurse.
 *
 * @param folderPath - Absolute path to the folder to process
 * @param rootPath   - Absolute path to the project root
 * @param config     - Resolved configuration
 * @param parentContext - Optional context string from the parent folder
 * @param parentFolderPath - Absolute path to the parent folder (for scaffold breadcrumbs)
 * @returns List of generated D2 file paths
 */
export async function processFolder(
  folderPath: string,
  rootPath: string,
  config: Config,
  parentContext?: string,
  parentFolderPath?: string,
): Promise<string[]> {
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
    // Agent classification
    const heuristic = inferRole(signals);
    const classification = await agentClassify(
      folderPath,
      signals,
      heuristic,
      config,
      rootPath,
      parentContext,
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

  // 4. Skip
  if (role === "skip") {
    return d2Files;
  }

  // 5. Generate diagrams based on role
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
  }

  // 5b. Scaffold user-facing D2 files for this role
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

  // 6. Recurse into child directories
  const excludeDirs = getExcludeDirs(config);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
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
    );
    d2Files.push(...childFiles);
  }

  return d2Files;
}
