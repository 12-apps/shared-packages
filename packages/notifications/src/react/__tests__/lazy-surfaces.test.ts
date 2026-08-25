import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The chrome does not carry the surfaces behind it, and cannot start to again.
 *
 * `createWebNotifications` returns two kinds of thing and its own docstring
 * says which is which: the bell is chrome, on screen from the first paint; the
 * panel is behind a tap; the preferences screen is somewhere a host ROUTES to.
 * Static imports made all three one bundle, so every host that put the bell in
 * its header also shipped the slide-over, the settings matrix, the design
 * system's `Drawer` and `Switch`, and — through those — MUI's
 * `SwipeableDrawer`, `Modal`, `Slide` and focus trap.
 *
 * Nothing at RUNTIME can catch that coming back: the factory's return value was
 * correct the whole time. What regressed was the SHAPE OF THE IMPORT, which
 * only a bundler reads. So these assertions are about the source text of the
 * factory, in the same spirit as this package's portability tripwires — the
 * cheapest thing that fails when the edge is redrawn the wrong way.
 */

const REACT_ROOT = join(fileURLToPath(new URL('../', import.meta.url)));

function read(file: string): string {
  // The claim is about what the FILE says, so it has to be the real file.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readFileSync(join(REACT_ROOT, file), 'utf8');
}

/**
 * The `import`/`export … from '<module>'` statements in a file, as written.
 *
 * `[^;]` and not `[\s\S]` is what stops a match starting at an EARLIER
 * statement and running through it: a lazy any-character span begins at the
 * previous import and swallows the semicolon between them, which reads as an
 * untyped import and fails a file that is correct.
 */
function importsOf(source: string, module: string): string[] {
  const pattern = new RegExp(`^(?:import|export)[^;]*?from '\\./${module}';$`, 'gm');
  return [...source.matchAll(pattern)].map((match) => match[0]);
}

describe('the factory reaches its heavy surfaces only through a dynamic import', () => {
  const factory = read('create-web-notifications.tsx');

  for (const [surface, boundary] of [
    ['panel', 'panel-lazy.tsx'],
    ['preferences-screen', 'page-lazy.tsx'],
  ] as const) {
    it(`imports './${surface}' by type only`, () => {
      const statements = importsOf(factory, surface);

      // At least one, or this passes vacuously the day the module is renamed.
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.filter((s) => !s.startsWith('import type'))).toEqual([]);
    });

    it(`loads './${surface}' from ${boundary}`, () => {
      const source = read(boundary);

      expect(importsOf(source, surface).filter((s) => !s.startsWith('import type'))).toEqual([]);
      expect(source).toContain(`import('./${surface}')`);
    });
  }

  it('keeps the BELL eager — it is the half that is actually on screen', () => {
    expect(importsOf(factory, 'bell-button').filter((s) => s.startsWith('import type'))).toEqual(
      [],
    );
    expect(importsOf(factory, 'bell-button').length).toBeGreaterThan(0);
  });
});
