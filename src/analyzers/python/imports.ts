import * as fs from "node:fs";

const IMPORT_PATTERN = /^import\s+([a-zA-Z0-9_.]+)/gm;
const FROM_IMPORT_PATTERN = /^from\s+([a-zA-Z0-9_.]+)\s+import/gm;

export interface PythonImportInfo {
  source: string;
  isRelative: boolean;
}

export function parsePythonImports(filePath: string): PythonImportInfo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const imports: PythonImportInfo[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const source = match[1];
    if (!seen.has(source)) {
      seen.add(source);
      imports.push({ source, isRelative: false });
    }
  }

  for (const match of content.matchAll(FROM_IMPORT_PATTERN)) {
    const source = match[1];
    if (!seen.has(source)) {
      seen.add(source);
      imports.push({ source, isRelative: source.startsWith(".") });
    }
  }

  return imports;
}
