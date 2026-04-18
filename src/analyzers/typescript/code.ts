import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type TreeSitter from "web-tree-sitter";
import { runQueryScoped, createQueryLoader } from "../tree-sitter.js";
import type {
  RawCodeElement,
  CodeMember,
  RawCodeReference,
  CodeElementKind,
} from "../types.js";

type SyntaxNode = TreeSitter.SyntaxNode;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const getQuery = createQueryLoader(path.join(__dirname, "queries", "code.scm"));

const KIND_BY_DECL: Record<string, CodeElementKind> = {
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
  return runQueryScoped("typescript", source, query, (matches) => {
    const byDecl = new Map<
      number,
      { kind: CodeElementKind; declNode: SyntaxNode; nameNode: SyntaxNode }
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
      const location = {
        file: filePath,
        line: entry.declNode.startPosition.row + 1,
      };
      const refs = references.length > 0 ? references : undefined;

      // Discriminated emission: class/interface are container kinds (they
      // carry a body of members); type/function are symbol kinds (no members
      // in the model — a type alias has no fields, a top-level function has
      // no inner body we render). `members: []` on symbol kinds was always
      // dead weight — the discriminated union now rules the shape out.
      if (entry.kind === "class" || entry.kind === "interface") {
        const members = collectMembers(entry.declNode);
        elements.push({
          id,
          name: id,
          kind: entry.kind,
          visibility: "public",
          members: members.length > 0 ? members : undefined,
          references: refs,
          location,
        });
      } else {
        elements.push({
          id,
          name: id,
          kind: entry.kind,
          visibility: "public",
          references: refs,
          location,
        });
      }
    }
    return elements;
  });
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
      const name = child.childForFieldName("name")?.text;
      if (!name) continue;
      const params = child.childForFieldName("parameters")?.text ?? "()";
      const ret = child.childForFieldName("return_type")?.text ?? "";
      // TypeScript constructor shorthand: `constructor(private readonly x: T)`
      // declares `x` as a field. Emit each shorthand parameter as its own
      // field member so L4 diagrams see the state. The constructor method
      // itself is still emitted below (fall through).
      if (name === "constructor") {
        const paramsNode = child.childForFieldName("parameters");
        for (const p of paramsNode?.namedChildren ?? []) {
          if (p.type !== "required_parameter") continue;
          const mod = (p.namedChildren ?? []).find(
            (c) => c.type === "accessibility_modifier",
          );
          if (!mod) continue; // plain param, not a shorthand field
          const idNode = (p.namedChildren ?? []).find(
            (c) => c.type === "identifier",
          );
          if (!idNode) continue;
          const typeAnn = (p.namedChildren ?? []).find(
            (c) => c.type === "type_annotation",
          );
          members.push({
            name: idNode.text,
            kind: "field",
            signature: typeAnn ? `${idNode.text}${typeAnn.text}` : idNode.text,
            visibility:
              mod.text === "private"
                ? "private"
                : mod.text === "protected"
                  ? "internal"
                  : "public",
          });
        }
      }
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
      const name = child.childForFieldName("name")?.text;
      if (!name) continue;
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
