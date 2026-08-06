import { defineConfig } from 'vitest/config';

// No aliases. The packages under test must resolve as a consumer's would —
// out of node_modules, from the tarball — or the harness is testing the
// workspace it exists to look past.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
