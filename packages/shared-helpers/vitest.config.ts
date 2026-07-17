import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    environment: 'node',
    // Pin the timezone so date-based assertions are deterministic across hosts
    // (CI and local dev may run in different TZs, e.g. America/Sao_Paulo).
    env: {
      TZ: 'UTC',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
      ],
    },
    setupFiles: ['./tests/setup.ts'],
  },
});
