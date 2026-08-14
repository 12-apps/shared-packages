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
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/__tests__/setup.ts'],
    // Above the 15s `asyncUtilTimeout` that setup file installs, so a query
    // that never resolves reports as Testing Library's error — naming the
    // selector and dumping the DOM — rather than as vitest's generic 5s
    // "Test timed out", which says nothing about what was being waited for.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '*.config.ts'],
    },
  },
});
