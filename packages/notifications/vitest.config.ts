import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // The React suites here render a panel and wait for it, which is well
    // inside the 5s default locally (the live-activities file's slowest case
    // is ~0.8s) and outside it on a contended CI runner — where that one case
    // timed out on an unrelated pull request while its own 271 siblings
    // passed. `@12-apps/auth` and `@12-apps/report-builder` raised the bound
    // for the same reason; this is the same number, for the same shape of
    // suite. A test that genuinely hangs still fails, four seconds later.
    testTimeout: 20_000,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '*.config.ts'],
    },
  },
});
