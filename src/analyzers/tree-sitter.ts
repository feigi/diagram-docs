import TreeSitter from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawCodeElement } from "./types.js";

export type SupportedLanguage = "java" | "typescript" | "python" | "c";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/analyzers/tree-sitter.js → repo root → assets/tree-sitter/
// (Also works from src/analyzers/tree-sitter.ts when tests import source directly.)
const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets", "tree-sitter");

let initPromise: Promise<void> | null = null;
const grammarCache = new Map<SupportedLanguage, Promise<TreeSitter.Language>>();

export function resetLoaderForTesting(): void {
  initPromise = null;
  grammarCache.clear();
}

function initOnce(): Promise<void> {
  if (!initPromise) initPromise = TreeSitter.init();
  return initPromise;
}

export async function loadLanguage(
  lang: SupportedLanguage,
): Promise<TreeSitter.Language> {
  await initOnce();
  let p = grammarCache.get(lang);
  if (!p) {
    p = TreeSitter.Language.load(
      path.join(ASSETS_DIR, `tree-sitter-${lang}.wasm`),
    );
    grammarCache.set(lang, p);
  }
  return p;
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

/**
 * Returns a lazy-cached loader for a tree-sitter query file.
 * Call once at module level; the returned function reads and caches on first call.
 */
export function createQueryLoader(queryPath: string): () => Promise<string> {
  let cached: string | null = null;
  return async () => {
    if (cached !== null) return cached;
    cached = await readFile(queryPath, "utf-8");
    return cached;
  };
}

/**
 * Reads all files in parallel and runs `extractFn` on each.
 * Callers pass fully-resolved absolute paths.
 */
export async function extractCodeElementsForFiles(
  filePaths: string[],
  extractFn: (filePath: string, source: string) => Promise<RawCodeElement[]>,
): Promise<RawCodeElement[]> {
  const results = await Promise.all(
    filePaths.map(async (fp) => {
      const source = await readFile(fp, "utf-8");
      return extractFn(fp, source);
    }),
  );
  return results.flat();
}
