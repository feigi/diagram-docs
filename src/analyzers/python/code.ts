import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type TreeSitter from "web-tree-sitter";
import { runQuery } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember, RawCodeReference } from "../types.js";

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

export async function extractPythonCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("python", source, query);

  const elements: RawCodeElement[] = [];
  for (const m of matches) {
    const decl = m.captures.find(
      (c) => c.name === "class.decl" || c.name === "fn.decl",
    );
    const nameCap = m.captures.find(
      (c) => c.name === "class.name" || c.name === "fn.name",
    );
    if (!decl || !nameCap) continue;
    const name = nameCap.node.text;
    const kind = decl.name === "class.decl" ? "class" : "function";

    const references = kind === "class" ? collectBaseClasses(decl.node) : [];
    const members = kind === "class" ? collectPythonMembers(decl.node) : [];

    elements.push({
      id: name,
      name,
      kind,
      visibility: name.startsWith("_") ? "private" : "public",
      members: members.length > 0 ? members : undefined,
      references: references.length > 0 ? references : undefined,
      location: { file: filePath, line: decl.node.startPosition.row + 1 },
    });
  }
  return elements;
}

function baseName(node: SyntaxNode): string | null {
  // "Foo" → identifier, "mod.Foo" → attribute, "List[Foo]" → subscript
  if (node.type === "identifier") return node.text;
  if (node.type === "attribute") {
    // Use the rightmost identifier (the attribute name)
    const attr =
      node.childForFieldName("attribute") ?? node.namedChildren.at(-1);
    return attr?.type === "identifier" ? attr.text : null;
  }
  if (node.type === "subscript") {
    const val = node.childForFieldName("value") ?? node.namedChildren[0];
    return val ? baseName(val) : null;
  }
  return null;
}

function collectBaseClasses(classNode: SyntaxNode): RawCodeReference[] {
  const refs: RawCodeReference[] = [];
  const supers = classNode.childForFieldName("superclasses");
  if (!supers) return refs;
  for (const child of supers.namedChildren) {
    const name = baseName(child);
    if (name) refs.push({ targetName: name, kind: "extends" });
  }
  return refs;
}

function collectPythonMembers(classNode: SyntaxNode): CodeMember[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];
  const members: CodeMember[] = [];
  for (const child of body.namedChildren) {
    if (child.type === "function_definition") {
      const name = child.childForFieldName("name")?.text ?? "?";
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const ret = child.childForFieldName("return_type")?.text;
      members.push({
        name,
        kind: "method",
        signature: ret ? `${name}${params} -> ${ret}` : `${name}${params}`,
        visibility: name.startsWith("_") ? "private" : "public",
      });
    }
  }
  return members;
}
