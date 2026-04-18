/**
 * Cleanup of stale scaffold and generated directories after a container is removed.
 *
 * When a source folder is deleted, the generate pipeline rebuilds the architecture
 * model without the deleted container. This module removes the orphaned
 * `containers/<id>/` directories (scaffold + _generated/) that were created
 * during previous runs for now-absent containers.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import {
  collectAggregatorIds,
  resolveSubmodulePaths,
} from "./submodule-scaffold.js";

const CUSTOMIZATION_MARKER = "# Add your customizations below this line";

/**
 * Returns true if the scaffold file at `filePath` contains user-added content
 * below the customization marker line. Returns true (conservative/safe) if the
 * file exists but lacks the marker entirely (i.e. the structure was modified).
 * Returns false if the file does not exist.
 */
export function isUserModified(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  const idx = content.indexOf(CUSTOMIZATION_MARKER);
  if (idx === -1) return true; // marker absent — treat as modified (conservative)
  return content.slice(idx + CUSTOMIZATION_MARKER.length).trim().length > 0;
}

/**
 * Returns true if `filePath` is an untouched submodule config stub:
 * every non-empty, non-whitespace line starts with `#`. Returns false if
 * the file does not exist or contains any real YAML content.
 */
export function isInertSubmoduleStub(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith("#")) return false;
  }
  return true;
}

/**
 * Remove scaffold and generated directories for containers that are no longer
 * in `model`. Called after the model is resolved, before new content is written.
 *
 * Behaviour per orphaned `containers/<id>/` directory:
 * - `_generated/` subdir is always removed (auto-generated, never user-edited).
 * - If the scaffold file (`c3-component.d2`) has no user customizations:
 *     the file is removed, then the directory is removed if now empty.
 *     A message is printed to stderr.
 * - If the scaffold file has user customizations:
 *     the directory is left intact and a warning is printed to stderr.
 */
export function removeStaleContainerDirs(
  outputDir: string,
  model: ArchitectureModel,
): void {
  const containersDir = path.join(outputDir, "containers");
  if (!fs.existsSync(containersDir)) return;

  const activeIds = new Set(model.containers.map((c) => c.id));

  for (const entry of fs.readdirSync(containersDir)) {
    if (activeIds.has(entry)) continue;

    const containerDir = path.join(containersDir, entry);
    const stat = fs.statSync(containerDir, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) continue;

    // Always remove _generated/ first — it contains only auto-generated content.
    const generatedDir = path.join(containerDir, "_generated");
    if (fs.existsSync(generatedDir)) {
      fs.rmSync(generatedDir, { recursive: true, force: true });
    }

    // Decide what to do with the scaffold file.
    const scaffoldFile = path.join(containerDir, "c3-component.d2");
    if (isUserModified(scaffoldFile)) {
      console.error(
        `Warning: containers/${entry}/c3-component.d2 has user customizations — remove manually if no longer needed.`,
      );
      continue;
    }

    // No user customizations — remove the scaffold file and directory.
    if (fs.existsSync(scaffoldFile)) {
      fs.rmSync(scaffoldFile);
    }

    // Remove the directory if it is now empty.
    const remaining = fs.readdirSync(containerDir);
    if (remaining.length === 0) {
      fs.rmdirSync(containerDir);
      console.error(`Removed: containers/${entry}/`);
    }
  }
}

/**
 * Remove previously-scaffolded submodule sites for containers that are now
 * classified as aggregators. Called from `generate` before
 * `generateSubmoduleDocs`. Honors user customizations:
 *
 * - The aggregator docs subtree is removed only if the scaffold
 *   `c3-component.d2` has no user customizations. Otherwise a warning is
 *   printed and the tree is left intact.
 * - The aggregator `diagram-docs.yaml` stub is removed only if inert
 *   (all lines commented). Otherwise it is preserved.
 */
export function removeStaleSubmoduleDirs(
  repoRoot: string,
  model: ArchitectureModel,
  config: Config,
): void {
  const aggregatorIds = collectAggregatorIds(model);
  const subCfg = config.submodules;

  for (const container of model.containers) {
    if (!aggregatorIds.has(container.id)) continue;
    if (!container.path || container.path === ".") continue;

    const override = subCfg.overrides[container.applicationId];
    if (override?.exclude) continue;

    const docsDir = override?.docsDir ?? subCfg.docsDir;
    const appRoot = path.join(repoRoot, container.path);
    const archDir = path.join(appRoot, docsDir, "architecture");
    const scaffold = path.join(archDir, "c3-component.d2");

    if (fs.existsSync(archDir)) {
      if (isUserModified(scaffold)) {
        console.error(
          `Warning: ${path.relative(repoRoot, scaffold)} has user customizations — aggregator site preserved. Remove manually if no longer needed.`,
        );
      } else {
        fs.rmSync(archDir, { recursive: true, force: true });
        console.error(`Removed: ${path.relative(repoRoot, archDir)}/`);
      }
    }

    const stub = path.join(appRoot, "diagram-docs.yaml");
    if (fs.existsSync(stub) && isInertSubmoduleStub(stub)) {
      fs.rmSync(stub);
      console.error(`Removed: ${path.relative(repoRoot, stub)}`);
    }
  }
}

