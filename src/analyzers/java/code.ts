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

// java.lang is implicitly imported and those types are out-of-project anyway.
// Primitives should never appear as type_identifier (tree-sitter tags them as
// integral_type/floating_point_type/etc.) but we list them defensively in case
// a grammar edge case leaks a bare identifier through.
const JAVA_LANG_BUILTINS = new Set([
  "String",
  "Object",
  "Integer",
  "Long",
  "Short",
  "Byte",
  "Boolean",
  "Character",
  "Float",
  "Double",
  "Number",
  "Void",
  "Class",
  "Enum",
  "Throwable",
  "Exception",
  "RuntimeException",
  "Error",
  "Thread",
  "Runnable",
  "System",
  "Math",
  "Iterable",
  "Comparable",
  "CharSequence",
  "StringBuilder",
  "StringBuffer",
  "int",
  "long",
  "short",
  "byte",
  "boolean",
  "char",
  "float",
  "double",
  "void",
]);

export async function extractJavaCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  return runQueryScoped("java", source, query, (matches, tree) => {
    const fileCtx = extractFileContext(tree.rootNode);

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

      const references = collectReferences(declCap.node, entry.kind, fileCtx);

      const members = collectMembers(declCap.node);
      const element: RawCodeElement = {
        id,
        name: id,
        kind: entry.kind,
        qualifiedName: fileCtx.packageName
          ? `${fileCtx.packageName}.${id}`
          : undefined,
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
  });
}

interface JavaFileContext {
  /** Package declared by the source file, e.g. `com.example.foo`. Empty if unset (default package). */
  packageName: string;
  /** Map from simple type name to FQN, populated from non-static, non-wildcard imports. */
  importMap: Map<string, string>;
}

function extractFileContext(root: SyntaxNode): JavaFileContext {
  let packageName = "";
  const importMap = new Map<string, string>();
  for (const child of root.namedChildren ?? []) {
    if (child.type === "package_declaration") {
      const ident = (child.namedChildren ?? []).find(
        (c) => c.type === "scoped_identifier" || c.type === "identifier",
      );
      if (ident) packageName = ident.text;
    } else if (child.type === "import_declaration") {
      // Skip `import static …` and `import …*` — neither maps a single
      // simple name to a single FQN.
      const text = child.text;
      if (text.includes(" static ")) continue;
      const ident = (child.namedChildren ?? []).find(
        (c) => c.type === "scoped_identifier" || c.type === "identifier",
      );
      if (!ident) continue;
      const isWildcard = (child.namedChildren ?? []).some(
        (c) => c.type === "asterisk",
      );
      if (isWildcard) continue;
      const fqn = ident.text;
      const lastDot = fqn.lastIndexOf(".");
      const simple = lastDot >= 0 ? fqn.slice(lastDot + 1) : fqn;
      importMap.set(simple, fqn);
    }
  }
  return { packageName, importMap };
}

function resolveTargetFqn(
  simple: string,
  ctx: JavaFileContext,
): string | undefined {
  const imported = ctx.importMap.get(simple);
  if (imported) return imported;
  // Java rule: unqualified, unimported types resolve to the file's own
  // package (java.lang is always implicitly imported but those types are
  // out-of-project anyway).
  if (ctx.packageName) return `${ctx.packageName}.${simple}`;
  return undefined;
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
  fileCtx: JavaFileContext,
): RawCodeReference[] {
  const references: RawCodeReference[] = [];
  const children = declNode.namedChildren ?? [];

  const push = (name: string, kind: RawCodeReference["kind"]) => {
    const fqn = resolveTargetFqn(name, fileCtx);
    references.push({
      targetName: name,
      ...(fqn ? { targetQualifiedName: fqn } : {}),
      kind,
    });
  };

  if (elementKind === "class") {
    const superclass = children.find((c) => c.type === "superclass");
    if (superclass) {
      for (const child of superclass.namedChildren ?? []) {
        const name = typeName(child);
        if (name) {
          push(name, "extends");
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
          if (name) push(name, "implements");
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
          if (name) push(name, "extends");
        }
      }
    }
  }

  if (elementKind === "class" || elementKind === "interface") {
    const seen = new Set(references.map((r) => r.targetName));
    for (const name of collectBodyTypeNames(declNode)) {
      if (JAVA_LANG_BUILTINS.has(name) || seen.has(name)) continue;
      seen.add(name);
      push(name, "uses");
    }
  }

  return references;
}

