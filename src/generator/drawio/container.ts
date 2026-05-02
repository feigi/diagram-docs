import type { ArchitectureModel } from "../../analyzers/types.js";
import type { DiagramSpec } from "../projection/types.js";
import { projectContainer } from "../projection/container.js";
import { flushProjectionWarnings } from "../projection/index.js";
import { cellsFromSpec, type DiagramCells } from "./context.js";

export function emitContainerCells(spec: DiagramSpec): DiagramCells {
  return cellsFromSpec(spec);
}

export function buildContainerCells(model: ArchitectureModel): DiagramCells {
  const spec = projectContainer(model);
  flushProjectionWarnings(spec.warnings);
  return emitContainerCells(spec);
}
