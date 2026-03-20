import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface Manifest {
  version: 1;
  lastScan?: {
    timestamp: string;
    checksum: string;
  };
  lastModel?: {
    timestamp: string;
    checksum: string;
  };
  rawStructure: string;
  model: string;
}

const MANIFEST_DIR = ".diagram-docs";
const MANIFEST_FILE = "manifest.yaml";

function manifestPath(rootDir: string): string {
  return path.join(rootDir, MANIFEST_DIR, MANIFEST_FILE);
}

export function readManifest(rootDir: string): Manifest | null {
  const mp = manifestPath(rootDir);
  if (!fs.existsSync(mp)) return null;

  const raw = fs.readFileSync(mp, "utf-8");
  return parseYaml(raw) as Manifest;
}

export function writeManifest(rootDir: string, manifest: Manifest): void {
  const dir = path.join(rootDir, MANIFEST_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(manifest, { lineWidth: 120 });
  fs.writeFileSync(manifestPath(rootDir), yaml, "utf-8");
}

export function createDefaultManifest(): Manifest {
  return {
    version: 1,
    rawStructure: "./raw-structure.json",
    model: "./architecture-model.yaml",
  };
}
