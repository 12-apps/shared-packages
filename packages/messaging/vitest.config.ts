import { defineConfig } from 'vitest/config';

/**
 * The package's unit lane. No aliases, no setup file: every suite builds its
 * ports by hand (an in-memory store, a recording fetch, a fixed clock), and
 * the Postgres suite boots its own in-memory PGlite, so nothing in the graph
 * reaches a network or a host module.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    environment: 'node',
    env: { TZ: 'UTC' },
    include: ['src/**/*.test.ts'],
    // The Postgres suites boot and migrate their own PGlite inside a test;
    // under the whole package's load on main that took more than vitest's
    // default 5 s (opt-out-race, FUT-3735). Same budget as auth/notifications.
    testTimeout: 20_000,
  },
});
