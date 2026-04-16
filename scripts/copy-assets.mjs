#!/usr/bin/env node
// Copy non-.ts assets (tree-sitter .scm queries) from src/ to dist/ after tsc,
// which only emits .js/.d.ts. Analyzers resolve queries via `__dirname`, so
// the directory layout must be preserved 1:1.

import { chmodSync, cpSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { glob } from "glob";

const require = createRequire(import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const srcRoot = join(repoRoot, "src");
const distRoot = join(repoRoot, "dist");

const assetPatterns = ["**/*.scm"];
const matches = await glob(assetPatterns, { cwd: srcRoot, absolute: false });

if (matches.length === 0) {
  console.error(
    `copy-assets: no files matched ${assetPatterns.join(", ")} under ${srcRoot}`,
  );
  process.exit(1);
}

try {
  statSync(distRoot);
} catch {
  console.error(`copy-assets: ${distRoot} does not exist — run tsc first`);
  process.exit(1);
}

for (const rel of matches) {
  const from = join(srcRoot, rel);
  const to = join(distRoot, rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.error(
    `copy-assets: ${relative(repoRoot, from)} → ${relative(repoRoot, to)}`,
  );
}

console.error(`copy-assets: copied ${matches.length} file(s).`);

// tsc drops the executable bit when it rewrites bin targets. npm publish /
// `npm i -g` sets it via the `bin` field, but local rebuilds used directly
// (e.g. `npm link`, worktree-backed global install) don't — so chmod any
// path declared in `package.json#bin`.
const pkg = require(join(repoRoot, "package.json"));
const binEntries =
  typeof pkg.bin === "string"
    ? [pkg.bin]
    : pkg.bin
      ? Object.values(pkg.bin)
      : [];
for (const rel of binEntries) {
  const binPath = join(repoRoot, rel);
  chmodSync(binPath, 0o755);
  console.error(`copy-assets: chmod +x ${relative(repoRoot, binPath)}`);
}
