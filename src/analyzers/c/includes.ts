import * as fs from "node:fs";

const INCLUDE_PATTERN = /^#include\s+([<"])([^>"]+)[>"]/gm;

export interface CInclude {
  path: string;
  isSystem: boolean;
}

export function parseCIncludes(filePath: string): CInclude[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const includes: CInclude[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(INCLUDE_PATTERN)) {
    const includePath = match[2];
    if (!seen.has(includePath)) {
      seen.add(includePath);
      includes.push({
        path: includePath,
        isSystem: match[1] === "<",
      });
    }
  }
  return includes;
}
