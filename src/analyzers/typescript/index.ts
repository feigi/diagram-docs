import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ExternalDep,
  InternalImport,
  ModuleImport,
} from "../types.js";
import { slugify } from "../../core/slugify.js";
import { parseTypeScriptImports } from "./imports.js";
import { extractTypeScriptModules, resolveSourceRoot } from "./modules.js";
import { collectConfigFiles } from "../config-files.js";

const KNOWN_FRAMEWORKS: Record<string, string> = {
  "express": "Express",
  "fastify": "Fastify",
  "@nestjs/core": "NestJS",
  "next": "Next.js",
  "hono": "Hono",
  "@angular/core": "Angular",
  "nuxt": "Nuxt",
  "remix": "Remix",
  "koa": "Koa",
};

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(appPath: string): PackageJson | null {
  const pkgPath = path.join(appPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

function parseDependencies(
  appPath: string,
  pkg: PackageJson,
): { external: ExternalDep[]; internal: InternalImport[] } {
  const external: ExternalDep[] = [];
  const internal: InternalImport[] = [];
  const deps = pkg.dependencies ?? {};

  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith("file:") || version.startsWith("link:")) {
      // Resolve path to target application
      const prefix = version.startsWith("file:") ? "file:" : "link:";
      const targetRelPath = version.slice(prefix.length);
      const targetPath = path.resolve(appPath, targetRelPath);

      internal.push({
        sourceModuleId: slugify(appPath),
        targetApplicationId: slugify(targetPath),
        targetPath: targetRelPath,
      });
    } else {
      external.push({ name, version: version.replace(/^(?:workspace:|[\^~>=<]+)/, "") || undefined });
    }
  }

  return { external, internal };
}

function detectFrameworks(pkg: PackageJson): Set<string> {
  const detected = new Set<string>();
  const deps = pkg.dependencies ?? {};
  for (const depName of Object.keys(deps)) {
    const framework = KNOWN_FRAMEWORKS[depName];
    if (framework) detected.add(framework);
  }
  return detected;
}

export const typescriptAnalyzer: LanguageAnalyzer = {
  id: "typescript",
  name: "TypeScript",
  buildFilePatterns: ["tsconfig.json"],
  defaultExcludes: ["**/node_modules/**", "**/dist/**"],

  async analyze(
    appPath: string,
    config: ScanConfig,
  ): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const pkg = readPackageJson(appPath);
    const appName = pkg?.name ?? path.basename(appPath);

    const tsModules = await extractTypeScriptModules(appPath, config.exclude);
    const sourceRoot = resolveSourceRoot(appPath);
    const detectedFrameworks = pkg ? detectFrameworks(pkg) : new Set<string>();

    const modules: ScannedModule[] = [];

    for (const mod of tsModules) {
      const imports: ModuleImport[] = [];
      const metadata: Record<string, string> = {};
      const moduleFrameworks: string[] = [];

      for (const file of mod.files) {
        const fullPath = path.join(sourceRoot, file);
        const tsImports = parseTypeScriptImports(fullPath);

        for (const imp of tsImports) {
          const isExternal = !imp.isRelative;

          imports.push({
            source: imp.source,
            isExternal,
          });

          // Check if this import references a detected framework
          if (isExternal) {
            for (const [depName, frameworkName] of Object.entries(KNOWN_FRAMEWORKS)) {
              if (
                detectedFrameworks.has(frameworkName) &&
                (imp.source === depName || imp.source.startsWith(depName + "/"))
              ) {
                if (!moduleFrameworks.includes(frameworkName)) {
                  moduleFrameworks.push(frameworkName);
                }
              }
            }
          }
        }
      }

      if (moduleFrameworks.length > 0) {
        metadata["framework"] = moduleFrameworks.join(",");
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

    // Parse dependencies
    const { external: externalDependencies, internal: internalImports } =
      pkg ? parseDependencies(appPath, pkg) : { external: [], internal: [] };

    // Collect config files
    const configFiles = collectConfigFiles(appPath, appPath);

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "typescript",
      buildFile: "tsconfig.json",
      modules,
      externalDependencies,
      internalImports,
      publishedAs: pkg?.name,
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
