import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import { parseDrawioFile } from "./merge.js";
import { toDrawioId } from "./stability.js";

export function removeStaleDrawioFiles(
  outputDir: string,
  model: ArchitectureModel,
): void {
  const validContainerIds = new Set(
    model.containers.map((c) => toDrawioId(c.id)),
  );
  const validComponentIds = new Set(
    model.components.map((c) => toDrawioId(c.id)),
  );
  walk(outputDir, (file) => {
    const rel = path.relative(outputDir, file);
    const match =
      /^containers[/\\]([^/\\]+)(?:[/\\]components[/\\]([^/\\]+))?/.exec(rel);
    if (!match) return;
    const [, container, component] = match;
    const isStaleContainer = container && !validContainerIds.has(container);
    const isStaleComponent = component && !validComponentIds.has(component);
    if (!isStaleContainer && !isStaleComponent) return;
    if (hasUserContent(file)) {
      console.error(
        `Warning: ${rel} contains user-edited cells — preserved; remove manually if no longer needed.`,
      );
      return;
    }
    fs.rmSync(file);
    console.error(`Removed: ${rel}`);
  });
}

function walk(root: string, visit: (file: string) => void): void {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) stack.push(p);
      else if (entry.endsWith(".drawio")) visit(p);
    }
  }
}

function hasUserContent(file: string): boolean {
  try {
    const doc = parseDrawioFile(file);
    for (const cell of doc.cells.values()) {
      if (cell.id === "0" || cell.id === "1") continue;
      if (!cell.managed) return true;
    }
    return false;
  } catch {
    return true;
  }
}
