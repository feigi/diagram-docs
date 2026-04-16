import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type TreeSitter from "web-tree-sitter";
import {
  runQueryScoped,
  createQueryLoader,
  type QueryMatch,
} from "../tree-sitter.js";
import type { RawCodeElement, CodeMember, RawCodeReference } from "../types.js";

type SyntaxNode = TreeSitter.SyntaxNode;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const getQuery = createQueryLoader(path.join(__dirname, "queries", "code.scm"));

/** Builtin/stdlib type names we suppress when emitting references. */
const BUILTIN_TYPES = new Set([
  "void",
  "char",
  "short",
  "int",
  "long",
  "float",
  "double",
  "signed",
  "unsigned",
  "size_t",
  "ssize_t",
  "ptrdiff_t",
  "intptr_t",
  "uintptr_t",
  "int8_t",
  "int16_t",
  "int32_t",
  "int64_t",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "uint64_t",
  "bool",
  "_Bool",
  "FILE",
  "wchar_t",
  "time_t",
  "clock_t",
  "off_t",
]);

export async function extractCCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  return runQueryScoped("c", source, query, (matches) =>
    extractFromMatches(filePath, matches),
  );
}

function extractFromMatches(
  filePath: string,
  matches: QueryMatch[],
): RawCodeElement[] {
  const seen = new Map<string, RawCodeElement>();
  const definedNames = new Set<string>();
  for (const m of matches) {
    const structDecl = m.captures.find((c) => c.name === "struct.decl");
    const typedefDecl = m.captures.find((c) => c.name === "typedef.decl");
    const fnDef = m.captures.find((c) => c.name === "fn.decl");
    const fnPrototype = m.captures.find((c) => c.name === "decl.fn");

    if (structDecl) {
      const nameCap = m.captures.find((c) => c.name === "struct.name")!;
      const name = nameCap.node.text;
      if (seen.has(name)) continue;
      const { members, references } = collectStructBody(structDecl.node);
      seen.set(name, {
        id: name,
        name,
        kind: "struct",
        visibility: "public",
        members,
        references: references.length > 0 ? references : undefined,
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
    } else if (fnDef || fnPrototype) {
      const node = (fnDef ?? fnPrototype)!.node;
      const name = findFunctionNameInDeclarator(
        node.childForFieldName("declarator"),
      );
      if (!name) continue;
      const isStatic = hasStaticStorage(node);
      const references = collectFunctionReferences(node);
      const existing = seen.get(name);
      const newIsDef = Boolean(fnDef);
      // Resolution rules (each row assumes replacement only when it fires):
      //   1. First sighting: always accept.
      //   2. Existing came from a prototype, new is a definition: promote so
      //      location points at the real definition.
      //   3. New is a static definition and existing is public: narrow
      //      visibility. Never widen private → public.
      const replace =
        !existing ||
        (newIsDef && !definedNames.has(name)) ||
        (newIsDef && existing.visibility === "public" && isStatic);
      if (replace) {
        seen.set(name, {
          id: name,
          name,
          kind: "function",
          visibility: isStatic ? "private" : "public",
          references: references.length > 0 ? references : undefined,
          location: {
            file: filePath,
            line: node.startPosition.row + 1,
          },
        });
        if (newIsDef) definedNames.add(name);
      }
    }
  }

  return Array.from(seen.values());
}

interface StructBody {
  members: CodeMember[];
  references: RawCodeReference[];
}

function collectStructBody(structNode: SyntaxNode): StructBody {
  const body = structNode.childForFieldName("body");
  if (!body) return { members: [], references: [] };
  const members: CodeMember[] = [];
  const references: RawCodeReference[] = [];
  const refSeen = new Set<string>();
  for (const child of body.namedChildren) {
    if (child.type !== "field_declaration") continue;
    const declaratorNode = child.childForFieldName("declarator");
    const name = fieldName(declaratorNode);
    if (!name) continue;
    const typeNode = child.childForFieldName("type");
    const signature = typeNode?.text ? `${name}: ${typeNode.text}` : name;
    members.push({ name, kind: "field", signature });

    const refName = typeNameFromNode(typeNode);
    if (refName && !BUILTIN_TYPES.has(refName) && !refSeen.has(refName)) {
      refSeen.add(refName);
      references.push({ targetName: refName, kind: "contains" });
    }
  }
  return { members, references };
}

function fieldName(node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "field_identifier" || node.type === "identifier") {
    return node.text;
  }
  const inner = node.childForFieldName("declarator");
  if (inner) return fieldName(inner);
  for (const child of node.namedChildren ?? []) {
    const recovered = fieldName(child);
    if (recovered) return recovered;
  }
  return null;
}

function findFunctionNameInDeclarator(node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "function_declarator") {
    const inner = node.childForFieldName("declarator");
    if (!inner) return null;
    if (inner.type === "identifier") return inner.text;
    return findFunctionNameInDeclarator(inner);
  }
  if (
    node.type === "pointer_declarator" ||
    node.type === "parenthesized_declarator"
  ) {
    return findFunctionNameInDeclarator(node.childForFieldName("declarator"));
  }
  // parenthesized_declarator may not expose a field-named child on some grammar
  // versions; fall back to scanning children.
  for (const child of node.namedChildren ?? []) {
    const found = findFunctionNameInDeclarator(child);
    if (found) return found;
  }
  return null;
}

