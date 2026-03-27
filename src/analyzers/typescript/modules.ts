import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

export interface TypeScriptModule {
  name: string;
  path: string;
  files: string[];
  exports: string[];
}

// Matches: export class/function/const/let/var/interface/type/enum Name
const NAMED_EXPORT = /^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$]\w*)/gm;

/**
 * Read tsconfig.json and resolve the source root directory.
 * Falls back to the project root if no rootDir or include is configured.
 */
export function resolveSourceRoot(appPath: string): string {
  const tsconfigPath = path.join(appPath, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return appPath;

  // I/O errors propagate; only JSON parse failures fall back to appPath
  const raw = fs.readFileSync(tsconfigPath, "utf-8");
  try {
    // Strip comments (// and /* */) for JSON parsing
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const tsconfig = JSON.parse(stripped);

    // Prefer rootDir
    const rootDir = tsconfig.compilerOptions?.rootDir;
    if (rootDir) {
      const resolved = path.resolve(appPath, rootDir);
      if (fs.existsSync(resolved)) return resolved;
    }

    // Fall back to first include pattern directory
    const include = tsconfig.include;
    if (Array.isArray(include) && include.length > 0) {
      // Take the first include entry as base (e.g., "src" from ["src"])
      const first = include[0].replace(/\/\*.*$/, ""); // strip glob suffix
      const resolved = path.resolve(appPath, first);
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    // Malformed tsconfig — fall back to appPath
  }

  return appPath;
}

export async function extractTypeScriptModules(
  appPath: string,
  exclude: string[],
): Promise<TypeScriptModule[]> {
  const sourceRoot = resolveSourceRoot(appPath);

  const tsFiles = await glob("**/*.{ts,tsx}", {
    cwd: sourceRoot,
    ignore: [
      ...exclude,
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/*.d.ts",
    ],
    nodir: true,
  });

  const moduleMap = new Map<string, TypeScriptModule>();

  for (const file of tsFiles) {
    const parts = file.split("/");
    let moduleName: string;
    let modulePath: string;

    if (parts.length === 1) {
      // Root-level file
      moduleName = path.basename(appPath);
      modulePath = ".";
    } else {
      moduleName = parts[0];
      modulePath = parts[0];
    }

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        name: moduleName,
        path: modulePath,
        files: [],
        exports: [],
      });
    }

    const mod = moduleMap.get(moduleName)!;
    mod.files.push(file);

    // Extract exports
    const fullPath = path.join(sourceRoot, file);
    const content = fs.readFileSync(fullPath, "utf-8");

    for (const match of content.matchAll(NAMED_EXPORT)) {
      const name = match[1];
      if (!mod.exports.includes(name)) {
        mod.exports.push(name);
      }
    }
  }

  return Array.from(moduleMap.values());
}
