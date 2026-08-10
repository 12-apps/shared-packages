import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // Vitest's default is 5s per test. The React editor suites render the whole
    // canvas through `openEditor()` — sixteen times in `keyboard-reorder` alone
    // — which is comfortably under that locally (~740ms) and not under CI load:
    // one of them timed out on a run whose collect phase alone took 81s. The
    // work is legitimately heavy, so it gets headroom rather than the suite
    // getting a flake nobody can reproduce.
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
