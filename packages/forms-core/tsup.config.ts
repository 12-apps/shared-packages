/**
 * This leaf ships COMPILED, for the same reason `@12-apps/app-shell` does (12-18).
 *
 * It used to export `./src/index.ts` directly, and the description called that
 * "consumed from source by @12-apps/ui and apps" as though it were a design.
 * It was not — Node refuses to strip types below `node_modules`, so any consumer
 * reaching this package from a real Node process gets
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on `src/index.ts`.
 *
 * What made it invisible is that the FIRST consumer to hit it is not this
 * package's own tests. pnpm links a workspace sibling, and the realpath then
 * falls outside `node_modules`, where stripping is allowed; Vitest transforms
 * the specs; a bundler compiles the SPAs; a type-check never executes. The
 * failure surfaced only once `@12-apps/ui` compiled its own entries and its
 * `dist/form/CepField.js` imported this package from a bare consumer fixture —
 * two levels of the same defect, and the outer one had to be fixed first to
 * reveal the inner one.
 *
 * `splitting` is off and there is one entry, so the app-shell note about a
 * shared chunk keeping `instanceof` sound does not apply here: nothing in this
 * package is compared by identity across entries, because there is only one.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  // Preserve class and function `.name` through minification/renaming — a
  // consumer matching on `err.name` must not see esbuild's internal alias.
  keepNames: true,
  sourcemap: true,
  // The build script removes `dist` before tsup starts, matching the other
  // packages here — an entry owning `clean` races its siblings.
  clean: false,
});
