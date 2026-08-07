import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap the worker pool (see packages/product-research-ui): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // Default to node — the MCP core is server-side. The React tests under
    // src/react opt into jsdom via a "// @vitest-environment jsdom" comment.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "*.config.ts"],
    },
  },
});
