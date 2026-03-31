/**
 * Framework-agnostic config file collection for scan output.
 * Gives LLM agents the infrastructure context they need to identify
 * external systems (database endpoints, cache configs, etc.).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { globSync } from "glob";

const CONFIG_EXTENSIONS = [
  "yml",
  "yaml",
  "properties",
  "xml",
  "json",
  "toml",
  "cfg",
  "ini",
  "conf",
];

const CONFIG_GLOB = `**/*.{${CONFIG_EXTENSIONS.join(",")}}`;

/** Skip binary/non-config files that match the extension patterns */
const EXCLUDE_PATTERNS = [
  "**/keystore*",
  "**/truststore*",
  "**/cacerts*",
  "**/*.jks",
  "**/*.p12",
  "**/*.pfx",
  "**/*.pem",
  "**/*.crt",
  "**/*.key",
  "**/node_modules/**",
];

/** Max file size to include (10 KB) */
const MAX_FILE_SIZE = 10 * 1024;

/**
 * Collect config files from a directory, returning paths relative to appPath.
 * Skips binary files, keystores, and files exceeding MAX_FILE_SIZE.
 * Additional exclude patterns from the scan config are merged with the built-in list.
 */
export function collectConfigFiles(
  dir: string,
  appPath: string,
  exclude: string[] = [],
): Array<{ path: string; content: string }> {
  if (!fs.existsSync(dir)) return [];

  const files = globSync(CONFIG_GLOB, {
    cwd: dir,
    ignore: [...EXCLUDE_PATTERNS, ...exclude],
    nodir: true,
  });

  const results: Array<{ path: string; content: string }> = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      // Skip files that look binary (contain null bytes)
      if (content.includes("\0")) continue;
      results.push({
        path: path.relative(appPath, fullPath),
        content,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES") {
        process.stderr.write(
          `Warning: skipping config file ${fullPath}: ${(err as Error).message}\n`,
        );
        continue;
      }
      throw err;
    }
  }

  return results;
}
