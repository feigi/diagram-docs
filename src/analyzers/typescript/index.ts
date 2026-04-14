import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ExternalDep,
  InternalImport,
  ModuleImport,
  RawCodeElement,
} from "../types.js";
import { slugify } from "../../core/slugify.js";
import { parseTypeScriptImports } from "./imports.js";
import { extractTypeScriptModules, resolveSourceRoot } from "./modules.js";
import { collectConfigFiles } from "../config-files.js";
import { extractTypeScriptCode } from "./code.js";

const KNOWN_FRAMEWORKS: Record<string, string> = {
  express: "Express",
  fastify: "Fastify",
  "@nestjs/core": "NestJS",
  next: "Next.js",
  hono: "Hono",
  "@angular/core": "Angular",
  nuxt: "Nuxt",
  remix: "Remix",
  koa: "Koa",
};

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(appPath: string): PackageJson | null {
  const pkgPath = path.join(appPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  const content = fs.readFileSync(pkgPath, "utf-8");
  try {
    return JSON.parse(content) as PackageJson;
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(
        `Warning: ${pkgPath} contains invalid JSON (${err.message}), dependency data will be missing\n`,
      );
      return null;
    }
    throw err;
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
      external.push({
        name,
        version: version.replace(/^(?:workspace:|[\^~>=<]+)/, "") || undefined,
      });
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
        let tsImports;
        try {
          tsImports = parseTypeScriptImports(fullPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            process.stderr.write(
              `Warning: source file not found during import scan, skipping: ${fullPath}\n`,
            );
            continue;
          }
          throw err;
        }

        for (const imp of tsImports) {
          const isExternal = !imp.isRelative;

          imports.push({
            source: imp.source,
            isExternal,
          });

          // Check if this import references a detected framework
          if (isExternal) {
            for (const [depName, frameworkName] of Object.entries(
              KNOWN_FRAMEWORKS,
            )) {
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

      const module: ScannedModule = {
        id: slugify(`${appPath}/${mod.path}`),
        path: mod.path,
        name: mod.name,
        files: mod.files,
        exports: mod.exports,
        imports: deduplicateImports(imports),
        metadata,
      };

      if (config.levels?.code) {
        const allElements: RawCodeElement[] = [];
        for (const file of module.files.filter(
          (f) =>
            (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".d.ts"),
        )) {
          const fullPath = path.join(sourceRoot, file);
          const source = await fsp.readFile(fullPath, "utf-8");
          const elements = await extractTypeScriptCode(fullPath, source);
          allElements.push(...elements);
        }
        if (allElements.length > 0) module.codeElements = allElements;
      }

      modules.push(module);
    }

    // Parse dependencies
    const { external: externalDependencies, internal: internalImports } = pkg
      ? parseDependencies(appPath, pkg)
      : { external: [], internal: [] };

    // Collect config files
    const configFiles = collectConfigFiles(appPath, appPath, config.exclude);

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
