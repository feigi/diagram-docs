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

const KIND_BY_DECL: Record<string, string> = {
  "class.decl": "class",
  "interface.decl": "interface",
  "type.decl": "type",
  "fn.decl": "function",
};

export async function extractTypeScriptCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("typescript", source, query);

  const byDecl = new Map<
    number,
    { kind: string; declNode: SyntaxNode; nameNode: SyntaxNode }
  >();

  for (const m of matches) {
    const decl = m.captures.find((c) => c.name.endsWith(".decl"));
    const nameCap = m.captures.find((c) => c.name.endsWith(".name"));
    if (!decl || !nameCap) continue;
    const kind = KIND_BY_DECL[decl.name];
    if (!kind) continue;
    byDecl.set(decl.node.startIndex, {
      kind,
      declNode: decl.node,
      nameNode: nameCap.node,
    });
  }

  const elements: RawCodeElement[] = [];
  for (const [, entry] of byDecl) {
    const id = entry.nameNode.text;
    const references = collectReferences(entry.declNode, entry.kind);
    const members =
      entry.kind === "class" || entry.kind === "interface"
        ? collectMembers(entry.declNode)
        : [];

    elements.push({
      id,
      name: id,
      kind: entry.kind,
      visibility: "public",
      members: members.length > 0 ? members : undefined,
      references: references.length > 0 ? references : undefined,
      location: {
        file: filePath,
        line: entry.declNode.startPosition.row + 1,
      },
    });
  }
  return elements;
}

function typeName(node: SyntaxNode): string | null {
  if (node.type === "type_identifier" || node.type === "identifier") {
    return node.text;
  }
  if (node.type === "generic_type") {
    const nameChild =
      node.childForFieldName("name") ??
      (node.namedChildren ?? []).find(
        (c) => c.type === "type_identifier" || c.type === "identifier",
      );
    return nameChild?.text ?? null;
  }
  if (node.type === "nested_type_identifier") {
    // Walk to the rightmost type_identifier (e.g. ns.Foo → Foo)
    const idents = (node.namedChildren ?? []).filter(
      (c) => c.type === "type_identifier",
    );
    return idents.length > 0 ? idents[idents.length - 1].text : null;
  }
  return null;
}

function collectReferences(
  declNode: SyntaxNode,
  elementKind: string,
): RawCodeReference[] {
  const references: RawCodeReference[] = [];
  const children = declNode.namedChildren ?? [];

  if (elementKind === "class") {
    const heritage = children.find((c) => c.type === "class_heritage");
    if (heritage) {
      for (const clause of heritage.namedChildren ?? []) {
        if (clause.type === "extends_clause") {
          for (const t of clause.namedChildren ?? []) {
            const name = typeName(t);
            if (name) references.push({ targetName: name, kind: "extends" });
          }
        } else if (clause.type === "implements_clause") {
          for (const t of clause.namedChildren ?? []) {
            const name = typeName(t);
            if (name) references.push({ targetName: name, kind: "implements" });
          }
        }
      }
    }
  } else if (elementKind === "interface") {
    const extendsClause = children.find(
      (c) => c.type === "extends_type_clause",
    );
    if (extendsClause) {
      for (const t of extendsClause.namedChildren ?? []) {
        const name = typeName(t);
        if (name) references.push({ targetName: name, kind: "extends" });
      }
    }
  }

  return references;
}

function collectMembers(declNode: SyntaxNode): CodeMember[] {
  const members: CodeMember[] = [];
  const body = (declNode.namedChildren ?? []).find(
    (c) =>
      c.type === "class_body" ||
      c.type === "interface_body" ||
      c.type === "object_type",
  );
  if (!body) return members;

  for (const child of body.namedChildren ?? []) {
    if (
      child.type === "method_definition" ||
      child.type === "method_signature"
    ) {
      const name = child.childForFieldName("name")?.text ?? "?";
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const ret = child.childForFieldName("return_type")?.text ?? "";
      members.push({
        name,
        kind: "method",
        signature: `${name}${params}${ret}`,
        visibility: tsVisibility(child),
      });
    } else if (
      child.type === "public_field_definition" ||
      child.type === "property_signature"
    ) {
      const name = child.childForFieldName("name")?.text ?? "?";
      const type = child.childForFieldName("type")?.text ?? "";
      members.push({
        name,
        kind: "field",
        signature: type ? `${name}${type}` : name,
        visibility: tsVisibility(child),
      });
    }
  }
  return members;
}

function tsVisibility(node: SyntaxNode): "public" | "internal" | "private" {
  const modifier = (node.namedChildren ?? []).find(
    (c) => c.type === "accessibility_modifier",
  )?.text;
  if (modifier === "private") return "private";
  if (modifier === "protected") return "internal";
  return "public";
}
