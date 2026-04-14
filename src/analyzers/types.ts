import type { Config } from "../config/schema.js";
import type { ConfigSignal } from "../core/config-signals.js";

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
  /** Architecture signals detected in config file content */
  signals?: ConfigSignal[];
}

export interface ScannedModule {
  id: string;
  path: string;
  name: string;
  files: string[];
  exports: string[];
  imports: ModuleImport[];
  metadata: Record<string, string>;
  codeElements?: RawCodeElement[];
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

export interface RawCodeElement {
  id: string;
  kind: string;
  name: string;
  visibility?: "public" | "internal" | "private";
  parentId?: string;
  members?: CodeMember[];
  tags?: string[];
  references?: RawCodeReference[];
  location: { file: string; line: number };
}

export interface CodeMember {
  name: string;
  kind: "field" | "method";
  signature?: string;
  visibility?: "public" | "internal" | "private";
}

export interface RawCodeReference {
  targetName: string;
  kind: "extends" | "implements" | "uses" | "contains";
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
  codeElements?: CodeElement[];
  codeRelationships?: CodeRelationship[];
}

export interface CodeElement {
  id: string;
  componentId: string;
  kind: string;
  name: string;
  visibility?: "public" | "internal" | "private";
  parentElementId?: string;
  members?: CodeMember[];
  tags?: string[];
}

export interface CodeRelationship {
  sourceId: string;
  targetId: string;
  kind: "inherits" | "implements" | "uses" | "contains";
  label?: string;
}

/** Language analyzer plugin interface */

export interface ScanConfig {
  exclude: string[];
  abstraction: Config["abstraction"];
  levels?: Config["levels"];
  code?: Config["code"];
}

export interface LanguageAnalyzer {
  id: string;
  name: string;
  buildFilePatterns: string[];
  /** Glob patterns for directories/files that should be excluded when this language is detected. */
  defaultExcludes?: string[];
  analyze(appPath: string, config: ScanConfig): Promise<ScannedApplication>;
}
