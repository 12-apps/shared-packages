import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // Everything here runs in a main process, never a renderer. A suite that
    // needed a DOM would be testing the wrong half.
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "*.config.ts"],
    },
  },
});
