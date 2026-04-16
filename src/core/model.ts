import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ArchitectureModel } from "../analyzers/types.js";

const codeMemberSchema = z.discriminatedUnion("kind", [
  z.object({
    name: z.string(),
    kind: z.literal("field"),
    signature: z.string().optional(),
    visibility: z.enum(["public", "internal", "private"]).optional(),
  }),
  z.object({
    name: z.string(),
    kind: z.literal("method"),
    signature: z.string(),
    visibility: z.enum(["public", "internal", "private"]).optional(),
  }),
]);

const codeElementSchema = z.object({
  id: z.string(),
  componentId: z.string(),
  containerId: z.string(),
  kind: z.enum([
    "class",
    "interface",
    "enum",
    "type",
    "function",
    "struct",
    "typedef",
  ]),
  name: z.string(),
  visibility: z.enum(["public", "internal", "private"]).optional(),
  members: z.array(codeMemberSchema).optional(),
  tags: z.array(z.string()).optional(),
});

const codeRelationshipSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  targetName: z.string().optional(),
  kind: z.enum(["inherits", "implements", "uses", "contains"]),
  label: z.string().optional(),
});

export const architectureModelSchema = z
  .object({
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
          tags: z.array(z.string()).optional(),
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
    codeElements: z.array(codeElementSchema).optional(),
    codeRelationships: z.array(codeRelationshipSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.codeElements?.length && !data.codeRelationships?.length) return;
    const componentById = new Map(data.components.map((c) => [c.id, c]));
    const codeElementIds = new Set((data.codeElements ?? []).map((e) => e.id));
    for (const [idx, el] of (data.codeElements ?? []).entries()) {
      const comp = componentById.get(el.componentId);
      if (!comp) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeElements", idx, "componentId"],
          message: `codeElement.componentId "${el.componentId}" does not match any components[].id`,
        });
        continue;
      }
      if (comp.containerId !== el.containerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeElements", idx, "containerId"],
          message: `codeElement.containerId "${el.containerId}" does not match component "${el.componentId}"'s containerId "${comp.containerId}"`,
        });
      }
    }
    for (const [idx, rel] of (data.codeRelationships ?? []).entries()) {
      if (!codeElementIds.has(rel.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeRelationships", idx, "sourceId"],
          message: `codeRelationship.sourceId "${rel.sourceId}" not found in codeElements (relationship sources must be internal)`,
        });
      }
    }
  });

export function loadModel(modelPath: string): ArchitectureModel {
  const raw = fs.readFileSync(modelPath, "utf-8");
  const parsed = parseYaml(raw);
  return architectureModelSchema.parse(parsed) as ArchitectureModel;
}
