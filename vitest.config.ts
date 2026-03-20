import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: ".",
    include: ["tests/**/*.test.ts"],
    benchmark: {
      include: ["tests/bench/**/*.bench.ts"],
      outputJson: "./bench-results.json",
    },
  },
});
