import { z } from "zod";

export const roleEnum = z.enum(["system", "container", "component", "code-only", "skip"]);

export const configSchema = z
  .object({
    system: z
      .object({
        name: z.string().default("My System"),
        description: z.string().default(""),
      })
      .default({}),

    scan: z
      .object({
        include: z.array(z.string()).default(["**"]),
        exclude: z
          .array(z.string())
          .default([
            "**/test/**",
            "**/tests/**",
            "**/node_modules/**",
            "**/build/**",
            "**/dist/**",
            "**/target/**",
          ]),
        maxDepth: z.number().int().min(1).default(25),
      })
      .default({}),

    agent: z
      .object({
        enabled: z.boolean().default(true),
        provider: z.enum(["anthropic", "openai"]).default("anthropic"),
        model: z.string().default("claude-sonnet-4-20250514"),
      })
      .default({}),

    abstraction: z
      .object({
        granularity: z
          .enum(["detailed", "balanced", "overview"])
          .default("balanced"),
        excludePatterns: z
          .array(z.string())
          .default(["logging", "metrics", "middleware", "config", "utils"]),
        codeLevel: z
          .object({
            minSymbols: z.number().int().min(0).default(2),
          })
          .default({}),
      })
      .default({}),

    output: z
      .object({
        docsDir: z.string().default("docs"),
        theme: z.number().default(0),
        layout: z.enum(["dagre", "elk", "tala"]).default("elk"),
        format: z.enum(["svg", "png"]).default("svg"),
      })
      .default({}),

    overrides: z
      .record(
        z.string(),
        z.object({
          role: roleEnum.optional(),
          name: z.string().optional(),
          description: z.string().optional(),
          docsDir: z.string().optional(),
        }),
      )
      .default({}),
  })
  .strip();

export type Config = z.infer<typeof configSchema>;
export type FolderRole = z.infer<typeof roleEnum>;
