import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    // jsdom for `device-detection`, which reads `navigator`/`window`. The React
    // plugin and the jest-dom setup went with the `next-auth/react` hooks and
    // provider this package no longer ships (FUT-665).
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/"],
    },
  },
});
