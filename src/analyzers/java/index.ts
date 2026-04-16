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
import { extractCodeElementsForFiles } from "../tree-sitter.js";
import { slugify } from "../../core/slugify.js";
import { parseJavaImports } from "./imports.js";
import { extractPackages, detectClassAnnotations } from "./packages.js";
import {
  parseSettingsGradle,
  parseGradleDependencies,
  findFile,
} from "./gradle.js";
import { collectConfigFiles } from "../config-files.js";
import { extractJavaCode } from "./code.js";

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

function parsePomProjectName(pomPath: string): string | null {
  if (!fs.existsSync(pomPath)) return null;
  const content = fs.readFileSync(pomPath, "utf-8");
  // Remove <parent> block to avoid matching parent's artifactId
  const withoutParent = content.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const match = withoutParent.match(/<artifactId>([^<]+)<\/artifactId>/);
  return match?.[1] ?? null;
}

export const javaAnalyzer: LanguageAnalyzer = {
  id: "java",
  name: "Java",
  buildFilePatterns: ["pom.xml", "build.gradle", "build.gradle.kts"],
  defaultExcludes: ["**/target/**", "**/.gradle/**"],

  async analyze(
    appPath: string,
    config: ScanConfig,
  ): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const dirName = path.basename(appPath);

    // Read settings.gradle to discover subprojects and exclude their dirs from root scan
    const settings = parseSettingsGradle(appPath);
    const subprojectDirs = settings?.subprojects.map((s) => s.dir) ?? [];
    const excludePatterns = [
      ...config.exclude,
      ...subprojectDirs.map((d) => `${d}/**`),
    ];

    const packages = await extractPackages(appPath, excludePatterns);

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
          const isInternal = packages.some(
            (p) => p.name === pkgPrefix || imp.source.startsWith(p.name),
          );
          imports.push({
            source: imp.source,
            isExternal: !isInternal,
          });
        }

        const annotations = detectClassAnnotations(fullPath);
        allAnnotations.push(...annotations);
      }

      if (allAnnotations.length > 0) {
        metadata["annotations"] = [...new Set(allAnnotations)].join(",");
      }

      const module: ScannedModule = {
        id: slugify(`${appPath}/${pkg.path}`),
        path: pkg.path,
        name: pkg.name,
        files: pkg.files,
        exports: pkg.publicClasses,
        imports: deduplicateImports(imports),
        metadata,
      };

      if (config.levels?.code) {
        const filePaths = module.files
          .filter((f) => f.endsWith(".java"))
          .map((f) => path.join(searchBase, f));
        const allElements = await extractCodeElementsForFiles(
          filePaths,
          extractJavaCode,
        );
        if (allElements.length > 0) module.codeElements = allElements;
      }

      modules.push(module);
    }

    // Handle build file dependencies
    const pomPath = path.join(appPath, "pom.xml");
    const gradleBuildFile = findFile(appPath, [
      "build.gradle",
      "build.gradle.kts",
    ]);

    let externalDependencies: ExternalDep[] = [];
    const internalImports: InternalImport[] = [];
    let buildFile: string;
    let publishedAs: string | undefined;
    let appName = dirName;

    if (fs.existsSync(pomPath)) {
      // Maven project
      buildFile = "pom.xml";
      externalDependencies = parsePomDependencies(pomPath);
      appName = parsePomProjectName(pomPath) ?? dirName;
    } else if (gradleBuildFile) {
      // Gradle project
      buildFile = path.basename(gradleBuildFile);
      const gradleDeps = parseGradleDependencies(gradleBuildFile);

      // Map Maven deps to externalDependencies
      externalDependencies = gradleDeps.mavenDeps.map((d) => ({
        name: `${d.group}:${d.artifact}`,
        version: d.version,
      }));

      // Map project deps to internalImports
      // Resolve project dep names to directories using parent's settings.gradle
      const parentPath = path.dirname(appPath);
      const parentSettings = parseSettingsGradle(parentPath);

      for (const projDep of gradleDeps.projectDeps) {
        // Find the directory for this project dep from parent settings
        let targetDir = projDep; // default: project name = directory name
        if (parentSettings) {
          const sub = parentSettings.subprojects.find(
            (s) => s.name === projDep,
          );
          if (sub) {
            targetDir = sub.dir;
          }
        }

        internalImports.push({
          sourceModuleId: appId,
          targetApplicationId: slugify(path.join(parentPath, targetDir)),
          targetPath: targetDir,
        });
      }

      // Derive app name from Gradle settings
      if (parentSettings) {
        const matchingSub = parentSettings.subprojects.find(
          (s) => s.dir === dirName || s.name === dirName,
        );
        if (matchingSub) {
          appName = matchingSub.name;
        } else {
          appName = settings?.rootProjectName ?? dirName;
        }
      } else {
        appName = settings?.rootProjectName ?? dirName;
      }

      // Compute publishedAs from group + artifact name
      if (gradleDeps.group) {
        publishedAs = `${gradleDeps.group}:${appName}`;
      }
    } else {
      buildFile = "build.gradle";
    }

    // Collect config/resource files for LLM-based architecture analysis
    const resourceDirs = [
      path.join(appPath, "src", "main", "resources"),
      path.join(appPath, "src", "main", "webapp", "WEB-INF"),
    ];
    const configFiles = resourceDirs.flatMap((dir) =>
      collectConfigFiles(dir, appPath, config.exclude),
    );

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "java",
      buildFile,
      modules,
      externalDependencies,
      internalImports,
      publishedAs,
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
