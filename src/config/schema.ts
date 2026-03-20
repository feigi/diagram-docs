import { z } from "zod";

export const configSchema = z.object({
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
    })
    .default({}),

  levels: z
    .object({
      context: z.boolean().default(true),
      container: z.boolean().default(true),
      component: z.boolean().default(false),
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
    })
    .default({}),
});

export type Config = z.infer<typeof configSchema>;
