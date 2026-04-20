import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import {
  collectAggregatorIds,
  resolveSubmodulePaths,
} from "../d2/submodule-scaffold.js";
import { buildComponentCells } from "./component.js";
import { buildCodeCells } from "./code.js";
import { generateDrawioFile } from "./index.js";

export async function generateSubmoduleDrawio(
  repoRoot: string,
  model: ArchitectureModel,
  config: Config,
): Promise<void> {
  const aggregators = collectAggregatorIds(model);
  for (const container of model.containers) {
    if (config.submodules.overrides[container.applicationId]?.exclude) continue;
    if (aggregators.has(container.id)) continue;
    if (container.path === ".") continue;

    const { architectureDir } = resolveSubmodulePaths(
      repoRoot,
      container,
      config,
    );

    if (config.levels.component) {
      const cells = buildComponentCells(model, container.id);
      await generateDrawioFile({
        filePath: path.join(architectureDir, "c3-component.drawio"),
        diagramName: `L3 - ${container.name}`,
        level: "component",
        cells,
      });
    }

    if (config.levels.code) {
      const counts = new Map<string, number>();
      for (const e of model.codeElements ?? []) {
        if (e.containerId !== container.id) continue;
        counts.set(e.componentId, (counts.get(e.componentId) ?? 0) + 1);
      }
      for (const comp of model.components.filter(
        (c) => c.containerId === container.id,
      )) {
        if ((counts.get(comp.id) ?? 0) < config.code.minElements) continue;
        const cells = buildCodeCells(model, comp);
        await generateDrawioFile({
          filePath: path.join(
            architectureDir,
            "components",
            comp.id,
            "c4-code.drawio",
          ),
          diagramName: `L4 - ${comp.name}`,
          level: "code",
          cells,
        });
      }
    }
  }
}
