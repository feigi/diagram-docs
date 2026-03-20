import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ExternalDep,
  ModuleImport,
  ModuleSymbols,
} from "../types.js";
import { slugify } from "../../core/slugify.js";
import { parseJavaImports } from "./imports.js";
import { extractPackages, detectSpringAnnotations } from "./packages.js";
import { extractJavaSymbols } from "./symbols.js";

function parsePomDependencies(pomPath: string): ExternalDep[] {
  if (!fs.existsSync(pomPath)) return [];
  const content = fs.readFileSync(pomPath, "utf-8");
  const deps: ExternalDep[] = [];

  for (const match of content.matchAll(
    /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]*)<\/version>)?/g,
  )) {
    deps.push({
      name: `${match[1]}:${match[2]}`,
      version: match[3] || undefined,
    });
  }
  return deps;
}

export const javaAnalyzer: LanguageAnalyzer = {
  id: "java",
  name: "Java",
  buildFilePatterns: ["pom.xml", "build.gradle", "build.gradle.kts"],

  async analyze(appPath: string, config: ScanConfig): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const appName = path.basename(appPath);

    const packages = await extractPackages(appPath, config.exclude);

    const srcMain = path.join(appPath, "src", "main", "java");
    const searchBase = fs.existsSync(srcMain) ? srcMain : appPath;

    const modules: ScannedModule[] = [];

    for (const pkg of packages) {
      const imports: ModuleImport[] = [];
      const metadata: Record<string, string> = {};
      const allAnnotations: string[] = [];

      for (const file of pkg.files) {
        const fullPath = path.join(searchBase, file);
        const javaImports = parseJavaImports(fullPath);

        for (const imp of javaImports) {
          const pkgPrefix = imp.source.split(".").slice(0, -1).join(".");
          const isInternal = packages.some((p) => p.name === pkgPrefix || imp.source.startsWith(p.name));
          imports.push({
            source: imp.source,
            isExternal: !isInternal,
          });
        }

        const annotations = detectSpringAnnotations(fullPath);
        allAnnotations.push(...annotations);
      }

      if (allAnnotations.length > 0) {
        metadata["spring.stereotypes"] = [...new Set(allAnnotations)].join(",");
      }

      modules.push({
        id: slugify(`${appPath}/${pkg.path}`),
        path: pkg.path,
        name: pkg.name,
        files: pkg.files,
        exports: pkg.publicClasses,
        imports: deduplicateImports(imports),
        metadata,
      });
    }

    const pomPath = path.join(appPath, "pom.xml");
    const externalDependencies = parsePomDependencies(pomPath);

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "java",
      buildFile: fs.existsSync(pomPath) ? "pom.xml" : "build.gradle",
      modules,
      externalDependencies,
      internalImports: [],
    };
  },

  async analyzeModule(modulePath: string, _config: ScanConfig): Promise<ModuleSymbols> {
    const files: Array<{ path: string; content: string }> = [];
    const entries = fs.readdirSync(modulePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".java")) {
        const content = fs.readFileSync(path.join(modulePath, entry.name), "utf-8");
        files.push({ path: entry.name, content });
      }
    }
    return extractJavaSymbols(files);
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
