import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import {
  collectAggregatorIds,
  resolveSubmodulePaths,
} from "../d2/submodule-scaffold.js";
import { DrawioParseError, parseDrawioFile } from "./merge.js";
import { toDrawioId } from "./stability.js";

export function removeStaleDrawioFiles(
  outputDir: string,
  model: ArchitectureModel,
): void {
  const validContainerIds = new Set(
    model.containers.map((c) => toDrawioId(c.id)),
  );
  const validComponentIds = new Set(
    model.components.map((c) => toDrawioId(c.id)),
  );
  walk(outputDir, (file) => {
    const rel = path.relative(outputDir, file);
    const match =
      /^containers[/\\]([^/\\]+)(?:[/\\]components[/\\]([^/\\]+))?/.exec(rel);
    if (!match) return;
    const [, container, component] = match;
    const isStaleContainer = container && !validContainerIds.has(container);
    const isStaleComponent = component && !validComponentIds.has(component);
    if (!isStaleContainer && !isStaleComponent) return;
    if (hasUserContent(file)) {
      console.error(
        `Warning: ${rel} contains user-edited cells — preserved; remove manually if no longer needed.`,
      );
      return;
    }
    fs.rmSync(file);
    console.error(`Removed: ${rel}`);
  });
}

/**
 * Remove stale `.drawio` files under per-submodule architecture dirs
 * (`<repoRoot>/<appPath>/<docsDir>/architecture/`). Mirrors the D2 path's
 * `removeStaleSubmoduleDirs` / `removeStaleSubmoduleComponentDirs` pair, but
 * scoped to drawio files: the submodule tree lives outside `outputDir`, so
 * `removeStaleDrawioFiles` does not cover it.
 *
 * For each current container:
 * - If the container is excluded from submodule output (override.exclude,
 *   aggregator, or root path), its submodule tree should not exist. We remove
 *   any `.drawio` files found there that don't carry user content.
 * - Otherwise, under its `architectureDir` we remove
 *   `components/<compId>/c4-code.drawio` for components no longer in the
 *   container. The container's own `c3-component.drawio` is kept.
 */
export function removeStaleSubmoduleDrawioFiles(
  repoRoot: string,
  model: ArchitectureModel,
  config: Config,
): void {
  if (!config.submodules.enabled) return;

  const aggregators = collectAggregatorIds(model);

  for (const container of model.containers) {
    const override = config.submodules.overrides[container.applicationId];
    const excluded = !!override?.exclude;
    const isAggregator = aggregators.has(container.id);
    const unhosted = excluded || isAggregator || container.path === ".";

    // resolveSubmodulePaths derives the dir from container.path/applicationId,
    // matching what submodule.ts writes — so we clean the same tree either way.
    const { architectureDir } = resolveSubmodulePaths(
      repoRoot,
      container,
      config,
    );
    if (!fs.existsSync(architectureDir)) continue;

    const activeComponentIds = new Set(
      model.components
        .filter((c) => c.containerId === container.id)
        .map((c) => c.id),
    );

    walk(architectureDir, (file) => {
      const rel = path.relative(architectureDir, file);

      // c3-component.drawio lives directly under the architecture dir.
      if (rel === "c3-component.drawio") {
        if (!unhosted) return;
        tryRemove(file, path.relative(repoRoot, file));
        return;
      }

      // c4-code.drawio lives under components/<compId>/.
      const match = /^components[/\\]([^/\\]+)[/\\](.+)$/.exec(rel);
      if (!match) return;
      const [, compId, tail] = match;
      if (tail !== "c4-code.drawio") return;

      const isStaleComponent = unhosted || !activeComponentIds.has(compId);
      if (!isStaleComponent) return;

      tryRemove(file, path.relative(repoRoot, file));
    });
  }
}

function tryRemove(file: string, displayPath: string): void {
  if (hasUserContent(file)) {
    console.error(
      `Warning: ${displayPath} contains user-edited cells — preserved; remove manually if no longer needed.`,
    );
    return;
  }
  fs.rmSync(file);
  console.error(`Removed: ${displayPath}`);
}

function walk(root: string, visit: (file: string) => void): void {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) stack.push(p);
      else if (entry.endsWith(".drawio")) visit(p);
    }
  }
}

function hasUserContent(file: string): boolean {
  try {
    const doc = parseDrawioFile(file);
    for (const cell of doc.cells.values()) {
      if (cell.id === "0" || cell.id === "1") continue;
      if (!cell.managed) return true;
    }
    return false;
  } catch (err) {
    if (err instanceof DrawioParseError) {
      console.error(
        `Warning: ${file} could not be parsed (${err.message}) — preserved; fix the XML by hand.`,
      );
      return true;
    }
    throw err;
  }
}
