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
