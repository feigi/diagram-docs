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
const parserCache = new Map<SupportedLanguage, TreeSitter>();
const queryCache = new Map<string, TreeSitter.Query>();

export function resetLoaderForTesting(): void {
  initPromise = null;
  grammarCache.clear();
  for (const p of parserCache.values()) p.delete();
  parserCache.clear();
  for (const q of queryCache.values()) q.delete();
  queryCache.clear();
}

function initOnce(): Promise<void> {
  if (!initPromise) {
    initPromise = TreeSitter.init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function loadLanguage(
  lang: SupportedLanguage,
): Promise<TreeSitter.Language> {
  await initOnce();
  let p = grammarCache.get(lang);
  if (!p) {
    const wasmPath = path.join(ASSETS_DIR, `tree-sitter-${lang}.wasm`);
    p = TreeSitter.Language.load(wasmPath).catch((err: unknown) => {
      grammarCache.delete(lang);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to load tree-sitter grammar for "${lang}" from ${wasmPath}. ` +
          `Ensure assets/tree-sitter/tree-sitter-${lang}.wasm ships alongside the ` +
          `compiled output (typically dist/). Underlying error: ${msg}`,
      );
    });
    grammarCache.set(lang, p);
  }
  return p;
}

export interface QueryMatch {
  pattern: number;
  captures: Array<{ name: string; node: TreeSitter.SyntaxNode }>;
}

/**
 * Callback variant of runQuery that disposes the parser/tree/query after `fn`
 * returns. Use this to avoid leaking WASM memory across many files — the
 * node references passed to `fn` are only valid while the callback runs.
 */
export async function runQueryScoped<T>(
  lang: SupportedLanguage,
  source: string,
  queryText: string,
  fn: (matches: QueryMatch[], tree: TreeSitter.Tree) => T | Promise<T>,
): Promise<T> {
  const grammar = await loadLanguage(lang);

  let parser = parserCache.get(lang);
  if (!parser) {
    parser = new TreeSitter();
    parser.setLanguage(grammar);
    parserCache.set(lang, parser);
  }

  const queryCacheKey = `${lang}\0${queryText}`;
  let query = queryCache.get(queryCacheKey);
  if (!query) {
    query = grammar.query(queryText);
    queryCache.set(queryCacheKey, query);
  }

  const tree = parser.parse(source);
  try {
    const matches: QueryMatch[] = query.matches(tree.rootNode).map((m) => ({
      pattern: m.pattern,
      captures: m.captures.map((c) => ({ name: c.name, node: c.node })),
    }));
    return await fn(matches, tree);
  } finally {
    tree.delete();
  }
}

export function createQueryLoader(queryPath: string): () => Promise<string> {
  let cached: string | null = null;
  return async () => {
    if (cached !== null) return cached;
    cached = await readFile(queryPath, "utf-8");
    return cached;
  };
}

// Runs `extractFn` on each file in parallel. Read failures and extractor
// throws are isolated per-file so one bad file can't blackhole the module.
// Systemic failure (every file errored) is reported so users can distinguish
// a broken grammar / ABI mismatch from per-file data quality issues.
export async function extractCodeElementsForFiles(
  filePaths: string[],
  extractFn: (filePath: string, source: string) => Promise<RawCodeElement[]>,
): Promise<RawCodeElement[]> {
  let extractionFailures = 0;
  let firstFailingFile: string | undefined;
  const results = await Promise.all(
    filePaths.map(async (fp) => {
      let source: string;
      try {
        source = await readFile(fp, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `Warning: L4: code-level extraction failed for ${fp} (read error): ${msg}\n`,
        );
        return [] as RawCodeElement[];
      }
      try {
        return await extractFn(fp, source);
      } catch (err) {
        extractionFailures++;
        if (!firstFailingFile) firstFailingFile = fp;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `Warning: L4: code-level extraction failed for ${fp}: ${msg}\n`,
        );
        return [] as RawCodeElement[];
      }
    }),
  );
  if (extractionFailures > 0) {
    if (extractionFailures === filePaths.length) {
      process.stderr.write(
        `Warning: L4: code-level extraction failed on all ${filePaths.length} file(s) — likely a grammar, query, or walker bug rather than per-file source issues. First failing file: ${firstFailingFile ?? "(unknown)"}.\n`,
      );
    } else {
      process.stderr.write(
        `Warning: L4: code-level extraction failed for ${extractionFailures}/${filePaths.length} file(s); diagrams will be incomplete. First failing file: ${firstFailingFile ?? "(unknown)"}.\n`,
      );
    }
  }
  return results.flat();
}