/**
 * Remove root-mode `containers/<containerId>/components/<compId>/` dirs whose
 * component is no longer in the model. Mirrors removeStaleSubmoduleComponentDirs
 * for the root layout. `_generated/` is always removed; scaffold + dir are
 * removed only when the scaffold has no user content.
 */
export function removeStaleComponentDirs(
  outputDir: string,
  model: ArchitectureModel,
): void {
  const containersDir = path.join(outputDir, "containers");
  if (!fs.existsSync(containersDir)) return;

  const activeByContainer = new Map<string, Set<string>>();
  for (const comp of model.components) {
    const set = activeByContainer.get(comp.containerId) ?? new Set<string>();
    set.add(comp.id);
    activeByContainer.set(comp.containerId, set);
  }

  for (const containerEntry of fs.readdirSync(containersDir)) {
    const componentsDir = path.join(
      containersDir,
      containerEntry,
      "components",
    );
    if (!fs.existsSync(componentsDir)) continue;

    const activeIds =
      activeByContainer.get(containerEntry) ?? new Set<string>();

    for (const compEntry of fs.readdirSync(componentsDir)) {
      if (activeIds.has(compEntry)) continue;

      const compDir = path.join(componentsDir, compEntry);
      const stat = fs.statSync(compDir, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;

      const generatedDir = path.join(compDir, "_generated");
      if (fs.existsSync(generatedDir)) {
        fs.rmSync(generatedDir, { recursive: true, force: true });
      }

      const scaffoldFile = path.join(compDir, "c4-code.d2");
      if (isUserModified(scaffoldFile)) {
        console.error(
          `Warning: L4: containers/${containerEntry}/components/${compEntry}/c4-code.d2 has user customizations — remove manually if no longer needed.`,
        );
        continue;
      }

      if (fs.existsSync(scaffoldFile)) fs.rmSync(scaffoldFile);

      const remaining = fs.readdirSync(compDir);
      if (remaining.length === 0) {
        fs.rmdirSync(compDir);
        console.error(
          `Removed: containers/${containerEntry}/components/${compEntry}/`,
        );
      }
    }
  }
}

/**
 * Remove submodule `components/<compId>/` dirs whose component is no longer
 * in the model for the owning container. Mirrors removeStaleContainerDirs:
 * `_generated/` is always removed; scaffold + dir are removed only when the
 * scaffold has no user content; otherwise warn and leave intact.
 */
export function removeStaleSubmoduleComponentDirs(
  repoRoot: string,
  config: Config,
  model: ArchitectureModel,
): void {
  if (!config.submodules.enabled) return;

  for (const container of model.containers) {
    if (config.submodules.overrides[container.applicationId]?.exclude) continue;

    const { architectureDir } = resolveSubmodulePaths(
      repoRoot,
      container,
      config,
    );
    const componentsDir = path.join(architectureDir, "components");
    if (!fs.existsSync(componentsDir)) continue;

    const activeIds = new Set(
      model.components
        .filter((c) => c.containerId === container.id)
        .map((c) => c.id),
    );

    for (const entry of fs.readdirSync(componentsDir)) {
      if (activeIds.has(entry)) continue;

      const compDir = path.join(componentsDir, entry);
      const stat = fs.statSync(compDir, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) continue;

      const generatedDir = path.join(compDir, "_generated");
      if (fs.existsSync(generatedDir)) {
        fs.rmSync(generatedDir, { recursive: true, force: true });
      }

      const scaffoldFile = path.join(compDir, "c4-code.d2");
      const relPath = path.relative(repoRoot, scaffoldFile);

      if (isUserModified(scaffoldFile)) {
        console.error(
          `Warning: L4: ${relPath} has user customizations — remove manually if no longer needed.`,
        );
        continue;
      }

      if (fs.existsSync(scaffoldFile)) fs.rmSync(scaffoldFile);

      const remaining = fs.readdirSync(compDir);
      if (remaining.length === 0) {
        fs.rmdirSync(compDir);
        console.error(`Removed: ${path.relative(repoRoot, compDir)}/`);
      }
    }
  }
}
