import type { ArchitectureModel } from "../../analyzers/types.js";
import { projectComponent } from "../projection/component.js";
import { cellsFromSpec, type DiagramCells } from "./context.js";

export function emitComponentCells(
  spec: ReturnType<typeof projectComponent>,
): DiagramCells {
  return cellsFromSpec(spec);
}

export function buildComponentCells(
  model: ArchitectureModel,
  containerId: string,
): DiagramCells {
  return emitComponentCells(projectComponent(model, containerId));
}
