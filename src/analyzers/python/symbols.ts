import type { ModuleSymbols, CodeSymbol, SymbolRelationship } from "../types.js";
import { slugify } from "../../core/slugify.js";

/**
 * Extract Python symbols (classes, top-level functions) and their
 * relationships from a set of Python source files.
 */
export function extractPythonSymbols(
  files: Array<{ path: string; content: string }>,
): ModuleSymbols {
  const symbols: CodeSymbol[] = [];
  const relationships: SymbolRelationship[] = [];

  // Match class declarations: `class Name` or `class Name(Parent, ...):` at zero indentation
  const classRe = /^class\s+(\w+)(?:\(([^)]*)\))?:/gm;

  // Match function declarations with no leading whitespace (assumes standard
  // Python formatting where class methods are indented)
  const funcRe = /^def\s+(\w+)\s*\(/gm;

  for (const file of files) {
    // Extract classes
    classRe.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = classRe.exec(file.content)) !== null) {
      const name = match[1];
      const parentsList = match[2];
      const id = slugify(name);

      if (!symbols.some((s) => s.id === id)) {
        symbols.push({
          id,
          name,
          kind: "class",
          visibility: name.startsWith("_") ? "private" : "public",
        });
      }

      // Track extends relationships for each parent class
      if (parentsList) {
        const parents = parentsList.split(",").map((s) => s.trim()).filter(Boolean);
        for (const parent of parents) {
          // Strip any generic/type params — take only the identifier
          const parentName = parent.split("[")[0].split("(")[0].trim();
          if (parentName) {
            relationships.push({
              sourceId: id,
              targetId: slugify(parentName),
              kind: "extends",
            });
          }
        }
      }
    }

    // Extract top-level functions (zero indentation only)
    funcRe.lastIndex = 0;
    while ((match = funcRe.exec(file.content)) !== null) {
      const name = match[1];

      // Skip private/dunder functions
      if (name.startsWith("_")) continue;

      const id = slugify(name);
      if (!symbols.some((s) => s.id === id)) {
        symbols.push({
          id,
          name,
          kind: "function",
          visibility: "public",
        });
      }
    }
  }

  // Filter relationships to only reference known symbols
  const knownIds = new Set(symbols.map((s) => s.id));
  const filteredRelationships = relationships.filter(
    (r) => knownIds.has(r.sourceId) && knownIds.has(r.targetId),
  );

  return { symbols, relationships: filteredRelationships };
}
