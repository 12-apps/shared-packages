import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    environment: 'node',
    // Outside `src` on purpose: `src` is what `tsc` compiles into the shipped `dist`.
    include: ['test/**/*.test.ts'],
  },
});
