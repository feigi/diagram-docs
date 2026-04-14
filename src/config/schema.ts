import { z } from "zod";

export const configSchema = z.object({
  system: z
    .object({
      name: z.string().default("My System"),
      description: z.string().default(""),
    })
    .default({}),

  type: z.enum(["container", "library"]).optional(),

  scan: z
    .object({
      include: z.array(z.string()).default(["**"]),
      exclude: z
        .array(z.string())
        .default([
          "**/*test*/**",
          "**/*test*",
          "**/build/**",
          "**/*.worktree/**",
          "**/*.worktrees/**",
          "**/.worktrees/**",
        ]),
      /** Patterns that override built-in excludes, forcing matched paths to be scanned. */
      forceInclude: z.array(z.string()).default([]),
    })
    .default({}),

  levels: z
    .object({
      context: z.boolean().default(true),
      container: z.boolean().default(true),
      component: z.boolean().default(true),
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
    })
    .default({}),

  output: z
    .object({
      dir: z.string().default("docs/architecture"),
      theme: z.number().default(0),
      layout: z.string().default("elk"),
      format: z.enum(["svg", "png"]).default("svg"),
      /** Timeout in seconds for rendering a single D2 file to SVG/PNG. */
      renderTimeout: z.number().int().min(10).default(120),
    })
    .default({}),

  externalSystems: z
    .array(
      z.object({
        name: z.string(),
        technology: z.string().optional(),
        /** Which container IDs use this system (creates relationships) */
        usedBy: z.array(z.string()).optional(),
      }),
    )
    .default([]),

  llm: z
    .object({
      provider: z.enum(["auto", "claude-code", "copilot"]).default("auto"),
      model: z.string().default("default"),
      /** Max parallel LLM calls for per-app architecture modeling */
      concurrency: z.number().int().min(1).max(16).default(10),
    })
    .default({}),

  submodules: z
    .object({
      enabled: z.boolean().default(true),
      docsDir: z.string().default("docs"),
      overrides: z
        .record(
          z.string(),
          z.object({
            docsDir: z.string().optional(),
            exclude: z.boolean().optional(),
          }),
        )
        .default({}),
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
