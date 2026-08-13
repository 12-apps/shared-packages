import type { DepOptimizationOptions } from 'vite';

/**
 * Dependency pre-bundling for a Vite SPA that installs `@12-apps/*` from npm.
 *
 * ## The blank page this closes
 *
 * `@12-apps/ui` is an npm dependency of every SPA here. Its `exports` map points
 * every subpath at the package's own
 * TypeScript SOURCE rather than at `dist`. For 121 of its 124 subpaths that is
 * harmless — they end in `.ts`, and Vite pre-bundles them like any other
 * dependency. Three do not:
 *
 *     './button'              => './src/button.tsx'
 *     './social-login-button' => './src/social-login-button.tsx'
 *     './user-avatar'         => './src/user-avatar.tsx'
 *
 * Vite decides what it may pre-bundle with `OPTIMIZABLE_ENTRY_RE`, which is
 * `/\.[cm]?[jt]s$/` — it matches `.js`/`.mjs`/`.cjs`/`.ts`/`.mts`/`.cts` and
 * **not `.tsx`**. So those three alone are served as raw source, and Vite
 * follows their imports as source too: the whole `@mui/material` barrel, then
 * `@emotion/react`, then the CJS-only leaves underneath it. A CJS file handed
 * to the browser as ESM has no default export, so the first one evaluated
 * throws and React never mounts:
 *
 *     The requested module 'hoist-non-react-statics.cjs.js'
 *     does not provide an export named 'default'
 *
 * The page is blank, `#root` has zero children, and nothing in the build logs
 * says so — it is a runtime error in the browser. It took out 41
 * e2e specs, none of which touch the three components involved.
 *
 * ## Why `extensions` and not `include`
 *
 * `optimizeDeps.include` fixes the symptom one package at a time: naming
 * `@mui/material` + `@emotion/*` clears the emotion crash and reveals the next
 * CJS leaf under it (`react-is`, which fails identically on
 * `isValidElementType`). The list would have to enumerate the transitive CJS
 * closure of the MUI barrel and stay correct as it moves.
 *
 * `extensions` fixes the cause. It is the second half of Vite's own check —
 * `isOptimizable()` is `OPTIMIZABLE_ENTRY_RE.test(id) || extensions.some(...)`
 * — so adding `.tsx` makes those three entries pre-bundlable, and esbuild then
 * bundles their whole graph with the CJS interop it always applies. Nothing
 * downstream has to be named, so a fourth `.tsx` subpath needs no edit here.
 *
 * ## Why this is not `@12-apps/ui`'s fix
 *
 * It is, and it was also fixed there — those three were stragglers, since every
 * component under `src/components/**` already exports through an `index.ts`
 * barrel that re-exports the `.tsx`. But the fix has to hold for the versions
 * ALREADY published, and any consumer of any package that ships a `.tsx` entry
 * hits this same edge. Keeping it here means a host is correct regardless of
 * which version of the library it resolves.
 *
 * ## Status of the three stragglers
 *
 * Upstream fixed the three stragglers: every subpath now resolves to `.ts`, so
 * nothing a current install NEEDS the extension for. It is retained anyway,
 * deliberately.
 *
 * What it prevents is a blank page with a clean build log — no build error, no
 * failing test, just an app that does not render. That is expensive to
 * rediscover, and the extension costs nothing to carry: it only widens the set
 * of entries Vite is willing to pre-bundle. Pins get bumped routinely, and a
 * future version re-introducing a `.tsx` subpath must not be able to reach
 * production through this door a second time.
 *
 * The companion test asserting the extension was still REQUIRED is gone, since
 * its premise no longer holds. The one beside it — 'can pre-bundle every subpath
 * @12-apps/ui exports' — stays, and still fails on any future subpath that
 * neither Vite's own rule nor this list can take.
 */
export function appShellOptimizeDeps(): DepOptimizationOptions {
  return { extensions: ['.tsx'] };
}
