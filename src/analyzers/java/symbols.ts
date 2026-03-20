import type { ModuleSymbols, CodeSymbol, SymbolRelationship } from "../types.js";
import { slugify } from "../../core/slugify.js";

/**
 * Extract Java symbols (classes, interfaces, enums, records) and their
 * relationships from a set of Java source files.
 */
export function extractJavaSymbols(
  files: Array<{ path: string; content: string }>,
): ModuleSymbols {
  const symbols: CodeSymbol[] = [];
  const relationships: SymbolRelationship[] = [];

  // Regex matches: optional "public" modifier, then class/interface/enum/record keyword, then name,
  // optional extends/implements clauses.
  const declarationRe =
    /(?:^|\n)\s*(public\s+)?(?:abstract\s+)?(?:final\s+)?(class|interface|enum|record)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;

  // Field pattern: visibility + optional modifiers + TypeName + fieldName
  const fieldRe =
    /(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?(\w+)\s+\w+\s*[;=]/g;

  // First pass: extract all symbol declarations
  for (const file of files) {
    let match: RegExpExecArray | null;
    declarationRe.lastIndex = 0;

    while ((match = declarationRe.exec(file.content)) !== null) {
      const isPublic = !!match[1];
      const kindRaw = match[2] as "class" | "interface" | "enum" | "record";
      const name = match[3];
      const extendsName = match[4];
      const implementsList = match[5];

      // Records map to "class" kind since CodeSymbol doesn't have a "record" kind
      const kind: CodeSymbol["kind"] = kindRaw === "record" ? "class" : kindRaw;

      const id = slugify(name);

      if (symbols.some((s) => s.id === id)) continue;

      symbols.push({
        id,
        name,
        kind,
        visibility: isPublic ? "public" : "private",
      });

      // Track extends relationship (resolved later against known symbols)
      if (extendsName) {
        relationships.push({
          sourceId: id,
          targetId: slugify(extendsName),
          kind: "extends",
        });
      }

      // Track implements relationships
      if (implementsList) {
        const interfaces = implementsList.split(",").map((s) => s.trim());
        for (const iface of interfaces) {
          if (iface) {
            relationships.push({
              sourceId: id,
              targetId: slugify(iface),
              kind: "implements",
            });
          }
        }
      }
    }
  }

  // Build a set of known symbol IDs for filtering relationships
  const knownIds = new Set(symbols.map((s) => s.id));

  // Second pass: extract field-type relationships
  for (const file of files) {
    // Determine which symbols are declared in this file so we can attribute fields
    const fileSymbolIds: string[] = [];
    declarationRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = declarationRe.exec(file.content)) !== null) {
      fileSymbolIds.push(slugify(match[3]));
    }

    if (fileSymbolIds.length === 0) continue;

    // Use the first (outermost) symbol as the owner of fields
    const ownerId = fileSymbolIds[0];

    fieldRe.lastIndex = 0;
    while ((match = fieldRe.exec(file.content)) !== null) {
      const typeName = match[1];
      const typeId = slugify(typeName);
      if (knownIds.has(typeId) && typeId !== ownerId) {
        // Avoid duplicate field-type relationships
        const alreadyExists = relationships.some(
          (r) =>
            r.kind === "field-type" &&
            r.sourceId === ownerId &&
            r.targetId === typeId,
        );
        if (!alreadyExists) {
          relationships.push({
            sourceId: ownerId,
            targetId: typeId,
            kind: "field-type",
          });
        }
      }
    }
  }

  // Filter relationships to only reference known symbols
  const filteredRelationships = relationships.filter(
    (r) => knownIds.has(r.sourceId) && knownIds.has(r.targetId),
  );

  return { symbols, relationships: filteredRelationships };
}
