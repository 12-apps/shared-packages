/**
 * ONE entry, and it is the only thing in this package that is compiled.
 *
 *   ./vite → Node → compiled ESM
 *
 * Everything else ships as TypeScript SOURCE, like its siblings here, because
 * application code is compiled by the consumer's bundler and raw `.ts` under
 * `node_modules` is fine there. A `vite.config.ts` is not application code:
 * Vite bundles it with esbuild while leaving BARE specifiers external, so this
 * import is resolved and executed by Node — and Node refuses to strip types
 * below `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
 *
 * It does NOT refuse while this is a workspace sibling, because pnpm links it
 * and the realpath falls outside `node_modules`. So the failure appears only
 * after publishing — which is exactly the class of bug the harness exists to
 * catch, and why `@12-apps/observability-frontend` ships its own `./vite` the
 * same way.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'vite/index': 'src/vite/index.ts' },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  // The build script removes `dist` once, before tsup starts, rather than
  // letting an entry own it — see observability-frontend's tsup.config.ts for
  // the race that taught this repo the difference.
  clean: false,
  // The consumer's: `vite` supplies only the `DepOptimizationOptions` type.
  external: ['vite'],
});
