import type { ArchitectureModel } from "../../analyzers/types.js";
import { projectContainer } from "../projection/container.js";
import { cellsFromSpec, type DiagramCells } from "./context.js";

export function emitContainerCells(
  spec: ReturnType<typeof projectContainer>,
): DiagramCells {
  return cellsFromSpec(spec);
}

export function buildContainerCells(model: ArchitectureModel): DiagramCells {
  return emitContainerCells(projectContainer(model));
}
