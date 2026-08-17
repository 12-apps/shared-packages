/**
 * Every entry ships COMPILED, for the reason app-shell (12-18), ui (12-51) and
 * forms-core established: Node refuses to strip types below `node_modules`, so
 * `exports` pointing at `./src/**.ts` means a Node host cannot import this
 * package at all (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
 *
 * `./server` and `./hono` exist precisely to be mounted in a Node process, so
 * this was not a latent risk for them — it was a guarantee of failure, hidden
 * only because nothing in this repository is that consumer: pnpm links a
 * workspace sibling whose realpath falls outside `node_modules` where stripping
 * IS allowed, Vitest transforms the specs, a bundler compiles the SPAs, and a
 * type-check never executes.
 *
 * `splitting: true` is load-bearing rather than a size optimisation. These
 * entries share `src/types.ts` and the wire schemas under it, and values from
 * them cross the boundary between `.` and `./server`. Without splitting each
 * entry inlines a private copy, and anything compared by identity across that
 * line stops matching itself. With it, rollup emits the shared module once and
 * every entry imports the same chunk — structural rather than a convention.
 *
 * Dependencies and peers are externalised by tsup already, which is what keeps
 * `@12-apps/ui` and `react` single copies rather than bundled second ones.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'hono/index': 'src/hono/index.ts'
},
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  // The build script removes `dist` before tsup starts — an entry owning
  // `clean` races its siblings.
  clean: false,
});
