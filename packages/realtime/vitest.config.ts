import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // Default to node; the browser-half tests opt into jsdom via a
    // "// @vitest-environment jsdom" comment at the top of the file (the rbac
    // precedent) — most of this package is server-side and must not pay for a DOM.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "*.config.ts"],
    },
  },
});
