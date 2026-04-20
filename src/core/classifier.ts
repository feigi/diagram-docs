import * as fs from "node:fs";
import * as path from "node:path";
import type { FolderRole } from "../config/schema.js";

export interface FolderSignals {
  buildFiles: string[];
  childrenWithBuildFiles: number;
  infraFiles: string[];
  sourceFileCount: number;
  sourceLanguages: string[];
  hasPackageStructure: boolean;
  depth: number;
  childFolderNames: string[];
  readmeSnippet: string | null;
  hasSourceFiles: boolean;
  isPackageDir: boolean;
}

const BUILD_FILES = new Set([
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "package.json",
  "CMakeLists.txt",
  "Makefile",
  "Cargo.toml",
  "go.mod",
]);

const INFRA_FILES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
]);

const SOURCE_EXTENSIONS: Record<string, string> = {
  ".java": "java",
  ".py": "python",
  ".c": "c",
  ".h": "c",
  ".ts": "typescript",
  ".js": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".kt": "kotlin",
  ".scala": "scala",
  ".cs": "csharp",
};

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "build",
  "dist",
  "target",
  ".diagram-docs",
  "__pycache__",
  ".venv",
  "venv",
]);

const PACKAGE_MARKERS = new Set(["__init__.py"]);

/**
 * Collect signals from a folder for classification.
 *
 * Scans the current folder plus one level of children, with a special-case
 * probe for `src/main/java` so Maven/Gradle package layouts are detected
 * without a full recursive walk.
 *
 * All returned arrays are sorted so `computeSignalHash` produces the same
 * hash across operating systems and filesystems, making the agent cache
 * portable between machines.
 */
export function collectSignals(
  folderPath: string,
  rootPath: string,
): FolderSignals {
  const buildFiles: string[] = [];
  const infraFiles: string[] = [];
  const childFolderNames: string[] = [];
  const languageSet = new Set<string>();
  let sourceFileCount = 0;
  let childrenWithBuildFiles = 0;
  let hasPackageStructure = false;
  let isPackageDir = false;
  let readmeSnippet: string | null = null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE") throw err;
    console.error(
      `Warning: cannot read directory ${folderPath}: ${err instanceof Error ? err.message : err}. Returning empty signals.`,
    );
    return {
      buildFiles: [],
      childrenWithBuildFiles: 0,
      infraFiles: [],
      sourceFileCount: 0,
      sourceLanguages: [],
      hasPackageStructure: false,
      depth: computeDepth(folderPath, rootPath),
      childFolderNames: [],
      readmeSnippet: null,
      hasSourceFiles: false,
      isPackageDir: false,
    };
  }

  for (const entry of entries) {
    const name = entry.name;

    if (entry.isFile()) {
      if (BUILD_FILES.has(name)) {
        buildFiles.push(name);
      }

      if (INFRA_FILES.has(name)) {
        infraFiles.push(name);
      }

      const ext = path.extname(name);
      const lang = SOURCE_EXTENSIONS[ext];
      if (lang) {
        sourceFileCount++;
        languageSet.add(lang);
      }

      // __init__.py is dual-purpose: sets isPackageDir (drives component
      // classification when no build file is present) and hasPackageStructure
      // (drives container classification when a build file is present).
      if (PACKAGE_MARKERS.has(name)) {
        isPackageDir = true;
        hasPackageStructure = true;
      }

      if (name.toLowerCase().startsWith("readme") && readmeSnippet === null) {
        try {
          const content = fs.readFileSync(
            path.join(folderPath, name),
            "utf-8",
          );
          readmeSnippet = content.slice(0, 200);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EMFILE" || code === "ENFILE") throw err;
          console.error(
            `Warning: cannot read README at ${path.join(folderPath, name)}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } else if (entry.isDirectory() && !EXCLUDED_DIRS.has(name)) {
      childFolderNames.push(name);

      // Check children for build files and source languages (one level deep).
      // Child source files contribute to sourceLanguages but NOT to sourceFileCount
      // or hasSourceFiles — those reflect only the folder's own direct contents.
      let childEntries: fs.Dirent[];
      try {
        childEntries = fs.readdirSync(path.join(folderPath, name), {
          withFileTypes: true,
        });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EMFILE" || code === "ENFILE") throw err;
        console.error(
          `Warning: cannot read child directory ${path.join(folderPath, name)}: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }

      let childHasBuildFile = false;
      for (const childEntry of childEntries) {
        if (childEntry.isFile()) {
          if (BUILD_FILES.has(childEntry.name)) {
            childHasBuildFile = true;
          }

          const ext = path.extname(childEntry.name);
          const lang = SOURCE_EXTENSIONS[ext];
          if (lang) {
            languageSet.add(lang);
          }
        }
      }

      if (childHasBuildFile) {
        childrenWithBuildFiles++;
      }

      // Detect src/main/java pattern for package structure
      if (name === "src") {
        try {
          const mainJavaPath = path.join(folderPath, "src", "main", "java");
          if (
            fs.existsSync(mainJavaPath) &&
            fs.statSync(mainJavaPath).isDirectory()
          ) {
            hasPackageStructure = true;
          }
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EMFILE" || code === "ENFILE") throw err;
          // ENOENT is benign (no src/main/java layout). Anything else
          // (EACCES, EPERM, …) means we might be misclassifying a folder
          // that actually has package structure — surface it.
          if (code !== "ENOENT") {
            console.error(
              `Warning: cannot probe ${path.join(folderPath, "src", "main", "java")} for Java package structure, folder may be misclassified: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      }
    }
  }

  const depth = computeDepth(folderPath, rootPath);

  // Sort to make signalHash stable across OS / filesystem ordering.
  buildFiles.sort();
  infraFiles.sort();
  childFolderNames.sort();
  const sourceLanguages = [...languageSet].sort();

  return {
    buildFiles,
    childrenWithBuildFiles,
    infraFiles,
    sourceFileCount,
    sourceLanguages,
    hasPackageStructure,
    depth,
    childFolderNames,
    readmeSnippet,
    hasSourceFiles: sourceFileCount > 0,
    isPackageDir,
  };
}

/**
 * Compute depth of folder relative to root.
 */
function computeDepth(folderPath: string, rootPath: string): number {
  const rel = path.relative(rootPath, folderPath);
  if (rel === "") return 0;
  return rel.split(path.sep).length;
}

/**
 * Apply heuristic rules to classify a folder based on its signals.
 */
export function inferRole(signals: FolderSignals): FolderRole {
  // A folder with multiple children that have build files is a system root
  if (signals.childrenWithBuildFiles >= 2) {
    return "system";
  }

  // A folder with a build file and source files
  if (signals.buildFiles.length > 0 && signals.hasSourceFiles) {
    if (signals.hasPackageStructure) {
      return "container";
    }
    return "code-only";
  }

  // A package directory with source files is a component
  if (signals.isPackageDir && signals.hasSourceFiles) {
    return "component";
  }

  return "skip";
}
