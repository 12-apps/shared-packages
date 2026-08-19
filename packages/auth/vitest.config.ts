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
    /**
     * Above vitest's 5s default, for the story suite (FUT-873).
     *
     * `stories-render.test.tsx` MOUNTS each story — a full MUI tree, its theme
     * and the play function — and each one legitimately takes 3–5s. That fits
     * under the default until `turbo run test` starts ~27 package suites at
     * once on a cold cache, where the first story crossed 5141ms and the whole
     * file went red. Nothing about the package was wrong; the run was simply
     * busy, and a suite that passes alone and fails in the repo-wide run is the
     * worst kind of flake to chase.
     *
     * Here rather than typed into a spec: the number is a property of what this
     * suite DOES, not of any one case, and a per-assertion timeout is the shape
     * the flakiness gate rejects.
     */
    testTimeout: 20_000,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/"],
    },
  },
});
