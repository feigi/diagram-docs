import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ModuleImport,
} from "../types.js";
import { slugify } from "../../core/slugify.js";
import { parseCIncludes } from "./includes.js";
import { extractCStructure } from "./structure.js";

export const cAnalyzer: LanguageAnalyzer = {
  id: "c",
  name: "C",
  buildFilePatterns: ["CMakeLists.txt", "Makefile"],
  defaultExcludes: [],

  async analyze(
    appPath: string,
    config: ScanConfig,
  ): Promise<ScannedApplication> {
    const appId = slugify(appPath);
    const appName = path.basename(appPath);

    const groups = await extractCStructure(appPath, config.exclude);

    const allLocalHeaders = new Set<string>();
    for (const group of groups) {
      for (const h of group.headers) {
        allLocalHeaders.add(h);
        allLocalHeaders.add(path.basename(h));
      }
    }

    const modules: ScannedModule[] = [];

    for (const group of groups) {
      const imports: ModuleImport[] = [];
      const allFiles = [...group.headers, ...group.sources];

      for (const file of allFiles) {
        const fullPath = path.join(appPath, file);
        if (!fs.existsSync(fullPath)) continue;

        const includes = parseCIncludes(fullPath);
        for (const inc of includes) {
          const isLocal =
            allLocalHeaders.has(inc.path) ||
            allLocalHeaders.has(path.basename(inc.path));

          imports.push({
            source: inc.path,
            isExternal: inc.isSystem || !isLocal,
          });
        }
      }

      // Public API = header file exported functions (names derived from headers)
      const exports = group.headers.map((h) => path.basename(h, ".h"));

      modules.push({
        id: slugify(`${appPath}/${group.path}`),
        path: group.path,
        name: group.name,
        files: allFiles,
        exports,
        imports: deduplicateImports(imports),
        metadata: {},
      });
    }

    const buildFile = fs.existsSync(path.join(appPath, "CMakeLists.txt"))
      ? "CMakeLists.txt"
      : "Makefile";

    return {
      id: appId,
      path: appPath,
      name: appName,
      language: "c",
      buildFile,
      modules,
      externalDependencies: [],
      internalImports: [],
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
