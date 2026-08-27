import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cap the worker pool, as every package here does: bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // jsdom for the whole package rather than per-file: the React provider is
    // one of four entries and splitting the environment costs a second config
    // for one suite.
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
  },
});
