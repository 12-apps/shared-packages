import { defineConfig } from 'vitest/config';

/**
 * The package's unit lane. Every suite injects a fake SDK client and replays
 * recorded provider responses, so nothing here reaches a network or a key.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
