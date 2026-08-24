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
  // EVERY published subpath, not just the two that had one. `./http`, `./jobs`
  // and the two manifest entries pointed straight at `src/*.ts` until FUT-446,
  // which this file's own header had already named as the defect: Node refuses
  // to strip types below `node_modules`, so a plain host importing
  // `@12-apps/shift/http` got `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` and
  // could not adopt the surface at all.
  //
  // The quieter half is why it survived a repo full of tests. Where TypeScript
  // IS transformed — vitest, tsx, a bundler — the source entry loads its own
  // copy of `src/errors.ts` while `.` hands out `dist`'s, so a consumer holds
  // TWO `ShiftError` classes and `error instanceof ShiftError` inside
  // `answering()` is false. Every documented refusal then answers 500 instead
  // of the 400/403/404/409 its code earns. The backend harness found it on the
  // first request it made. `splitting: true` below is what makes the fix
  // structural rather than a convention: rollup emits `errors`/`types` once and
  // every entry imports the same chunk.
  entry: {
    index: 'src/index.ts',
    types: 'src/types.ts',
    http: 'src/http.ts',
    jobs: 'src/jobs.ts',
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
  // The build script removes `dist` before tsup starts, matching the other
  // packages here — an entry owning `clean` races its siblings.
  clean: false,
});
