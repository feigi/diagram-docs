import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import { parseJavaPackage } from "./imports.js";

export interface JavaPackage {
  name: string;
  path: string;
  files: string[];
  publicClasses: string[];
}

/** Regex to match class-level annotations (before class/interface/enum/record declarations) */
const CLASS_ANNOTATION_RE =
  /^[ \t]*(@\w+)(?:\([^)]*\))?[ \t]*$(?=[\s\S]*?(?:public\s+)?(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum|record)\b)/gm;

export async function extractPackages(
  appPath: string,
  exclude: string[],
): Promise<JavaPackage[]> {
  const srcMain = path.join(appPath, "src", "main", "java");
  const searchBase = fs.existsSync(srcMain) ? srcMain : appPath;

  const javaFiles = await glob("**/*.java", {
    cwd: searchBase,
    ignore: exclude,
    nodir: true,
  });

  const packageMap = new Map<string, JavaPackage>();

  for (const file of javaFiles) {
    const fullPath = path.join(searchBase, file);
    const pkg = parseJavaPackage(fullPath) ?? path.dirname(file).replace(/\//g, ".");
    const pkgPath = path.dirname(file);

    if (!packageMap.has(pkg)) {
      packageMap.set(pkg, {
        name: pkg,
        path: pkgPath,
        files: [],
        publicClasses: [],
      });
    }

    const entry = packageMap.get(pkg)!;
    entry.files.push(file);

    // Extract public class name (simple heuristic)
    const className = path.basename(file, ".java");
    const content = fs.readFileSync(fullPath, "utf-8");
    if (content.includes(`public class ${className}`) ||
        content.includes(`public interface ${className}`) ||
        content.includes(`public enum ${className}`)) {
      entry.publicClasses.push(className);
    }
  }

  return Array.from(packageMap.values());
}

/**
 * Detect all class-level annotations in a Java file (framework-agnostic).
 * Returns annotation names without the '@' prefix.
 */
export function detectClassAnnotations(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const annotations: string[] = [];
  for (const match of content.matchAll(CLASS_ANNOTATION_RE)) {
    annotations.push(match[1].slice(1)); // Remove '@' prefix
  }
  return annotations;
}

/** @deprecated Use detectClassAnnotations instead */
export function detectSpringAnnotations(filePath: string): string[] {
  return detectClassAnnotations(filePath);
}
