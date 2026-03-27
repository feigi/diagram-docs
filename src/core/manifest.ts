import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ProjectType } from "../analyzers/types.js";

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

export interface ManifestV2 {
  version: 2;
  projects: Record<
    string,
    {
      type: ProjectType;
      path: string;
      language: string;
    }
  >;
  synthesis?: {
    timestamp: string;
  };
}

export function readManifestV2(rootDir: string): ManifestV2 | null {
  const mp = manifestPath(rootDir);
  if (!fs.existsSync(mp)) return null;

  const raw = fs.readFileSync(mp, "utf-8");
  const parsed = parseYaml(raw);
  if (parsed?.version === 2) return parsed as ManifestV2;
  return null;
}

export function writeManifestV2(rootDir: string, manifest: ManifestV2): void {
  const dir = path.join(rootDir, MANIFEST_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(manifest, { lineWidth: 120 });
  fs.writeFileSync(manifestPath(rootDir), yaml, "utf-8");
}

export function createDefaultManifestV2(): ManifestV2 {
  return {
    version: 2,
    projects: {},
  };
}
