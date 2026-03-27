import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectType } from "../analyzers/types.js";
import type { DiscoveredApp } from "./discovery.js";

/**
 * Classify a discovered project as container or library by inspecting
 * its build file. An explicit config override takes precedence.
 */
export function classifyProject(
  app: DiscoveredApp,
  appAbsPath: string,
  configOverride?: ProjectType,
): ProjectType {
  if (configOverride) return configOverride;

  switch (app.language) {
    case "c":
      return classifyC(appAbsPath, app.buildFile);
    case "java":
      return classifyJava(appAbsPath, app.buildFile);
    case "typescript":
      return classifyTypeScript(appAbsPath, app.buildFile);
    case "python":
      return classifyPython(appAbsPath);
    default:
      return "container";
  }
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function classifyC(appAbsPath: string, buildFile: string): ProjectType {
  if (buildFile !== "CMakeLists.txt") return "container";

  const content = readFileIfExists(path.join(appAbsPath, buildFile));
  if (!content) return "container";

  if (/add_library\s*\(/i.test(content)) return "library";
  if (/add_executable\s*\(/i.test(content)) return "container";
  return "container";
}

function classifyJava(appAbsPath: string, buildFile: string): ProjectType {
  const content = readFileIfExists(path.join(appAbsPath, buildFile));
  if (!content) return "container";

  if (/<packaging>\s*war\s*<\/packaging>/i.test(content)) return "container";
  if (/spring-boot-maven-plugin/i.test(content)) return "container";
  if (/application\s*\{|id\s+['"]application['"]/i.test(content))
    return "container";
  if (/<packaging>\s*jar\s*<\/packaging>/i.test(content)) return "library";

  return "container";
}

function classifyTypeScript(
  appAbsPath: string,
  buildFile: string,
): ProjectType {
  if (buildFile !== "package.json") return "container";

  const content = readFileIfExists(path.join(appAbsPath, buildFile));
  if (!content) return "container";

  let pkg: { bin?: unknown; main?: string; scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(content);
  } catch {
    return "container";
  }

  if (pkg.bin) return "container";

  const scripts = pkg.scripts ?? {};
  const serverScripts = ["start", "serve", "dev"];
  for (const name of serverScripts) {
    const script = scripts[name];
    if (
      script &&
      /\b(server|app|index|main)\b/i.test(script) &&
      !/\b(vitest|jest|mocha|tsc|eslint|prettier)\b/i.test(script)
    ) {
      return "container";
    }
  }

  return "library";
}

function classifyPython(appAbsPath: string): ProjectType {
  const entrypoints = ["__main__.py", "app.py", "main.py"];
  for (const entry of entrypoints) {
    if (fs.existsSync(path.join(appAbsPath, entry))) return "container";

    try {
      const entries = fs.readdirSync(appAbsPath, { withFileTypes: true });
      for (const dir of entries) {
        if (
          dir.isDirectory() &&
          !dir.name.startsWith(".") &&
          !dir.name.startsWith("_")
        ) {
          if (fs.existsSync(path.join(appAbsPath, dir.name, entry))) {
            return "container";
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  const pyproject = readFileIfExists(path.join(appAbsPath, "pyproject.toml"));
  if (pyproject && /\[project\.scripts\]/i.test(pyproject)) return "container";

  const setupCfg = readFileIfExists(path.join(appAbsPath, "setup.cfg"));
  if (setupCfg && /console_scripts/i.test(setupCfg)) return "container";

  return "library";
}
