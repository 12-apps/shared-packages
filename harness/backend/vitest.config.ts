import { defineConfig } from 'vitest/config';

// No aliases. The packages under test must resolve as a consumer's would —
// out of node_modules, from the tarball — or the harness is testing the
// workspace it exists to look past.
// `hookTimeout` matches `testTimeout` because the hooks here do the same class of
// work the tests do: almost every suite's `beforeAll` calls `createHarnessBackend`,
// which applies TWELVE packages' migrations into a fresh PGlite. Vitest's hook
// default is 10s regardless of `testTimeout`, and with 35 suites provisioning in
// parallel that budget is now the tightest thing in the run — observed as
// `tests/harness-server.test.ts` timing out in its `beforeAll` on one run and
// passing in 3.5s alone on the next. A flaky red here reads as a broken package,
// which is the one thing this harness must never say by accident.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
