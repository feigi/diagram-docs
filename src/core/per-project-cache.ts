import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";

const CACHE_DIR = ".diagram-docs";

export interface ProjectCache {
  checksum: string;
  scan: RawStructure;
  model: ArchitectureModel | null;
}

/**
 * Read cached scan and model for a project.
 * Returns null if no cache exists.
 */
export function readProjectCache(projectDir: string): ProjectCache | null {
  const cacheDir = path.join(projectDir, CACHE_DIR);

  const checksumPath = path.join(cacheDir, "checksum");
  if (!fs.existsSync(checksumPath)) return null;

  const checksum = fs.readFileSync(checksumPath, "utf-8").trim();

  const scanPath = path.join(cacheDir, "scan.json");
  if (!fs.existsSync(scanPath)) return null;

  const scan: RawStructure = JSON.parse(fs.readFileSync(scanPath, "utf-8"));

  const modelPath = path.join(cacheDir, "model.yaml");
  let model: ArchitectureModel | null = null;
  if (fs.existsSync(modelPath)) {
    model = parseYaml(fs.readFileSync(modelPath, "utf-8")) as ArchitectureModel;
  }

  return { checksum, scan, model };
}

/**
 * Write scan output and checksum to the project's cache directory.
 */
export function writeProjectScan(
  projectDir: string,
  scan: RawStructure,
  checksum: string,
): void {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(cacheDir, "scan.json"),
    JSON.stringify(scan, null, 2),
    "utf-8",
  );
  fs.writeFileSync(path.join(cacheDir, "checksum"), checksum, "utf-8");
}

/**
 * Write a per-container model fragment to the project's cache directory.
 */
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

/**
 * Check if a project's cache is stale by comparing checksums.
 */
export function isProjectStale(
  projectDir: string,
  currentChecksum: string,
): boolean {
  const cacheDir = path.join(projectDir, CACHE_DIR);
  const checksumPath = path.join(cacheDir, "checksum");

  if (!fs.existsSync(checksumPath)) return true;

  const cached = fs.readFileSync(checksumPath, "utf-8").trim();
  return cached !== currentChecksum;
}
