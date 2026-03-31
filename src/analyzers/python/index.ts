import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ExternalDep,
  ModuleImport,
} from "../types.js";
import { slugify } from "../../core/slugify.js";
import { parsePythonImports } from "./imports.js";
import { extractPythonModules, detectPythonFramework } from "./modules.js";
import { collectConfigFiles } from "../config-files.js";

function parseRequirements(appPath: string): ExternalDep[] {
  const reqPath = path.join(appPath, "requirements.txt");
  if (!fs.existsSync(reqPath)) return [];

  const content = fs.readFileSync(reqPath, "utf-8");
  const deps: ExternalDep[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const match = line.match(/^([a-zA-Z0-9_-]+)(?:[=<>!~]+(.+))?/);
    if (!match) continue;
    deps.push({ name: match[1], version: match[2] });
  }
  return deps;
}

function parsePyprojectDeps(appPath: string): ExternalDep[] {
  const tomlPath = path.join(appPath, "pyproject.toml");
  if (!fs.existsSync(tomlPath)) return [];

  const content = fs.readFileSync(tomlPath, "utf-8");
  const deps: ExternalDep[] = [];

  // Simple regex extraction from dependencies array
  const depsSection = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depsSection) {
    const lines = depsSection[1].match(/"([^"]+)"/g);
    if (lines) {
      for (const line of lines) {
        const clean = line.replace(/"/g, "");
        const match = clean.match(/^([a-zA-Z0-9_-]+)/);
        if (match) {
          deps.push({ name: match[1] });
        }
      }
    }
  }

  return deps;
}

export const pythonAnalyzer: LanguageAnalyzer = {
  id: "python",
  name: "Python",
  buildFilePatterns: ["pyproject.toml", "setup.py", "requirements.txt"],
  defaultExcludes: [
    "**/venv/**",
    "**/.venv/**",
    "**/env/**",
    "**/.env/**",
    "**/virtualenv/**",
    "**/.tox/**",
    "**/.nox/**",
    "**/__pypackages__/**",
    "**/site-packages/**",
    "**/__pycache__/**",
    "**/.pytest_cache/**",
    "**/.mypy_cache/**",
    "**/.ruff_cache/**",
  ],

  async analyze(
    appPath: string,
    config: ScanConfig,
  ): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const appName = path.basename(appPath);

    const pyModules = await extractPythonModules(appPath, config.exclude);

    const modules: ScannedModule[] = [];

    for (const mod of pyModules) {
      const imports: ModuleImport[] = [];
      const metadata: Record<string, string> = {};
      let framework: string | null = null;

      for (const file of mod.files) {
        const fullPath = path.join(appPath, file);
        const pyImports = parsePythonImports(fullPath);

        for (const imp of pyImports) {
          const topLevel = imp.source.split(".")[0];
          const isInternal = pyModules.some((m) => m.name === topLevel);
          imports.push({
            source: imp.source,
            isExternal: !isInternal && !imp.isRelative,
          });
        }

        const detected = detectPythonFramework(fullPath);
        if (detected) framework = detected;
      }

      if (framework) {
        metadata["framework"] = framework;
      }

      modules.push({
        id: slugify(`${appPath}/${mod.path}`),
        path: mod.path,
        name: mod.name,
        files: mod.files,
        exports: mod.exports,
        imports: deduplicateImports(imports),
        metadata,
      });
    }

    const externalDependencies = [
      ...parseRequirements(appPath),
      ...parsePyprojectDeps(appPath),
    ];

    // Determine build file
    let buildFile = "requirements.txt";
    if (fs.existsSync(path.join(appPath, "pyproject.toml")))
      buildFile = "pyproject.toml";
    else if (fs.existsSync(path.join(appPath, "setup.py")))
      buildFile = "setup.py";

    // Collect config files for LLM-based architecture analysis
    const configFiles = collectConfigFiles(appPath, appPath, config.exclude);

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "python",
      buildFile,
      modules,
      externalDependencies,
      internalImports: [],
      configFiles: configFiles.length > 0 ? configFiles : undefined,
    };
  },
};

function deduplicateImports(imports: ModuleImport[]): ModuleImport[] {
  const seen = new Set<string>();
  return imports.filter((imp) => {
    if (seen.has(imp.source)) return false;
    seen.add(imp.source);
    return true;
  });
}
