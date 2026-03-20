import * as fs from "node:fs";

const IMPORT_PATTERN = /^import\s+(static\s+)?([a-zA-Z0-9_.]+(?:\.\*)?)\s*;/gm;
const PACKAGE_PATTERN = /^package\s+([a-zA-Z0-9_.]+)\s*;/m;

export interface JavaImportInfo {
  source: string;
  isStatic: boolean;
  isWildcard: boolean;
}

export function parseJavaImports(filePath: string): JavaImportInfo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const imports: JavaImportInfo[] = [];

  for (const match of content.matchAll(IMPORT_PATTERN)) {
    imports.push({
      source: match[2],
      isStatic: !!match[1],
      isWildcard: match[2].endsWith(".*"),
    });
  }
  return imports;
}

export function parseJavaPackage(filePath: string): string | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const match = content.match(PACKAGE_PATTERN);
  return match ? match[1] : null;
}