function findFunctionDeclarator(node: SyntaxNode | null): SyntaxNode | null {
  if (!node) return null;
  if (node.type === "function_declarator") return node;
  if (
    node.type === "pointer_declarator" ||
    node.type === "parenthesized_declarator"
  ) {
    return findFunctionDeclarator(node.childForFieldName("declarator"));
  }
  for (const child of node.namedChildren ?? []) {
    const found = findFunctionDeclarator(child);
    if (found) return found;
  }
  return null;
}

function hasStaticStorage(node: SyntaxNode): boolean {
  for (const child of node.namedChildren ?? []) {
    if (child.type === "storage_class_specifier" && child.text === "static") {
      return true;
    }
  }
  return false;
}

// Returns the identifier text for a type node. For primitives / sized ints,
// returns the primitive name (callers filter via BUILTIN_TYPES). For
// struct/union specifiers, returns the tag. Null when no identifier is present.
function typeNameFromNode(node: SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "type_identifier") return node.text;
  if (node.type === "primitive_type") return node.text;
  if (node.type === "sized_type_specifier") {
    // e.g. `unsigned int` - return the primitive child if any
    for (const child of node.namedChildren ?? []) {
      if (child.type === "primitive_type") return child.text;
    }
    return null;
  }
  if (node.type === "struct_specifier" || node.type === "union_specifier") {
    const nameChild = node.childForFieldName("name");
    return nameChild?.type === "type_identifier" ? nameChild.text : null;
  }
  // type_descriptor (used inside type_qualified expressions) wraps a type field.
  const typeField = node.childForFieldName("type");
  if (typeField) return typeNameFromNode(typeField);
  return null;
}

function collectFunctionReferences(fnNode: SyntaxNode): RawCodeReference[] {
  const refs: RawCodeReference[] = [];
  const seen = new Set<string>();
  const push = (name: string | null) => {
    if (!name || BUILTIN_TYPES.has(name) || seen.has(name)) return;
    seen.add(name);
    refs.push({ targetName: name, kind: "uses" });
  };

  push(typeNameFromNode(fnNode.childForFieldName("type")));

  const fnDeclarator = findFunctionDeclarator(
    fnNode.childForFieldName("declarator"),
  );
  if (fnDeclarator) {
    const params = fnDeclarator.childForFieldName("parameters");
    if (params) {
      for (const param of params.namedChildren ?? []) {
        if (param.type !== "parameter_declaration") continue;
        push(typeNameFromNode(param.childForFieldName("type")));
      }
    }
  }
  return refs;
}
