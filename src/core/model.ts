import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ArchitectureModel } from "../analyzers/types.js";

export const architectureModelSchema = z.object({
  version: z.literal(1),
  system: z.object({
    name: z.string(),
    description: z.string(),
  }),
  actors: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
  externalSystems: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        technology: z.string().optional(),
      }),
    )
    .default([]),
  containers: z
    .array(
      z.object({
        id: z.string(),
        applicationId: z.string(),
        name: z.string(),
        description: z.string(),
        technology: z.string(),
        path: z.string().optional(),
      }),
    )
    .default([]),
  components: z
    .array(
      z.object({
        id: z.string(),
        containerId: z.string(),
        name: z.string(),
        description: z.string(),
        technology: z.string(),
        moduleIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  relationships: z
    .array(
      z.object({
        sourceId: z.string(),
        targetId: z.string(),
        label: z.string(),
        technology: z.string().optional(),
      }),
    )
    .default([]),
});

export function loadModel(modelPath: string): ArchitectureModel {
  const raw = fs.readFileSync(modelPath, "utf-8");
  const parsed = parseYaml(raw);
  return architectureModelSchema.parse(parsed) as ArchitectureModel;
}
