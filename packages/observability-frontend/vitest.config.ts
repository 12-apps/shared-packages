import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap the worker pool (see the sibling packages): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // jsdom throughout: every suite here touches either React or `window`.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "*.config.ts"],
    },
  },
});
