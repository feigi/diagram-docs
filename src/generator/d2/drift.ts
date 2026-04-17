import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import { toD2Id } from "./stability.js";
import { resolveSubmodulePaths } from "./submodule-scaffold.js";
import type { Config } from "../../config/schema.js";

export interface DriftWarning {
  file: string;
  line: number;
  id: string;
  message: string;
}

export interface CheckDriftOptions {
  repoRoot: string;
  config: Config;
}

export function checkDrift(
  outputDir: string,
  model: ArchitectureModel,
  options?: CheckDriftOptions,
): DriftWarning[] {
  const validIds = buildValidIdSet(model);
  const warnings: DriftWarning[] = [];

  const userFiles = [
    path.join(outputDir, "c1-context.d2"),
    path.join(outputDir, "c2-container.d2"),
  ];

  // Component diagram files
  const containersDir = path.join(outputDir, "containers");
  if (fs.existsSync(containersDir)) {
    for (const entry of fs.readdirSync(containersDir)) {
      const componentFile = path.join(containersDir, entry, "c3-component.d2");
      if (fs.existsSync(componentFile)) {
        userFiles.push(componentFile);
      }
    }
  }

  const modelOpts: DriftCheckOptions = {
    caseInsensitive: false,
    pattern: ID_PATTERNS.kebab,
  };
  for (const filePath of userFiles) {
    if (!fs.existsSync(filePath)) continue;
    warnings.push(...checkFile(filePath, validIds, modelOpts));
  }

  // Code-level diagram files (C4). These reference code-element IDs which
  // use underscores and may preserve source-identifier casing, so we check
  // them against a distinct id set using a permissive pattern.
  if (model.codeElements && model.codeElements.length > 0) {
    const codeIds = new Set<string>();
    for (const el of model.codeElements) {
      codeIds.add(toD2Id(el.id));
    }
    const codeOpts: DriftCheckOptions = {
      caseInsensitive: true,
      pattern: ID_PATTERNS.code,
    };
    if (fs.existsSync(containersDir)) {
      for (const containerEntry of fs.readdirSync(containersDir)) {
        const componentsDir = path.join(
          containersDir,
          containerEntry,
          "components",
        );
        if (!fs.existsSync(componentsDir)) continue;
        for (const componentEntry of fs.readdirSync(componentsDir)) {
          const codeFile = path.join(
            componentsDir,
            componentEntry,
            "c4-code.d2",
          );
          if (!fs.existsSync(codeFile)) continue;
          warnings.push(...checkFile(codeFile, codeIds, codeOpts));
        }
      }
    }
  }

  // Submodule L4 paths
  if (
    options?.config.submodules.enabled &&
    model.codeElements &&
    model.codeElements.length > 0
  ) {
    const codeIds = new Set<string>();
    for (const el of model.codeElements) codeIds.add(toD2Id(el.id));
    const codeOpts: DriftCheckOptions = {
      caseInsensitive: true,
      pattern: ID_PATTERNS.code,
    };
    for (const container of model.containers) {
      const { architectureDir } = resolveSubmodulePaths(
        options.repoRoot,
        container,
        options.config,
      );
      const componentsDir = path.join(architectureDir, "components");
      if (!fs.existsSync(componentsDir)) continue;
      for (const entry of fs.readdirSync(componentsDir)) {
        const codeFile = path.join(componentsDir, entry, "c4-code.d2");
        if (!fs.existsSync(codeFile)) continue;
        // Submodule c4-code.d2 files all share the same basename, so the
        // default basename-only `file` field is ambiguous across containers.
        // Replace it with the absolute path so warnings can be located.
        for (const w of checkFile(codeFile, codeIds, codeOpts)) {
          warnings.push({ ...w, file: codeFile });
        }
      }
    }
  }

  return warnings;
}

