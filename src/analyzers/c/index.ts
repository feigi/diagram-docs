import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LanguageAnalyzer,
  ScanConfig,
  ScannedApplication,
  ScannedModule,
  ModuleImport,
} from "../types.js";
import { extractCodeElementsForFiles } from "../tree-sitter.js";
import { slugify, slugifyPath } from "../../core/slugify.js";
import { parseCIncludes } from "./includes.js";
import { extractCStructure } from "./structure.js";
import { extractCCode } from "./code.js";

export const cAnalyzer: LanguageAnalyzer = {
  id: "c",
  name: "C",
  buildFilePatterns: ["CMakeLists.txt", "Makefile"],
  defaultExcludes: [],

  async analyze(
    appPath: string,
    config: ScanConfig,
  ): Promise<ScannedApplication> {
    const appId = slugifyPath(appPath);
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
        let includes: ReturnType<typeof parseCIncludes>;
        try {
          includes = parseCIncludes(fullPath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "EACCES") {
            process.stderr.write(
              `Warning: source file not readable during C scan, skipping: ${fullPath}\n`,
            );
            continue;
          }
          throw err;
        }
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

      const module: ScannedModule = {
        id: slugify(`${appPath}/${group.path}`),
        path: group.path,
        name: group.name,
        files: allFiles,
        exports,
        imports: deduplicateImports(imports),
        metadata: {},
      };

      if (config.levels?.code) {
        const filePaths = module.files
          .filter((f) => f.endsWith(".c") || f.endsWith(".h"))
          .map((f) => path.join(appPath, f));
        const allElements = await extractCodeElementsForFiles(
          filePaths,
          extractCCode,
        );
        // Dedupe by name for public symbols (collapse .h prototype + .c
        // definition). For static (file-scope) symbols, key by file+name so
        // distinct statics in different .c files are preserved. Definitions
        // from .c files win over .h prototypes for location accuracy.
        const dedup = new Map<string, (typeof allElements)[number]>();
        for (const el of allElements) {
          const isStatic = el.visibility === "private";
          const key = isStatic ? `${el.location.file}::${el.name}` : el.name;
          const existing = dedup.get(key);
          if (!existing) {
            dedup.set(key, el);
            continue;
          }
          if (
            el.location.file.endsWith(".c") &&
            existing.location.file.endsWith(".h")
          ) {
            dedup.set(key, el);
          }
        }
        if (dedup.size > 0) module.codeElements = Array.from(dedup.values());
      }

      modules.push(module);
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
