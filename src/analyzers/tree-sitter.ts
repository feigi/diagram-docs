import TreeSitter from "web-tree-sitter";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type SupportedLanguage = "java" | "typescript" | "python" | "c";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/analyzers/tree-sitter.js → repo root → assets/tree-sitter/
// (Also works from src/analyzers/tree-sitter.ts when tests import source directly.)
const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets", "tree-sitter");

let parserInitialized = false;
const grammarCache = new Map<SupportedLanguage, TreeSitter.Language>();

export function resetLoaderForTesting(): void {
  parserInitialized = false;
  grammarCache.clear();
}

async function initOnce(): Promise<void> {
  if (parserInitialized) return;
  await TreeSitter.init();
  parserInitialized = true;
}

export async function loadLanguage(
  lang: SupportedLanguage,
): Promise<TreeSitter.Language> {
  await initOnce();
  const cached = grammarCache.get(lang);
  if (cached) return cached;
  const file = path.join(ASSETS_DIR, `tree-sitter-${lang}.wasm`);
  const grammar = await TreeSitter.Language.load(file);
  grammarCache.set(lang, grammar);
  return grammar;
}

export interface QueryMatch {
  pattern: number;
  captures: Array<{ name: string; node: TreeSitter.SyntaxNode }>;
}

export async function runQuery(
  lang: SupportedLanguage,
  source: string,
  queryText: string,
): Promise<QueryMatch[]> {
  const grammar = await loadLanguage(lang);
  const parser = new TreeSitter();
  parser.setLanguage(grammar);
  const tree = parser.parse(source);
  const query = grammar.query(queryText);
  const matches = query.matches(tree.rootNode);
  return matches.map((m) => ({
    pattern: m.pattern,
    captures: m.captures.map((c) => ({ name: c.name, node: c.node })),
  }));
}
