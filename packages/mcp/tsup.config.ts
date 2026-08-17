/**
 * The last of the compiled-entries conversions, and the one that could not be
 * done first. Node refuses to strip types below `node_modules`, so `exports`
 * pointing at `./src/**.ts` meant no Node host could import this package —
 * and `./hono` exists purely to be mounted in one.
 *
 * The ORDER mattered. This package depends on `@12-apps/rbac`, `@12-apps/onboarding`
 * and `@12-apps/ui`, and while any of those shipped source, compiling this one
 * would only move the failure down a level: our `dist` would import their `.ts`
 * and fail identically. That is the cascade `forms-core` exposed in #226, where
 * compiling `ui` was what finally made the inner defect reachable. All three
 * landed first, deliberately, so this conversion is the end of a chain rather
 * than another red PR.
 *
 * `splitting: true` keeps the shared types, the surface lock and the tool
 * registry a SINGLE module across entries. The registry is compared and mutated
 * by identity, so a private copy per entry would give `./hono` and `./generate`
 * two different registries with one name.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'oauth/index': 'src/oauth/index.ts',
    'hono/index': 'src/hono/index.ts',
    'coverage-gate/index': 'src/coverage-gate/index.ts',
    'generate/index': 'src/generate/index.ts'
},
  format: ['esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  // `dist` is removed by the build script before tsup starts.
  clean: false,
});
