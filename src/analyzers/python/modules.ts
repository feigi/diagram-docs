import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

export interface PythonModule {
  name: string;
  path: string;
  files: string[];
  exports: string[];
}

const FRAMEWORK_MARKERS: Record<string, string[]> = {
  fastapi: ["FastAPI", "APIRouter"],
  flask: ["Flask", "Blueprint"],
  django: ["django"],
};

export async function extractPythonModules(
  appPath: string,
  exclude: string[],
): Promise<PythonModule[]> {
  const pyFiles = await glob("**/*.py", {
    cwd: appPath,
    ignore: exclude,
    nodir: true,
  });

  const moduleMap = new Map<string, PythonModule>();

  for (const file of pyFiles) {
    const parts = file.split("/");
    let moduleName: string;
    let modulePath: string;

    if (parts.length === 1) {
      moduleName = path.basename(file, ".py");
      modulePath = ".";
    } else {
      moduleName = parts[0];
      modulePath = parts[0];
    }

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        name: moduleName,
        path: modulePath,
        files: [],
        exports: [],
      });
    }

    const mod = moduleMap.get(moduleName)!;
    mod.files.push(file);

    const fullPath = path.join(appPath, file);
    const content = fs.readFileSync(fullPath, "utf-8");

    // Extract __all__ exports
    const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
    if (allMatch) {
      const names = allMatch[1].match(/["']([^"']+)["']/g);
      if (names) {
        mod.exports.push(...names.map((n) => n.replace(/["']/g, "")));
      }
    }

    // Extract class definitions as exports
    for (const match of content.matchAll(/^class\s+([A-Z]\w+)/gm)) {
      if (!mod.exports.includes(match[1])) {
        mod.exports.push(match[1]);
      }
    }
  }

  return Array.from(moduleMap.values());
}

export function detectPythonFramework(filePath: string): string | null {
  const content = fs.readFileSync(filePath, "utf-8");
  for (const [framework, markers] of Object.entries(FRAMEWORK_MARKERS)) {
    if (markers.some((m) => content.includes(m))) {
      return framework;
    }
  }
  return null;
}
