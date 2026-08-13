// @vitest-environment jsdom
/**
 * A deploy must not leave an open tab on a blank page (FUT-712).
 *
 * The failure being pinned is a production one: a tab served before a deploy asks
 * for a chunk whose hashed filename no longer exists, the static server answers the
 * SPA history fallback (`200 text/html`) where a module was expected, `import()`
 * rejects, and with no boundary above it the whole tree unmounts. A manual refresh
 * "fixes" it, which is exactly why nobody reported it as a bug.
 *
 * Ported from `@repo/spa-shared`'s `lazy-route` suite; the module split so these
 * cases need no renderer (`lazyRoute` is React's half, in `../../react`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isChunkLoadError, loadRouteChunk } from '../chunk-recovery';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

/**
 * Replaces `window.location.reload` with a counter, returning the counter so
 * the test owns it — no module-scope state for the next test to inherit.
 */
function stubReload(): { count: number } {
  const calls = { count: 0 };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      reload: () => {
        calls.count += 1;
      },
    },
  });
  return calls;
}

/** The message Chrome/Firefox raise when a hashed chunk is gone. */
function staleChunkError(): Error {
  return new Error(
    'Failed to fetch dynamically imported module: /admin/assets/research-Ab12Cd.js',
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
});

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: /admin/assets/x.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /admin/assets/x.css',
    'Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('recognises a webpack-style ChunkLoadError by name', () => {
    const error = new Error('boom');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('does not claim an ordinary application error', () => {
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });
});

describe('loadRouteChunk', () => {
  it('passes the module through when the chunk loads', async () => {
    const reload = stubReload();
    const module = { default: 'page' };
    await expect(loadRouteChunk(() => Promise.resolve(module))).resolves.toBe(module);
    expect(reload.count).toBe(0);
  });

  it('reloads onto the current build when the chunk is stale', async () => {
    const reload = stubReload();
    const outcome = { settled: false };
    void loadRouteChunk(() => Promise.reject(staleChunkError())).then(() => {
      outcome.settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(reload.count).toBe(1);
    // Stays suspended on purpose: the document is being replaced, so the
    // Suspense fallback should hold rather than flash an unreadable error.
    expect(outcome.settled).toBe(false);
  });

  it('rethrows a second stale chunk instead of looping reloads', async () => {
    const reload = stubReload();
    void loadRouteChunk(() => Promise.reject(staleChunkError()));
    await Promise.resolve();
    await Promise.resolve();
    expect(reload.count).toBe(1);

    // The reload did not fix it — the boundary must get the error this time.
    await expect(loadRouteChunk(() => Promise.reject(staleChunkError()))).rejects.toThrow(
      /dynamically imported module/,
    );
    expect(reload.count).toBe(1);
  });

  it('rethrows an ordinary module error without reloading', async () => {
    const reload = stubReload();
    await expect(loadRouteChunk(() => Promise.reject(new TypeError('bad export')))).rejects.toThrow(
      'bad export',
    );
    expect(reload.count).toBe(0);
  });
});