// Collects type names referenced in field, method-parameter, method-return,
// and constructor-parameter positions within a class/interface body. Call-site
// and local-variable references are skipped to keep L4 diagrams focused on
// structural dependencies.
function collectBodyTypeNames(declNode: SyntaxNode): string[] {
  const out: string[] = [];
  for (const child of declNode.namedChildren ?? []) {
    if (child.type !== "class_body" && child.type !== "interface_body") {
      continue;
    }
    for (const bodyChild of child.namedChildren ?? []) {
      if (
        bodyChild.type === "field_declaration" ||
        bodyChild.type === "constant_declaration"
      ) {
        out.push(...collectJavaTypeNames(bodyChild.childForFieldName("type")));
      } else if (
        bodyChild.type === "method_declaration" ||
        bodyChild.type === "constructor_declaration"
      ) {
        if (bodyChild.type === "method_declaration") {
          out.push(
            ...collectJavaTypeNames(bodyChild.childForFieldName("type")),
          );
        }
        const params = bodyChild.childForFieldName("parameters");
        if (params) {
          for (const p of params.namedChildren ?? []) {
            if (p.type !== "formal_parameter" && p.type !== "spread_parameter")
              continue;
            out.push(...collectJavaTypeNames(p.childForFieldName("type")));
          }
        }
      }
    }
  }
  return out;
}

function collectJavaTypeNames(node: SyntaxNode | null): string[] {
  if (!node) return [];
  if (node.type === "type_identifier") return [node.text];
  if (node.type === "generic_type") {
    const out: string[] = [];
    const base =
      node.childForFieldName("name") ??
      (node.namedChildren ?? []).find(
        (c) =>
          c.type === "type_identifier" || c.type === "scoped_type_identifier",
      );
    if (base) out.push(...collectJavaTypeNames(base));
    const args = (node.namedChildren ?? []).find(
      (c) => c.type === "type_arguments",
    );
    if (args) {
      for (const arg of args.namedChildren ?? []) {
        out.push(...collectJavaTypeNames(arg));
      }
    }
    return out;
  }
  if (node.type === "array_type") {
    const el =
      node.childForFieldName("element") ?? (node.namedChildren ?? [])[0];
    return el ? collectJavaTypeNames(el) : [];
  }
  if (node.type === "scoped_type_identifier") {
    const idents = (node.namedChildren ?? []).filter(
      (c) => c.type === "type_identifier",
    );
    return idents.length > 0 ? [idents[idents.length - 1].text] : [];
  }
  if (node.type === "wildcard") {
    const out: string[] = [];
    for (const c of node.namedChildren ?? []) {
      out.push(...collectJavaTypeNames(c));
    }
    return out;
  }
  return [];
}

function collectMembers(declNode: SyntaxNode): CodeMember[] {
  const members: CodeMember[] = [];
  for (const child of declNode.namedChildren ?? []) {
    if (child.type === "class_body" || child.type === "interface_body") {
      for (const bodyChild of child.namedChildren ?? []) {
        if (bodyChild.type === "method_declaration") {
          const name = bodyChild.childForFieldName("name")?.text;
          if (!name) continue;
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
          const fieldName = declarator?.childForFieldName("name")?.text;
          if (!fieldName) continue;
          const type = bodyChild.childForFieldName("type")?.text;
          members.push({
            name: fieldName,
            kind: "field",
            signature: type ? `${fieldName}: ${type}` : fieldName,
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
