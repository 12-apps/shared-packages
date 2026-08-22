/**
 * Compiled entries, for the reason app-shell (12-18), ui (12-51), forms-core,
 * shift, onboarding and notifications all had: Node refuses to strip types
 * below `node_modules`, so `exports` pointing at `./src/**.ts` means a Node host
 * cannot import this package at all.
 *
 * This one is squarely a server package — it answers who may do what — so a Node
 * process is its main consumer, and it is also what `@12-apps/mcp` reaches for.
 * `mcp` could not be compiled while this shipped source: its `dist` would import
 * a `.ts` file and fail in exactly the same way one level down, which is the
 * cascade `forms-core` demonstrated.
 *
 * `splitting: true` keeps the shared permission and role types a SINGLE module
 * across entries. Those values are compared by identity, and without splitting
 * each entry inlines a private copy so anything crossing the boundary stops
 * matching itself.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'next/index': 'src/next/index.ts',
    'server/index': 'src/server/index.ts',
    'hono/index': 'src/hono/index.ts',
    'coverage-gate/index': 'src/coverage-gate/index.ts',
    'manifest/index': 'src/manifest/index.ts',
    'manifest/server': 'src/manifest/server.ts',
},
  format: ['esm'],
  dts: true,
  splitting: true,
  // esbuild renames a class re-exported across chunks (`class _Foo` plus
  // `export { _Foo as Foo }`), and the rename lands on the class's intrinsic
  // `.name`. Any consumer matching on `err.name` — or serialising it into a
  // response — then sees `_Foo`. The backend harness caught exactly that:
  // `expected '_UnknownNotificationTypeError' to be 'UnknownNotificationTypeError'`.
  keepNames: true,
  sourcemap: true,
  // `dist` is removed by the build script before tsup starts — an entry owning
  // `clean` races its siblings.
  clean: false,
});
