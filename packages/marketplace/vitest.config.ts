import { defineConfig } from 'vitest/config';

/**
 * The package's unit lane. No aliases, no setup file: every suite builds its
 * ports by hand (an in-memory db, a recording http client, a fixed clock), so
 * nothing in the graph reaches a database, a network or a host module.
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
