import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import { toD2Id } from "./stability.js";

export interface DriftWarning {
  file: string;
  line: number;
  id: string;
  message: string;
}

/**
 * Check user-facing D2 files for references to IDs that no longer
 * exist in the generated model. Returns warnings for stale references.
 */
export function checkDrift(
  outputDir: string,
  model: ArchitectureModel,
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

  for (const filePath of userFiles) {
    if (!fs.existsSync(filePath)) continue;
    const fileWarnings = checkFile(filePath, validIds);
    warnings.push(...fileWarnings);
  }

  return warnings;
}

/**
 * Build the set of all valid D2 identifiers from the model.
 * Includes both bare IDs and nested forms (e.g. "system.los-cha").
 */
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

// Patterns that indicate a D2 identifier reference
const ID_LINE = /^([a-z0-9][a-z0-9.-]*)/;
const CONNECTION = /^([a-z0-9][a-z0-9.-]*)\s*->\s*([a-z0-9][a-z0-9.-]*)/;

/**
 * Parse a user D2 file and check for references to unknown IDs.
 * Only examines lines after the last spread import (`...@`).
 */
function checkFile(filePath: string, validIds: Set<string>): DriftWarning[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const relPath = path.basename(filePath);
  const warnings: DriftWarning[] = [];

  // Find the last spread import line
  let customizationStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("...@")) {
      customizationStart = i + 1;
    }
  }

  for (let i = customizationStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    // Check connection lines (two IDs)
    const connMatch = line.match(CONNECTION);
    if (connMatch) {
      checkId(connMatch[1], relPath, i + 1, validIds, warnings);
      checkId(connMatch[2], relPath, i + 1, validIds, warnings);
      continue;
    }

    // Check shape/property lines (one ID)
    const idMatch = line.match(ID_LINE);
    if (idMatch) {
      checkId(idMatch[1], relPath, i + 1, validIds, warnings);
    }
  }

  return warnings;
}

/**
 * Check whether an ID (or its root) exists in the valid set.
 * For "foo.bar.baz", checks "foo.bar.baz", "foo.bar", and "foo".
 */
function checkId(
  raw: string,
  file: string,
  line: number,
  validIds: Set<string>,
  warnings: DriftWarning[],
): void {
  // Strip trailing property segments like ".style.fill" or ".class"
  const rootId = extractRootId(raw);
  if (!rootId) return;

  if (validIds.has(rootId)) return;

  // Also check if it's a nested ref where the parent is valid
  const parts = rootId.split(".");
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

/**
 * Given a raw D2 reference like "system.los-cha.style.fill",
 * strip known property segments from the end to get "system.los-cha".
 */
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
