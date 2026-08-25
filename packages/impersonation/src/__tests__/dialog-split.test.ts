import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createWebImpersonation } from '../react/create-web-impersonation';
import type { ImpersonationLabels } from '../react/labels';

/**
 * The dialog is not in the banner's bundle, and stays out of it.
 *
 * `createWebImpersonation` has always PROMISED that an app which only ever
 * wears sessions "mounts the banner and nothing else". For a while that was
 * true of the returned object and false of the module graph: the factory
 * reached the dialog through a static import, so every host — a storefront
 * included — downloaded and parsed a tenant picker, an app picker, a
 * justification box and a write opt-in, with the design-system components
 * behind all four, to support a screen only a platform operator can open.
 *
 * A runtime assertion cannot catch that coming back. `dialog: null` was correct
 * throughout; what regressed was the SHAPE OF THE IMPORT, and a bundler is the
 * only thing that reads it. So the assertions here are about the source text of
 * two files, in the same spirit as this package's portability tripwires: the
 * cheapest thing that fails when the edge is re-drawn the wrong way.
 */

const REACT_ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'react');

function read(file: string): string {
  // The claim is about what the FILE says, so it must be the real file — a
  // mocked one would only ever repeat what this test wrote into it.
  // eslint-disable-next-line test-flakiness/no-unmocked-fs
  return readFileSync(join(REACT_ROOT, file), 'utf8');
}

/**
 * The `import`/`export … from './dialog'` statements in a file, as written.
 *
 * Matched over the whole source rather than line by line because this package
 * wraps its import lists, and a per-line scan would see `} from './dialog';`
 * with the `import type` that governs it three lines above.
 *
 * `[^;]` and not `[\s\S]` is what keeps a match from starting at an EARLIER
 * statement and running through it: a lazy any-character span happily begins at
 * the `react` import above and swallows the semicolon between them, which reads
 * as an untyped import and fails a file that is correct.
 */
function dialogImports(source: string): string[] {
  return [...source.matchAll(/^(?:import|export)[^;]*?from '\.\/dialog';$/gm)].map(
    (match) => match[0],
  );
}

const LABELS: ImpersonationLabels = {
  banner: {
    regionLabel: 'Desk session',
    actingAs: ({ subject }) => `At the desk as ${subject}`,
    previewingRole: ({ role }) => `Looking as a ${role}`,
    previewingMember: ({ subject }) => `Looking as ${subject}`,
    unknownSubject: 'someone',
    readOnly: 'Look only',
    remaining: ({ formatted }) => `Closes in ${formatted}`,
    expired: 'The desk session has closed',
    timeUp: 'Time is up',
    unconfirmed: 'Could not confirm the desk session',
    exitFailed: 'Could not close it. Try again.',
    exit: 'Close the desk session',
  },
};

describe('the start dialog is loaded, not bundled with the banner', () => {
  it('is reached from the factory by TYPE only, never as a value', () => {
    const statements = dialogImports(read('create-web-impersonation.tsx'));

    // There is at least one, or the assertion below would pass vacuously the
    // day somebody renamed the module.
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((statement) => !statement.startsWith('import type'))).toEqual([]);
  });

  it('is reached from the boundary only through a dynamic import', () => {
    const source = read('dialog-lazy.tsx');

    expect(dialogImports(source).filter((s) => !s.startsWith('import type'))).toEqual([]);
    expect(source).toContain("import('./dialog')");
  });

  it('is still absent from the object a banner-only host gets back', () => {
    const surface = createWebImpersonation({
      platformPath: '/desk/session',
      tenantPath: (slug) => `/branches/${slug}/desk`,
      labels: LABELS,
    });

    expect(surface.dialog).toBeNull();
  });

  it('is a component for a host that configured one', () => {
    const surface = createWebImpersonation({
      platformPath: '/desk/session',
      tenantPath: (slug) => `/branches/${slug}/desk`,
      labels: {
        ...LABELS,
        dialog: undefined,
      },
      dialog: {
        apps: [{ value: 'counter', label: 'Counter' }],
        writableApps: ['counter'],
        reasonLength: { min: 15, max: 400 },
        loadTenants: async () => [],
        landingUrl: ({ tenantSlug }) => `/branches/${tenantSlug}`,
      },
    });

    // No dialog LABELS, so this host is still refused a dialog: the two halves
    // of the configuration are checked together, and neither alone is enough.
    expect(surface.dialog).toBeNull();
  });
});
