import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type TreeSitter from "web-tree-sitter";
import { runQueryScoped, createQueryLoader } from "../tree-sitter.js";
import type { RawCodeElement, CodeMember, RawCodeReference } from "../types.js";

type SyntaxNode = TreeSitter.SyntaxNode;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const getQuery = createQueryLoader(path.join(__dirname, "queries", "code.scm"));

// Builtin scalar types + common `typing` generics that carry no architectural
// meaning at L4. Collection element types (the `Foo` in `List[Foo]`) are still
// extracted; only the wrapper name is filtered here.
const PY_BUILTINS = new Set([
  "str",
  "int",
  "bool",
  "float",
  "complex",
  "bytes",
  "bytearray",
  "memoryview",
  "list",
  "dict",
  "tuple",
  "set",
  "frozenset",
  "object",
  "type",
  "None",
  "NoneType",
  "Ellipsis",
  "Any",
  "Optional",
  "Union",
  "Literal",
  "Final",
  "ClassVar",
  "Annotated",
  "List",
  "Dict",
  "Tuple",
  "Set",
  "FrozenSet",
  "Iterable",
  "Iterator",
  "Generator",
  "AsyncIterable",
  "AsyncIterator",
  "Callable",
  "Awaitable",
  "Coroutine",
  "Mapping",
  "MutableMapping",
  "Sequence",
  "MutableSequence",
  "Type",
]);

export async function extractPythonCode(
  filePath: string,
  source: string,
): Promise<RawCodeElement[]> {
  const query = await getQuery();
  return runQueryScoped("python", source, query, (matches) => {
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

      const visibility: "public" | "private" = name.startsWith("_")
        ? "private"
        : "public";
      const location = {
        file: filePath,
        line: decl.node.startPosition.row + 1,
      };

      if (kind === "class") {
        const references = collectClassReferences(decl.node);
        const members = collectPythonMembers(decl.node);
        elements.push({
          id: name,
          name,
          kind,
          visibility,
          members: members.length > 0 ? members : undefined,
          references: references.length > 0 ? references : undefined,
          location,
        });
      } else {
        // `function` is a symbol kind — no members in the model. The
        // discriminated union rejects a `members` field here at compile time.
        elements.push({
          id: name,
          name,
          kind,
          visibility,
          location,
        });
      }
    }
    return elements;
  });
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

function collectClassReferences(classNode: SyntaxNode): RawCodeReference[] {
  const refs: RawCodeReference[] = [];
  const seen = new Set<string>();

  const supers = classNode.childForFieldName("superclasses");
  if (supers) {
    for (const child of supers.namedChildren) {
      const name = baseName(child);
      if (name && !seen.has(name)) {
        seen.add(name);
        refs.push({ targetName: name, kind: "extends" });
      }
    }
  }

  for (const name of collectClassBodyTypeNames(classNode)) {
    if (PY_BUILTINS.has(name) || seen.has(name)) continue;
    seen.add(name);
    refs.push({ targetName: name, kind: "uses" });
  }

  return refs;
}

function collectClassBodyTypeNames(classNode: SyntaxNode): string[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];
  const out: string[] = [];
  for (const child of body.namedChildren) {
    const fn =
      child.type === "function_definition"
        ? child
        : child.type === "decorated_definition"
          ? (child.childForFieldName("definition") ??
            (child.namedChildren ?? []).find(
              (c) => c.type === "function_definition",
            ) ??
            null)
          : null;
    if (!fn) continue;

    const params = fn.childForFieldName("parameters");
    if (params) {
      for (const p of params.namedChildren ?? []) {
        const typeNode =
          p.type === "typed_parameter" || p.type === "typed_default_parameter"
            ? (p.childForFieldName("type") ??
              (p.namedChildren ?? []).find((c) => c.type === "type") ??
              null)
            : null;
        if (typeNode) out.push(...collectPyTypeNames(typeNode));
      }
    }

    out.push(...collectPyTypeNames(fn.childForFieldName("return_type")));
  }
  return out;
}

function collectPyTypeNames(node: SyntaxNode | null): string[] {
  if (!node) return [];
  if (node.type === "type") {
    const out: string[] = [];
    for (const c of node.namedChildren ?? []) {
      out.push(...collectPyTypeNames(c));
    }
    return out;
  }
  if (node.type === "identifier") return [node.text];
  if (node.type === "none") return ["None"];
  if (node.type === "attribute") {
    const attr =
      node.childForFieldName("attribute") ?? node.namedChildren.at(-1);
    return attr?.type === "identifier" ? [attr.text] : [];
  }
  if (node.type === "subscript" || node.type === "generic_type") {
    const out: string[] = [];
    const val = node.childForFieldName("value") ?? node.namedChildren?.[0];
    if (val) out.push(...collectPyTypeNames(val));
    for (const c of node.namedChildren ?? []) {
      if (c === val) continue;
      out.push(...collectPyTypeNames(c));
    }
    return out;
  }
  if (node.type === "type_parameter") {
    const out: string[] = [];
    for (const c of node.namedChildren ?? []) {
      out.push(...collectPyTypeNames(c));
    }
    return out;
  }
  if (
    node.type === "tuple" ||
    node.type === "list" ||
    node.type === "binary_operator"
  ) {
    const out: string[] = [];
    for (const c of node.namedChildren ?? []) {
      out.push(...collectPyTypeNames(c));
    }
    return out;
  }
  if (node.type === "string") {
    // Forward reference in quotes: `-> "User"` or `-> "pkg.User"`.
    const m = node.text.match(
      /^["']([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)["']$/,
    );
    if (!m) return [];
    const last = m[1].split(".").pop()!;
    return [last];
  }
  return [];
}

function collectPythonMembers(classNode: SyntaxNode): CodeMember[] {
  const body = classNode.childForFieldName("body");
  if (!body) return [];
  const members: CodeMember[] = [];
  for (const child of body.namedChildren) {
    // decorated_definition wraps a function_definition when @decorators are
    // applied (e.g. @property, @classmethod, @staticmethod). Unwrap so the
    // underlying method is captured.
    const fn =
      child.type === "function_definition"
        ? child
        : child.type === "decorated_definition"
          ? (child.childForFieldName("definition") ??
            (child.namedChildren ?? []).find(
              (c) => c.type === "function_definition",
            ) ??
            null)
          : null;
    if (!fn) continue;
    const nameNode = fn.childForFieldName("name");
    if (!nameNode) continue;
    const name = nameNode.text;
    const params = fn.childForFieldName("parameters")?.text ?? "()";
    const ret = fn.childForFieldName("return_type")?.text;
    members.push({
      name,
      kind: "method",
      signature: ret ? `${name}${params} -> ${ret}` : `${name}${params}`,
      visibility: name.startsWith("_") ? "private" : "public",
    });
  }
  return members;
}
