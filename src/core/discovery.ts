import * as path from "node:path";
import { glob } from "glob";
import { getRegistry } from "../analyzers/registry.js";
import type { Config } from "../config/schema.js";
import type { ProjectType } from "../analyzers/types.js";
import { classifyProject } from "./classify.js";

/** @deprecated Use DiscoveredProject instead */
export type DiscoveredApp = DiscoveredProject;

export interface DiscoveredProject {
  path: string;
  buildFile: string;
  language: string;
  analyzerId: string;
  type: ProjectType;
}

export interface DiscoveryProgress {
  onSearching: (language: string, pattern: string) => void;
  onFound: (app: DiscoveredProject) => void;
}

export async function discoverApplications(
  rootDir: string,
  config: Config,
  progress?: DiscoveryProgress,
): Promise<DiscoveredProject[]> {
  const registry = getRegistry();
  const discovered: DiscoveredProject[] = [];
  const seenPaths = new Set<string>();

  for (const analyzer of registry) {
    for (const pattern of analyzer.buildFilePatterns) {
      progress?.onSearching(analyzer.id, pattern);
      const includePatterns = config.scan.include.map((inc) =>
        path.join(inc, "**", pattern),
      );

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

          const base = {
            path: appDir === "." ? "." : appDir,
            buildFile: path.basename(match),
            language: analyzer.id,
            analyzerId: analyzer.id,
          };

          const type = classifyProject(base, absAppDir, config.type);

          const found: DiscoveredProject = { ...base, type };
          progress?.onFound(found);
          discovered.push(found);
        }
      }
    }
  }

  return discovered.sort((a, b) => a.path.localeCompare(b.path));
}
