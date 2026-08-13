/**
 * A Vite host must be able to pre-bundle every `@12-apps/ui` subpath (FUT-737).
 *
 * This is the guard for a failure with no build-time signal: a subpath Vite
 * refuses to optimize is served as raw source, its imports are followed as
 * source too, and the first CJS leaf under them throws in the browser. The
 * page is blank and the build log is clean. See `../index.ts`.
 *
 * The assertion is derived, not written down: it reads the LIVE `exports` map
 * of the installed `@12-apps/ui` and re-implements Vite's own optimizability
 * check against it. A new `.tsx` (or `.jsx`, or anything else Vite won't take)
 * subpath in a future version of the library fails this test on the version
 * bump — which is the commit that would otherwise ship the blank page.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { appShellOptimizeDeps } from '../index';

/**
 * Vite's own rule, copied from `vite/dist/node/constants.js`:
 *
 *   const OPTIMIZABLE_ENTRY_RE = /\.[cm]?[jt]s$/;
 *   isOptimizable = (id, o) => OPTIMIZABLE_ENTRY_RE.test(id)
 *                           || o.extensions?.some((e) => id.endsWith(e))
 *
 * Copied rather than imported because it is not part of Vite's public API.
 * A Vite upgrade that widens it makes this test stricter than reality, which
 * fails safe: the extension stays configured and nothing breaks.
 */
const OPTIMIZABLE_ENTRY_RE = /\.[cm]?[jt]s$/;

const require_ = createRequire(import.meta.url);

/**
 * The installed `@12-apps/ui`'s manifest — resolved through its OWN `exports`
 * map, so the version under test is the one a host actually gets.
 *
 * `./package.json` is not itself exported, so the manifest is reached from a
 * subpath that is: `./mui/Box` maps to `./src/mui/Box.ts`, three levels below
 * the package root. Requiring that root by ABSOLUTE path bypasses the exports
 * map (it only gates bare specifiers), and `require` of JSON keeps this off
 * `fs` — the anti-flake rule bans an unmocked `readFileSync` in a test, and
 * the sibling guard in the library's own repo is built the same way.
 *
 * The `name` assertion below is what makes the hard-coded depth safe: if the
 * layout ever moves, this fails loudly instead of silently reading the wrong
 * manifest.
 */
function uiManifest(): { exports?: Record<string, unknown> } {
  const boxEntry = require_.resolve('@12-apps/ui/mui/Box'); // <root>/src/mui/Box.ts
  const root = dirname(dirname(dirname(boxEntry)));
  const parsed = require_(join(root, 'package.json')) as {
    name?: string;
    exports?: Record<string, unknown>;
  };
  expect(parsed.name).toBe('@12-apps/ui');
  return parsed;
}

/** Every file an `exports` entry can resolve to, flattening condition objects. */
function targetsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(targetsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(targetsOf);
  return [];
}

describe('SPA dependency pre-bundling', () => {
  const { extensions = [] } = appShellOptimizeDeps();
  const isOptimizable = (id: string): boolean =>
    OPTIMIZABLE_ENTRY_RE.test(id) || extensions.some((ext) => id.endsWith(ext));

  it('can pre-bundle every subpath @12-apps/ui exports', () => {
    const exportsMap = uiManifest().exports ?? {};
    const entries = Object.entries(exportsMap).flatMap(([subpath, value]) =>
      targetsOf(value).map((target) => [subpath, target] as const),
    );

    // Guard the guard: an empty map would make the assertion below vacuous.
    expect(entries.length).toBeGreaterThan(0);

    const unoptimizable = entries
      .filter(([, target]) => !isOptimizable(target))
      .map(([subpath, target]) => `${subpath} => ${target}`);

    expect(unoptimizable).toEqual([]);
  });

  // A third case used to assert the extension was still REQUIRED — that
  // @12-apps/ui still shipped at least one entry Vite's own rule rejects. It
  // was removed when the pin moved to 1.7.0, which routes all 124 subpaths
  // through `.ts` and made that premise false.
  //
  // The extension itself was NOT removed with it. See `../vite/optimize-deps.ts`:
  // it is cheap, and what it prevents is a blank page that no build error or
  // failing test would announce. The case above remains the live guard.
});