function buildValidIdSet(model: ArchitectureModel): Set<string> {
  const ids = new Set<string>();

  const sysId = toD2Id("system");
  ids.add(sysId);

  for (const actor of model.actors) {
    ids.add(toD2Id(actor.id));
  }

  for (const ext of model.externalSystems) {
    ids.add(toD2Id(ext.id));
  }

  for (const container of model.containers) {
    const cId = toD2Id(container.id);
    ids.add(cId);
    ids.add(`${sysId}.${cId}`); // nested form in container diagram
  }

  for (const component of model.components) {
    const compId = toD2Id(component.id);
    ids.add(compId);
    const containerId = toD2Id(component.containerId);
    ids.add(`${containerId}.${compId}`); // nested form in component diagram
  }

  // D2 built-in keywords that aren't model IDs
  ids.add("direction");
  ids.add("classes");

  return ids;
}

const ID_PATTERNS = {
  // Model-level IDs: kebab-case, lowercase.
  kebab: {
    idLine: /^([a-z0-9][a-z0-9.-]*)/,
    connection: /^([a-z0-9][a-z0-9.-]*)\s*->\s*([a-z0-9][a-z0-9.-]*)/,
    // Code-level identifiers use underscores and may preserve source casing,
    // so the permissive pattern accepts uppercase.
  },
  code: {
    idLine: /^([A-Za-z0-9_][A-Za-z0-9_.-]*)/,
    connection:
      /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*->\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)/,
  },
} as const;

interface DriftCheckOptions {
  caseInsensitive: boolean;
  pattern: { idLine: RegExp; connection: RegExp };
}

function checkFile(
  filePath: string,
  validIds: Set<string>,
  opts: DriftCheckOptions,
): DriftWarning[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `Warning: cannot read ${filePath} for drift check: ${msg}\n`,
    );
    return [];
  }
  const lines = content.split("\n");
  const relPath = path.basename(filePath);
  const warnings: DriftWarning[] = [];

  let customizationStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("...@")) {
      customizationStart = i + 1;
    }
  }

  for (let i = customizationStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const connMatch = line.match(opts.pattern.connection);
    if (connMatch) {
      checkId(connMatch[1], relPath, i + 1, validIds, warnings, opts);
      checkId(connMatch[2], relPath, i + 1, validIds, warnings, opts);
      continue;
    }

    const idMatch = line.match(opts.pattern.idLine);
    if (idMatch) {
      checkId(idMatch[1], relPath, i + 1, validIds, warnings, opts);
    }
  }

  return warnings;
}

function checkId(
  raw: string,
  file: string,
  line: number,
  validIds: Set<string>,
  warnings: DriftWarning[],
  opts: DriftCheckOptions,
): void {
  const rootId = extractRootId(raw);
  if (!rootId) return;

  const lookup = opts.caseInsensitive ? rootId.toLowerCase() : rootId;
  if (validIds.has(lookup)) return;

  const parts = lookup.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(".");
    if (validIds.has(prefix)) return;
  }

  warnings.push({
    file,
    line,
    id: rootId,
    message: `Reference to "${rootId}" not found in architecture model`,
  });
}

/** Known D2 property names that should not be treated as model IDs. */
const D2_PROPS = new Set([
  "class",
  "shape",
  "label",
  "style",
  "icon",
  "tooltip",
  "link",
  "near",
  "width",
  "height",
  "top",
  "left",
  "grid-rows",
  "grid-columns",
  "grid-gap",
  "vertical-gap",
  "horizontal-gap",
  "font-size",
  "font-color",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dash",
  "border-radius",
  "opacity",
  "shadow",
  "3d",
  "multiple",
  "animated",
  "bold",
  "italic",
  "underline",
  "text-transform",
  "source-arrowhead",
  "target-arrowhead",
]);

function extractRootId(raw: string): string | null {
  const parts = raw.split(".");
  // Walk backwards, dropping known D2 properties
  let end = parts.length;
  while (end > 0 && D2_PROPS.has(parts[end - 1])) {
    end--;
  }
  if (end === 0) return null;
  return parts.slice(0, end).join(".");
}
