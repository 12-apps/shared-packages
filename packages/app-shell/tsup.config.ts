/**
 * EVERY consumer entry is compiled, and that is a correction (12-18).
 *
 * It used to be `./vite` alone, on the reasoning that everything else is
 * application code, application code is compiled by the consumer's bundler, and
 * raw `.ts` under `node_modules` is therefore fine. That was right about
 * bundlers and wrong about who the consumers are: `./server` and `./hono` exist
 * to be mounted in a **Node** process, and Node refuses to strip types below
 * `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). So does `.`,
 * the moment a backend reads `formatBRL` or `ApiError` from it.
 *
 * The old note in this file predicted the failure word for word — for `./vite`
 * — without noticing it applied to three more entries. It is invisible until
 * PUBLISH, because pnpm links a workspace sibling and the realpath then falls
 * outside `node_modules`, where stripping is allowed. It is equally invisible to
 * anything that goes through a bundler: Vite compiles the SPAs, Vitest transforms
 * the specs, and a type-check never executes. The first adopter met it in the one
 * lane that boots a real Node server against real resolution.
 *
 * ## `splitting: true` is load-bearing, not a size optimisation
 *
 * `ApiError` is compared with `instanceof` at ~20 call sites in that adopter, and
 * that is sound only while `.` and `./react` resolve to ONE `core/api` module.
 * Compiling some entries and leaving others as source breaks precisely that: the
 * root's class and the react tree's class become two classes with one name, and
 * every `instanceof` across the boundary answers false. Compiling all of them
 * WITHOUT splitting does the same thing one layer down, by inlining a private
 * copy of `core/api` into each entry.
 *
 * With splitting, rollup emits a shared module once and every entry imports the
 * same chunk — so the guarantee is structural rather than a convention someone
 * has to remember. The check is one line after a build:
 * `grep -rl "class ApiError" dist` must name exactly one file.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'server/index': 'src/server/index.ts',
    'hono/index': 'src/hono/index.ts',
    'vite/index': 'src/vite/index.ts',
  },
  format: ['esm'],
  dts: true,
  // See the docstring: this is what keeps `core/api` a single module across
  // entries, and with it the `instanceof ApiError` contract.
  splitting: true,
  sourcemap: true,
  // The build script removes `dist` once, before tsup starts, rather than
  // letting an entry own it — see observability-frontend's tsup.config.ts for
  // the race that taught this repo the difference.
  clean: false,
  // The consumer's: `vite` supplies only the `DepOptimizationOptions` type.
  // Everything else stays external through `dependencies` / `peerDependencies`,
  // which tsup externalises by default — a bundled copy of `@12-apps/ui` would be
  // a second design system, and of `react` a second renderer.
  external: ['vite'],
});
