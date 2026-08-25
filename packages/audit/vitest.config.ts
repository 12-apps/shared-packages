import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    /**
     * Vitest's default is 5s per test, and this suite outgrew it.
     *
     * `web-audit` renders the whole trail through the shared DataViews grid
     * (#484 moved it there), so its heaviest case walks four sequential
     * `waitFor` round trips over a full grid render. That is ~630ms alone and
     * 5748ms in the repo-wide run, where the same FILE took 34s against 3.9s
     * on its own — the run was simply busy, and the case died 748ms over the
     * default having done nothing wrong.
     *
     * A suite that passes alone and fails in the repo-wide run is the worst
     * kind of flake to chase, so the legitimately heavy work gets headroom
     * instead. Same number and same reasoning as `auth` and `report-builder`,
     * which each arrived here from an identical failure.
     *
     * Here rather than typed into a spec: the number is a property of what
     * this suite DOES, not of any one case, and a per-assertion timeout is the
     * shape the flakiness gate rejects.
     */
    testTimeout: 20_000,
    // Default to node; React component tests opt into jsdom via a
    // "// @vitest-environment jsdom" comment at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '*.config.ts'],
    },
  },
});
