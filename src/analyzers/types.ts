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

/**
 * Universe of code-element kinds emitted by language analyzers.
 * Java emits `class | interface | enum`; TypeScript adds `type` (alias) and
 * `function`; Python emits `class | function`; C emits `struct | typedef |
 * function`. Keeping this as a closed union catches analyzer typos at compile
 * time and tells generators the full domain to render against.
 */
export type CodeElementKind =
  | "class"
  | "interface"
  | "enum"
  | "type"
  | "function"
  | "struct"
  | "typedef";

export interface RawCodeElement {
  id: string;
  kind: CodeElementKind;
  name: string;
  visibility?: "public" | "internal" | "private";
  members?: CodeMember[];
  tags?: string[];
  references?: RawCodeReference[];
  location: { file: string; line: number };
}

/**
 * Discriminated on `kind`: methods always carry a signature (the callable
 * shape is the whole point), fields are signature-optional (a bare field
 * name is still meaningful).
 */
export type CodeMember =
  | {
      name: string;
      kind: "field";
      signature?: string;
      visibility?: "public" | "internal" | "private";
    }
  | {
      name: string;
      kind: "method";
      signature: string;
      visibility?: "public" | "internal" | "private";
    };

/**
 * `extends` is the syntactic source-level keyword (Java/TS extends, Python
 * superclass list); it maps to the semantic `inherits` on the resolved
 * CodeRelationship after model-build. Kept distinct so analyzers stay
 * close to the source vocabulary.
 */
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

/** Single component entry from ArchitectureModel.components */
export type Component = ArchitectureModel["components"][number];

export interface CodeElement {
  id: string;
  componentId: string;
  containerId: string;
  kind: CodeElementKind;
  name: string;
  visibility?: "public" | "internal" | "private";
  members?: CodeMember[];
  tags?: string[];
}

export interface CodeRelationship {
  sourceId: string;
  targetId: string;
  /**
   * Display name for the target element. Populated at resolve time so
   * generators don't need to reverse-engineer a label from a qualified id.
   */
  targetName?: string;
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
