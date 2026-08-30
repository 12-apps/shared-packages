import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap the worker pool (see the sibling packages): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // jsdom because the scan half touches `navigator`, `window` and a canvas.
    // The pdf half is pure arithmetic and does not care either way.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "*.config.ts"],
    },
  },
});
