import * as path from "node:path";
import { glob } from "glob";

export interface CSourceGroup {
  name: string;
  path: string;
  headers: string[];
  sources: string[];
}

export async function extractCStructure(
  appPath: string,
  exclude: string[],
): Promise<CSourceGroup[]> {
  const cFiles = await glob("**/*.{c,h}", {
    cwd: appPath,
    ignore: exclude,
    nodir: true,
  });

  // Group by directory
  const groupMap = new Map<string, CSourceGroup>();

  for (const file of cFiles) {
    const dir = path.dirname(file);
    const groupName = dir === "." ? path.basename(appPath) : dir.split("/")[0];

    if (!groupMap.has(dir)) {
      groupMap.set(dir, {
        name: groupName,
        path: dir,
        headers: [],
        sources: [],
      });
    }

    const group = groupMap.get(dir)!;
    if (file.endsWith(".h")) {
      group.headers.push(file);
    } else {
      group.sources.push(file);
    }
  }

  return Array.from(groupMap.values());
}
