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
  },
});
