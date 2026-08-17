/**
 * Both entries ship COMPILED, for the reason `@12-apps/app-shell` (12-18) and
 * `@12-apps/ui` (12-51) already established: Node refuses to strip types below
 * `node_modules`, so a package whose `exports` point at `./src/*.ts` cannot be
 * imported from a real Node process at all
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
 *
 * This one is a SERVER package — the shift service, its auto-close sweep and its
 * errors — so a Node host is its main consumer, not an incidental one.
 *
 * What hides the defect until publication is that nothing in this repository is
 * that consumer: pnpm links a workspace sibling, whose realpath falls outside
 * `node_modules` where stripping is allowed; Vitest transforms the specs; a
 * bundler compiles the SPAs; a type-check never executes. `@12-apps/forms-core`
 * had exactly this and was only found once `ui` compiled and its `dist` reached
 * for it from a bare consumer fixture.
 *
 * `splitting: true` is not a size optimisation here. `.` and `./types` share
 * `src/types.ts`, and the shift status/error values are compared by identity;
 * without splitting each entry inlines a private copy and a value crossing the
 * boundary stops matching itself. With it, rollup emits the shared module once
 * and both entries import the same chunk, so the guarantee is structural rather
 * than a convention someone has to remember.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', types: 'src/types.ts' },
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  // The build script removes `dist` before tsup starts, matching the other
  // packages here — an entry owning `clean` races its siblings.
  clean: false,
});
