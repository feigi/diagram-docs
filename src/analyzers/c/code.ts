import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type TreeSitter from "web-tree-sitter";
import { runQuery } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember } from "../types.js";

type SyntaxNode = TreeSitter.SyntaxNode;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuery: string | null = null;
async function getQuery(): Promise<string> {
  if (cachedQuery) return cachedQuery;
  cachedQuery = await fs.readFile(
    path.join(__dirname, "queries", "code.scm"),
    "utf-8",
  );
  return cachedQuery;
}

export async function extractCCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("c", source, query);

  const seen = new Map<string, RawCodeElement>();
  for (const m of matches) {
    const structDecl = m.captures.find((c) => c.name === "struct.decl");
    const typedefDecl = m.captures.find((c) => c.name === "typedef.decl");
    const fnDef = m.captures.find((c) => c.name === "fn.decl");
    const fnPrototype = m.captures.find((c) => c.name === "decl.fn");

    if (structDecl) {
      const nameCap = m.captures.find((c) => c.name === "struct.name")!;
      const name = nameCap.node.text;
      if (seen.has(name)) continue;
      seen.set(name, {
        id: name,
        name,
        kind: "struct",
        visibility: "public",
        members: collectStructFields(structDecl.node),
        location: {
          file: filePath,
          line: structDecl.node.startPosition.row + 1,
        },
      });
    } else if (typedefDecl) {
      const name = m.captures.find((c) => c.name === "typedef.name")!.node.text;
      if (seen.has(name)) continue;
      seen.set(name, {
        id: name,
        name,
        kind: "typedef",
        visibility: "public",
        location: {
          file: filePath,
          line: typedefDecl.node.startPosition.row + 1,
        },
      });
    } else if (fnDef) {
      const name = m.captures.find((c) => c.name === "fn.name")!.node.text;
      const storageCap = m.captures.find((c) => c.name === "fn.storage");
      const isStatic = storageCap?.node.text === "static";
      const existing = seen.get(name);
      if (!existing || (existing.visibility === "public" && isStatic)) {
        seen.set(name, {
          id: name,
          name,
          kind: "function",
          visibility: isStatic ? "private" : "public",
          location: {
            file: filePath,
            line: fnDef.node.startPosition.row + 1,
          },
        });
      }
    } else if (fnPrototype) {
      const name = m.captures.find((c) => c.name === "decl.name")!.node.text;
      if (!seen.has(name)) {
        seen.set(name, {
          id: name,
          name,
          kind: "function",
          visibility: "public",
          location: {
            file: filePath,
            line: fnPrototype.node.startPosition.row + 1,
          },
        });
      }
    }
  }

  return Array.from(seen.values());
}

function collectStructFields(structNode: SyntaxNode): CodeMember[] {
  const body = structNode.childForFieldName("body");
  if (!body) return [];
  const members: CodeMember[] = [];
  for (const child of body.namedChildren) {
    if (child.type !== "field_declaration") continue;
    const declarator = child.childForFieldName("declarator");
    const name = declarator?.text?.replace(/^\*+/, "") ?? "?";
    const type = child.childForFieldName("type")?.text ?? "?";
    members.push({ name, kind: "field", signature: `${name}: ${type}` });
  }
  return members;
}
