import type { Config } from "../config/schema.js";

/** Raw scan output types */

export type ProjectType = "container" | "library";

export interface DiscoveredProject {
  path: string;
  buildFile: string;
  language: string;
  analyzerId: string;
  type: ProjectType;
}

export interface RawStructure {
  version: 1;
  scannedAt: string;
  checksum: string;
  applications: ScannedApplication[];
}

export interface ScannedApplication {
  id: string;
  path: string;
  name: string;
  language: "java" | "python" | "c" | "typescript";
  buildFile: string;
  modules: ScannedModule[];
  externalDependencies: ExternalDep[];
  internalImports: InternalImport[];
  publishedAs?: string;
  /** Config/resource files included for LLM-based architecture analysis */
  configFiles?: Array<{ path: string; content: string }>;
}

export interface ScannedModule {
  id: string;
  path: string;
  name: string;
  files: string[];
  exports: string[];
  imports: ModuleImport[];
  metadata: Record<string, string>;
}

export interface ExternalDep {
  name: string;
  version?: string;
}

export interface InternalImport {
  sourceModuleId: string;
  targetApplicationId: string;
  targetPath: string;
}

export interface ModuleImport {
  source: string;
  resolved?: string;
  isExternal: boolean;
}

/** Architecture model types (agent-produced, tool-consumed) */

export interface ArchitectureModel {
  version: 1;
  system: { name: string; description: string };
  actors: Array<{ id: string; name: string; description: string }>;
  externalSystems: Array<{
    id: string;
    name: string;
    description: string;
    technology?: string;
    tags?: string[];
  }>;
  containers: Array<{
    id: string;
    applicationId: string;
    name: string;
    description: string;
    technology: string;
    path?: string;
  }>;
  components: Array<{
    id: string;
    containerId: string;
    name: string;
    description: string;
    technology: string;
    moduleIds: string[];
  }>;
  relationships: Array<{
    sourceId: string;
    targetId: string;
    label: string;
    technology?: string;
  }>;
}

/** Language analyzer plugin interface */

export interface ScanConfig {
  exclude: string[];
  abstraction: Config["abstraction"];
}

export interface LanguageAnalyzer {
  id: string;
  name: string;
  buildFilePatterns: string[];
  /** Glob patterns for directories/files that should be excluded when this language is detected. */
  defaultExcludes?: string[];
  analyze(appPath: string, config: ScanConfig): Promise<ScannedApplication>;
}
