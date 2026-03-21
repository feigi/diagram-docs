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
import { parseJavaImports } from "./imports.js";
import { extractPackages, detectSpringAnnotations } from "./packages.js";
import { parseSettingsGradle, parseGradleDependencies } from "./gradle.js";

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

    // Handle build file dependencies
    const pomPath = path.join(appPath, "pom.xml");
    const gradleBuildFile = findBuildGradle(appPath);

    let externalDependencies: ExternalDep[] = [];
    let internalImports: InternalImport[] = [];
    let buildFile: string;
    let publishedAs: string | undefined;

    if (fs.existsSync(pomPath)) {
      // Maven project
      buildFile = "pom.xml";
      externalDependencies = parsePomDependencies(pomPath);
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
          const sub = parentSettings.subprojects.find((s) => s.name === projDep);
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

      // Compute publishedAs from group + artifact name
      if (gradleDeps.group) {
        // Determine artifact name
        let artifactName: string;

        // Check if this is a subproject by looking at parent's settings.gradle
        if (parentSettings) {
          const isSubproject = parentSettings.subprojects.some(
            (s) => s.dir === appName || s.name === appName,
          );
          if (isSubproject) {
            artifactName = appName;
          } else {
            // Root project — use rootProject.name from own settings
            artifactName = settings?.rootProjectName ?? appName;
          }
        } else {
          // No parent settings — this is either a standalone or root project
          artifactName = settings?.rootProjectName ?? appName;
        }

        publishedAs = `${gradleDeps.group}:${artifactName}`;
      }
    } else {
      buildFile = "build.gradle";
    }

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

function findBuildGradle(appPath: string): string | null {
  for (const name of ["build.gradle", "build.gradle.kts"]) {
    const p = path.join(appPath, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
