import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

const SOURCE_EXTENSIONS = [
  "java",
  "py",
  "c",
  "h",
  "xml",
  "gradle",
  "toml",
  "cfg",
  "txt",
  "cmake",
];

export async function computeChecksum(
  rootDir: string,
  appPaths: string[],
  exclude: string[],
  configFingerprint?: string,
): Promise<string> {
  const hash = crypto.createHash("sha256");

  if (configFingerprint) {
    hash.update(configFingerprint);
  }

  const extPattern = `**/*.{${SOURCE_EXTENSIONS.join(",")}}`;

  for (const appPath of appPaths.sort()) {
    const fullPath = path.resolve(rootDir, appPath);
    const files = await glob(extPattern, {
      cwd: fullPath,
      ignore: exclude,
      nodir: true,
    });

    const sortedFiles = files.sort();
    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const content = fs.readFileSync(path.join(fullPath, file), "utf-8");
      hash.update(`${appPath}/${file}\n`);
      hash.update(content);
      // Yield to the event loop periodically so the spinner keeps animating.
      if (i % 50 === 49) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  return `sha256:${hash.digest("hex")}`;
}

/**
 * Hash the source files of a project without mixing in any config
 * fingerprint. Callers combine the result with a fingerprint via
 * `mixFingerprint` to produce the scan or model cache checksums.
 */
export async function computeProjectSourceHash(
  projectDir: string,
  exclude: string[],
): Promise<string> {
  const hash = crypto.createHash("sha256");
  const extPattern = `**/*.{${SOURCE_EXTENSIONS.join(",")}}`;
  const files = await glob(extPattern, {
    cwd: projectDir,
    ignore: exclude,
    nodir: true,
  });
  const sortedFiles = files.sort();
  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const content = fs.readFileSync(path.join(projectDir, file), "utf-8");
    hash.update(`${file}\n`);
    hash.update(content);
    if (i % 50 === 49) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Derive a per-project checksum by mixing a source hash with a config
 * fingerprint. Deterministic and collision-resistant: different
 * fingerprints yield different checksums for the same source.
 */
export function mixFingerprint(
  sourceHash: string,
  fingerprint: string,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(fingerprint);
  hash.update("\n");
  hash.update(sourceHash);
  return `sha256:${hash.digest("hex")}`;
}

export async function computeProjectChecksum(
  projectDir: string,
  exclude: string[],
  configFingerprint?: string,
): Promise<string> {
  const source = await computeProjectSourceHash(projectDir, exclude);
  if (!configFingerprint) return source;
  return mixFingerprint(source, configFingerprint);
}
