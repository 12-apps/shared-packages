import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { glob } from 'glob';

// Plain JS on purpose: `tsconfig.json` sets `rootDir: src` so that
// `tsc --emitDeclarationOnly` mirrors the source tree into `dist/types`, and a
// `.ts` file outside that root breaks the program the moment anything imports
// it. Both callers — the tsup config and the completeness test beside it — read
// this fine as JS, and the package's own scripts are `.mjs` already.

/**
 * The build entry map: every PUBLIC subpath, plus every other source module.
 *
 * The public half comes from `entries.json` and is unchanged — the key decides
 * the output path, so `button` stays `dist/button.js` and the generated exports
 * map keeps pointing at a file that exists.
 *
 * The second half is what stops a consumer paying for a component it did not
 * ask for. tsup BUNDLES an entry: every module reachable from
 * `navigation/AppHeader/index.ts` — the bar, its brand row, its identity row and
 * the details PANEL behind its disclosure — used to be flattened into one
 * `dist/navigation/AppHeader.js`. Once they are one module, a bundler cannot
 * separate them: a host that renders only the bar still ships the panel, and
 * through it the sheet, the dialog and some fifty `@mui/material` component
 * modules underneath. That is not a tree-shaking failure, it is a module
 * boundary that no longer exists to shake along.
 *
 * `@mui/material` is the shape to copy, and the reason its own root barrel
 * shakes cleanly for us: one component per module, `sideEffects` declared, and a
 * barrel that only re-exports. Naming every source file as an entry gives this
 * package the same property — esbuild emits each one separately and each public
 * barrel IMPORTS its parts instead of inlining them, so an unused re-export is
 * an unused module and disappears.
 *
 * Internal entries are namespaced under `_internal/` and are not in the exports
 * map: they are reachable only through the relative imports the barrels already
 * emit, so this changes what `dist` looks like and not what the package offers.
 *
 * A file that is ALREADY a public entry is skipped rather than added twice.
 * Listing one module under two names is how a build ends up emitting two copies
 * of it, which is precisely the duplicate-context failure `splitting: true`
 * exists to prevent.
 */
/**
 * @param {string} packageRoot absolute path to this package
 * @returns {Record<string, string>} tsup's entry map: output name -> source file
 */
export function buildEntries(packageRoot) {
  // `packageRoot` is passed in rather than derived, and both callers pass an
  // ABSOLUTE path. knip loads the tsup config to discover entry points and runs
  // it from the repo root, where a relative 'entries.json' is ENOENT — which
  // fails the whole static-gates job, not just knip.
  /** @type {Record<string, string>} */
  const publicEntries = JSON.parse(readFileSync(join(packageRoot, 'entries.json'), 'utf8'));

  const claimed = new Set(Object.values(publicEntries));
  /** @type {Record<string, string>} */
  const entries = { ...publicEntries };

  const sources = glob.sync('src/**/*.{ts,tsx}', {
    cwd: packageRoot,
    posix: true,
    ignore: [
      // Not shipped, and each would pull a test runner or Storybook into dist.
      // Matched on the whole suffix rather than on an exact extension: this
      // tree also holds `*.stories.server.ts`, and a list of precise names is
      // one naming convention away from letting the next variant through.
      'src/**/*.stories.*',
      'src/**/*.test.*',
      'src/**/__tests__/**',
      'src/**/*.d.ts',
    ],
  });

  for (const source of sources) {
    if (claimed.has(source)) continue;
    entries[`_internal/${source.replace(/^src\//, '').replace(/\.tsx?$/, '')}`] = source;
  }

  return entries;
}
