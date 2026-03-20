import * as path from "node:path";
import { glob } from "glob";
import { getRegistry } from "../analyzers/registry.js";
import type { Config } from "../config/schema.js";

export interface DiscoveredApp {
  path: string;
  buildFile: string;
  language: string;
  analyzerId: string;
}

export async function discoverApplications(
  rootDir: string,
  config: Config,
): Promise<DiscoveredApp[]> {
  const registry = getRegistry();
  const discovered: DiscoveredApp[] = [];
  const seenPaths = new Set<string>();

  for (const analyzer of registry) {
    for (const pattern of analyzer.buildFilePatterns) {
      const includePatterns = config.scan.include.map((inc) =>
        path.join(inc, "**", pattern),
      );

      // Also check root level
      includePatterns.push(pattern);

      for (const includePattern of includePatterns) {
        const matches = await glob(includePattern, {
          cwd: rootDir,
          ignore: config.scan.exclude,
          nodir: true,
        });

        for (const match of matches) {
          const appDir = path.dirname(match);
          const absAppDir = path.resolve(rootDir, appDir);

          if (seenPaths.has(absAppDir)) continue;
          seenPaths.add(absAppDir);

          discovered.push({
            path: appDir === "." ? "." : appDir,
            buildFile: path.basename(match),
            language: analyzer.id,
            analyzerId: analyzer.id,
          });
        }
      }
    }
  }

  return discovered.sort((a, b) => a.path.localeCompare(b.path));
}
