import type { ArchitectureModel } from "../../analyzers/types.js";
import type { DiagramSpec } from "../projection/types.js";
import { projectComponent } from "../projection/component.js";
import { flushProjectionWarnings } from "../projection/index.js";
import { cellsFromSpec, type DiagramCells } from "./context.js";

export function emitComponentCells(spec: DiagramSpec): DiagramCells {
  return cellsFromSpec(spec);
}

export function buildComponentCells(
  model: ArchitectureModel,
  containerId: string,
): DiagramCells {
  const spec = projectComponent(model, containerId);
  flushProjectionWarnings(spec.warnings);
  return emitComponentCells(spec);
}
