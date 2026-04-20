import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import { parseDrawioFile, DrawioParseError } from "./merge.js";
import { toDrawioId } from "./stability.js";

export interface DriftWarning {
  file: string;
  line: number;
  id: string;
  message: string;
  severity: "warning" | "error";
}

export function checkDrawioDrift(
  outputDir: string,
  model: ArchitectureModel,
): DriftWarning[] {
  const valid = buildValidIdSet(model);
  const out: DriftWarning[] = [];
  for (const f of collectDrawioFiles(outputDir)) {
    out.push(...checkFile(f, valid));
  }
  return out;
}

function buildValidIdSet(model: ArchitectureModel): Set<string> {
  const s = new Set<string>();
  s.add("system");
  for (const a of model.actors) s.add(toDrawioId(a.id));
  for (const e of model.externalSystems) s.add(toDrawioId(e.id));
  for (const c of model.containers) s.add(toDrawioId(c.id));
  for (const c of model.components) s.add(toDrawioId(c.id));
  for (const el of model.codeElements ?? []) s.add(toDrawioId(el.id));
  return s;
}

function collectDrawioFiles(outputDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(outputDir)) return files;
  const stack = [outputDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) stack.push(p);
      else if (entry.endsWith(".drawio")) files.push(p);
    }
  }
  return files;
}

function checkFile(filePath: string, valid: Set<string>): DriftWarning[] {
  let doc;
  try {
    doc = parseDrawioFile(filePath);
  } catch (err) {
    if (err instanceof DrawioParseError) {
      return [
        {
          file: filePath,
          line: 0,
          id: "",
          message: `drawio parse failed: ${err.message}`,
          severity: "error",
        },
      ];
    }
    throw err;
  }
  const out: DriftWarning[] = [];
  for (const cell of doc.cells.values()) {
    if (!cell.edge) continue;
    for (const endpoint of [cell.source, cell.target]) {
      if (!endpoint) continue;
      if (valid.has(endpoint)) continue;
      const target = doc.cells.get(endpoint);
      if (target && !target.managed) continue;
      out.push({
        file: filePath,
        line: 0,
        id: endpoint,
        message: `Reference to "${endpoint}" not found in architecture model`,
        severity: "warning",
      });
    }
  }
  return out;
}
