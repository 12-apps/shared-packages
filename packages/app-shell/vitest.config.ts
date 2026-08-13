import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The AUTOMATIC JSX runtime, for dependencies as well as for this package.
  //
  // `@12-apps/ui` and `@12-apps/observability-frontend` publish `.tsx` SOURCE, so their
  // JSX is compiled by whoever consumes them. An app gets that for free from
  // `@vitejs/plugin-react`; vitest here runs without it, and esbuild then falls back to
  // the CLASSIC transform for anything it has no tsconfig for — everything under
  // `node_modules` — emitting code that references a bare `React` nothing imported.
  // The boundary then dies with `ReferenceError: React is not defined`.
  esbuild: { jsx: 'automatic' },
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    globals: true,
    // Default to node; the browser-half tests opt into jsdom via a
    // "// @vitest-environment jsdom" comment at the top of the file (the rbac
    // precedent) — the core, server and vite halves must not pay for a DOM.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '*.config.ts'],
    },
  },
});
