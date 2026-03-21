import type { ModuleSymbols, CodeSymbol, SymbolRelationship } from "../types.js";
import { slugify } from "../../core/slugify.js";

/**
 * Extract C symbols (structs, functions) and their relationships
 * from a set of C header/source files.
 */
export function extractCSymbols(
  files: Array<{ path: string; content: string }>,
): ModuleSymbols {
  const symbols: CodeSymbol[] = [];
  const relationships: SymbolRelationship[] = [];

  // Match typedef struct declarations: `typedef struct { ... } Name;`
  // Also handles `typedef struct Name { ... } Name;`
  // Note: does not handle nested structs or braces within the body due to
  // the [^}]* pattern.
  const structRe = /typedef\s+struct\s*(?:\w+\s*)?\{[^}]*\}\s*(\w+)\s*;/g;

  // Match function declarations (prototypes ending in ';') with a single-word
  // return type.  Supports common qualifiers (const, static, extern, inline,
  // unsigned, signed, long, short).  Pointer returns only match when '*' is
  // adjacent to the type name (e.g. `int* foo`), not the function name
  // (e.g. `int *foo`).  Qualifiers like `unsigned` are consumed separately,
  // so `unsigned int foo(...)` matches with `int` captured as the return type.
  // Does not handle multi-word return types like `struct Foo*`.
  const funcDeclRe =
    /^[ \t]*(?:(?:const|static|extern|inline|unsigned|signed|long|short)\s+)*(\w+)\s*\*?\s+(\w+)\s*\(([^)]*)\)\s*;/gm;

  // First pass: extract struct declarations
  for (const file of files) {
    structRe.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = structRe.exec(file.content)) !== null) {
      const name = match[1];
      const id = slugify(name);

      // Avoid duplicates
      if (!symbols.some((s) => s.id === id)) {
        symbols.push({
          id,
          name,
          kind: "struct",
          visibility: "public",
        });
      }
    }
  }

  // Build a set of known struct names for relationship detection
  const knownStructs = new Map(
    symbols.filter((s) => s.kind === "struct").map((s) => [s.name, s.id]),
  );

  // Second pass: extract function declarations
  for (const file of files) {
    funcDeclRe.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = funcDeclRe.exec(file.content)) !== null) {
      const returnType = match[1];
      const funcName = match[2];
      const params = match[3];

      const funcId = slugify(funcName);

      // Skip if this looks like a struct name we already captured
      if (knownStructs.has(funcName)) continue;

      // Avoid duplicates
      if (!symbols.some((s) => s.id === funcId)) {
        symbols.push({
          id: funcId,
          name: funcName,
          kind: "function",
          visibility: "public",
        });
      }

      // Check return-type relationship (deduplicate for .h/.c pairs)
      if (knownStructs.has(returnType)) {
        const alreadyExists = relationships.some(
          (r) =>
            r.kind === "return-type" &&
            r.sourceId === funcId &&
            r.targetId === knownStructs.get(returnType),
        );
        if (!alreadyExists) {
          relationships.push({
            sourceId: funcId,
            targetId: knownStructs.get(returnType)!,
            kind: "return-type",
          });
        }
      }

      // Check param-type relationships
      if (params.trim()) {
        // Split params by comma, then look for known struct types
        const paramList = params.split(",");
        for (const param of paramList) {
          const trimmed = param.trim();
          // Extract the type name from the parameter, stripping const, *, etc.
          // Patterns like: `const Order* order`, `Order *order`, `Order order`
          const paramTypeMatch = trimmed.match(
            /(?:const\s+)?(\w+)\s*\*?\s*\w+$/,
          );
          if (paramTypeMatch) {
            const paramType = paramTypeMatch[1];
            if (knownStructs.has(paramType)) {
              // Avoid duplicate param-type relationships
              const alreadyExists = relationships.some(
                (r) =>
                  r.kind === "param-type" &&
                  r.sourceId === funcId &&
                  r.targetId === knownStructs.get(paramType),
              );
              if (!alreadyExists) {
                relationships.push({
                  sourceId: funcId,
                  targetId: knownStructs.get(paramType)!,
                  kind: "param-type",
                });
              }
            }
          }
        }
      }
    }
  }

  // Build known IDs set for filtering
  const knownIds = new Set(symbols.map((s) => s.id));

  // Filter relationships to only reference known symbols
  const filteredRelationships = relationships.filter(
    (r) => knownIds.has(r.sourceId) && knownIds.has(r.targetId),
  );

  return { symbols, relationships: filteredRelationships };
}
