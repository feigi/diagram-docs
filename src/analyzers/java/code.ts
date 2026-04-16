import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type TreeSitter from "web-tree-sitter";
import { runQuery, createQueryLoader } from "../tree-sitter.js";
import type {
  RawCodeElement,
  CodeMember,
  RawCodeReference,
  CodeElementKind,
} from "../types.js";

type SyntaxNode = TreeSitter.SyntaxNode;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const getQuery = createQueryLoader(path.join(__dirname, "queries", "code.scm"));

export async function extractJavaCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  const matches = await runQuery("java", source, query);

  const byDecl = new Map<
    number,
    { kind: CodeElementKind; captures: (typeof matches)[0]["captures"] }
  >();

  for (const m of matches) {
    const decl = m.captures.find(
      (c) =>
        c.name === "class.decl" ||
        c.name === "interface.decl" ||
        c.name === "enum.decl",
    );
    if (!decl) continue;
    const kind: CodeElementKind =
      decl.name === "class.decl"
        ? "class"
        : decl.name === "interface.decl"
          ? "interface"
          : "enum";
    byDecl.set(decl.node.startIndex, { kind, captures: m.captures });
  }

  const elements: RawCodeElement[] = [];
  for (const [, entry] of byDecl) {
    const nameCap = entry.captures.find((c) => c.name.endsWith(".name"));
    if (!nameCap) continue;
    const declCap = entry.captures.find((c) => c.name.endsWith(".decl"))!;
    const id = nameCap.node.text;

    const references = collectReferences(declCap.node, entry.kind);

    const members = collectMembers(declCap.node);
    const element: RawCodeElement = {
      id,
      name: id,
      kind: entry.kind,
      visibility: inferVisibility(declCap.node),
      members: members.length > 0 ? members : undefined,
      references: references.length > 0 ? references : undefined,
      location: {
        file: filePath,
        line: declCap.node.startPosition.row + 1,
      },
    };
    elements.push(element);
  }
  return elements;
}

function typeName(node: SyntaxNode): string | null {
  if (node.type === "type_identifier") return node.text;
  if (node.type === "generic_type") {
    const nameChild =
      node.childForFieldName("name") ??
      (node.namedChildren ?? []).find((c) => c.type === "type_identifier");
    return nameChild?.text ?? null;
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
    const superclass = children.find((c) => c.type === "superclass");
    if (superclass) {
      for (const child of superclass.namedChildren ?? []) {
        const name = typeName(child);
        if (name) {
          references.push({ targetName: name, kind: "extends" });
          break;
        }
      }
    }
    const superInterfaces = children.find((c) => c.type === "super_interfaces");
    if (superInterfaces) {
      const typeList = (superInterfaces.namedChildren ?? []).find(
        (c) => c.type === "type_list",
      );
      if (typeList) {
        for (const child of typeList.namedChildren ?? []) {
          const name = typeName(child);
          if (name) {
            references.push({ targetName: name, kind: "implements" });
          }
        }
      }
    }
  } else if (elementKind === "interface") {
    const extendsInterfaces = children.find(
      (c) => c.type === "extends_interfaces",
    );
    if (extendsInterfaces) {
      const typeList = (extendsInterfaces.namedChildren ?? []).find(
        (c) => c.type === "type_list",
      );
      if (typeList) {
        for (const child of typeList.namedChildren ?? []) {
          const name = typeName(child);
          if (name) {
            references.push({ targetName: name, kind: "extends" });
          }
        }
      }
    }
  }

  return references;
}

function collectMembers(declNode: SyntaxNode): CodeMember[] {
  const members: CodeMember[] = [];
  for (const child of declNode.namedChildren ?? []) {
    if (child.type === "class_body" || child.type === "interface_body") {
      for (const bodyChild of child.namedChildren ?? []) {
        if (bodyChild.type === "method_declaration") {
          const name = bodyChild.childForFieldName("name")?.text ?? "?";
          const params =
            bodyChild.childForFieldName("parameters")?.text ?? "()";
          const ret = bodyChild.childForFieldName("type")?.text ?? "void";
          members.push({
            name,
            kind: "method",
            signature: `${name}${params}: ${ret}`,
            visibility: inferVisibility(bodyChild),
          });
        } else if (bodyChild.type === "field_declaration") {
          const declarator = bodyChild.childForFieldName("declarator");
          const fieldName = declarator?.childForFieldName("name")?.text ?? "?";
          const type = bodyChild.childForFieldName("type")?.text ?? "?";
          members.push({
            name: fieldName,
            kind: "field",
            signature: `${fieldName}: ${type}`,
            visibility: inferVisibility(bodyChild),
          });
        }
      }
    }
  }
  return members;
}

function inferVisibility(node: SyntaxNode): "public" | "internal" | "private" {
  const modText =
    (node.namedChildren ?? []).find((c) => c.type === "modifiers")?.text ?? "";
  if (modText.includes("public")) return "public";
  if (modText.includes("private")) return "private";
  return "internal";
}
