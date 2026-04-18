import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";

const CACHE_DIR = ".diagram-docs";
const META_FILE = "cache-meta.json";

interface CacheMeta {
  version: 1;
  scanChecksum: string;
  modelChecksum: string;
}

export interface ProjectCache {
  scanChecksum: string;
  modelChecksum: string;
  scan: RawStructure;
  model: ArchitectureModel | null;
}

function readMeta(projectDir: string): CacheMeta | null {
  const metaPath = path.join(projectDir, CACHE_DIR, META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (parsed?.version !== 1) return null;
    if (
      typeof parsed.scanChecksum !== "string" ||
      typeof parsed.modelChecksum !== "string"
    ) {
      return null;
    }
    return parsed as CacheMeta;
  } catch {
    return null;
  }
}

/**
 * Returns null when no cache exists or the cache predates the
 * two-checksum migration — the caller must treat the project as stale.
 */
export function readProjectCache(projectDir: string): ProjectCache | null {
  const meta = readMeta(projectDir);
  if (!meta) return null;

  const cacheDir = path.join(projectDir, CACHE_DIR);
  const scanPath = path.join(cacheDir, "scan.json");
  if (!fs.existsSync(scanPath)) return null;
  const scan: RawStructure = JSON.parse(fs.readFileSync(scanPath, "utf-8"));

  const modelPath = path.join(cacheDir, "model.yaml");
  const model = fs.existsSync(modelPath)
    ? (parseYaml(fs.readFileSync(modelPath, "utf-8")) as ArchitectureModel)
    : null;

  return {
    scanChecksum: meta.scanChecksum,
    modelChecksum: meta.modelChecksum,
    scan,
    model,
  };
}

export function writeProjectScan(
  projectDir: string,
  scan: RawStructure,
  scanChecksum: string,
  modelChecksum: string,
): void {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(cacheDir, "scan.json"),
    JSON.stringify(scan, null, 2),
    "utf-8",
  );

  const meta: CacheMeta = { version: 1, scanChecksum, modelChecksum };
  fs.writeFileSync(
    path.join(cacheDir, META_FILE),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
}

export function writeProjectModel(
  projectDir: string,
  model: ArchitectureModel,
): void {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, "model.yaml"),
    stringifyYaml(model, { lineWidth: 120 }),
    "utf-8",
  );
}

export function isScanStale(
  projectDir: string,
  currentScanChecksum: string,
): boolean {
  const meta = readMeta(projectDir);
  if (!meta) return true;
  return meta.scanChecksum !== currentScanChecksum;
}

export function isModelStale(
  projectDir: string,
  currentModelChecksum: string,
): boolean {
  const meta = readMeta(projectDir);
  if (!meta) return true;
  return meta.modelChecksum !== currentModelChecksum;
}
