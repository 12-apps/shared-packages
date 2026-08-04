import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // The integration suite boots a fresh PGlite (WASM Postgres) per test in
    // `beforeEach`. That takes ~1s on an idle machine but comfortably exceeds
    // vitest's 10s default when the whole workspace is running in parallel on a
    // 2-core CI runner — the suite passes in ~10s alone and fails the HOOK, not
    // an assertion. Raise the hook budget rather than the test budget, so a
    // genuinely hanging test still fails fast.
    hookTimeout: 60_000,
  },
});
