import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // Default to node; React component tests opt into jsdom via a
    // "// @vitest-environment jsdom" comment at the top of the file.
    environment: 'node',
    // React renders here are well inside the 5s default locally and outside it on a
    // contended runner: the whole-workspace run on main timed out a first render
    // twice in a row (FUT-5315, discounts then ui) while every sibling passed. Same
    // bound as @12-apps/auth, notifications and report-builder; a hang still fails.
    testTimeout: 20_000,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '*.config.ts'],
    },
  },
});
