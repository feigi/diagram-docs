import * as fs from "node:fs";

export interface TypeScriptImportInfo {
  source: string;
  isRelative: boolean;
}

// import ... from "source"  /  import type ... from "source"  (including multi-line)
const STATIC_IMPORT = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/gm;

// import("source")
const DYNAMIC_IMPORT = /import\(\s*["']([^"']+)["']\s*\)/g;

// require("source")
const REQUIRE = /require\(\s*["']([^"']+)["']\s*\)/g;

// export ... from "source"  /  export type ... from "source"
const REEXPORT = /^\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/gm;

export function parseTypeScriptImports(filePath: string): TypeScriptImportInfo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const imports: TypeScriptImportInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, REQUIRE, REEXPORT]) {
    for (const match of content.matchAll(pattern)) {
      const source = match[1];
      if (!seen.has(source)) {
        seen.add(source);
        imports.push({
          source,
          isRelative: source.startsWith("."),
        });
      }
    }
  }

  return imports;
}
