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

import {
  FRESH_RELOAD_PARAM,
  clearFreshReloadParam,
  isChunkLoadError,
  loadRouteChunk,
  reloadOntoCurrentBuild,
} from '../chunk-recovery';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

/** Where the stubbed tab is: a path, another query parameter and a hash. */
const TAB_URL = 'https://shop.example/loja/menu?mesa=4#bebidas';

/**
 * Replaces `window.location` with one that records where it was sent,
 * returning the record so the test owns it — no module-scope state for the
 * next test to inherit. `reload` is recorded too: a bare reload is the thing
 * the recovery must NOT fall back to.
 */
function stubNavigation(): { replaced: string[]; reloads: number } {
  const calls = { replaced: [] as string[], reloads: 0 };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: TAB_URL,
      replace: (url: string) => {
        calls.replaced.push(url);
      },
      reload: () => {
        calls.reloads += 1;
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
    const nav = stubNavigation();
    const module = { default: 'page' };
    await expect(loadRouteChunk(() => Promise.resolve(module))).resolves.toBe(module);
    expect(nav.replaced).toEqual([]);
  });

  it('reloads onto the current build when the chunk is stale', async () => {
    const nav = stubNavigation();
    const outcome = { settled: false };
    void loadRouteChunk(() => Promise.reject(staleChunkError())).then(() => {
      outcome.settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(nav.replaced).toHaveLength(1);
    // Stays suspended on purpose: the document is being replaced, so the
    // Suspense fallback should hold rather than flash an unreadable error.
    expect(outcome.settled).toBe(false);
  });

  /**
   * FUT-2485 (future-pay): a bare `location.reload()` asks for the same URL,
   * and a cache still holding the pre-deploy document answers it with the page
   * that names the dead chunk — so the one reload "recovers" onto the same
   * failure. The recovery must ask for a URL no cache has seen.
   */
  it('reloads past every cache rather than re-asking for the same URL', async () => {
    const nav = stubNavigation();
    void loadRouteChunk(() => Promise.reject(staleChunkError()));
    await Promise.resolve();
    await Promise.resolve();

    expect(nav.reloads).toBe(0);
    const target = new URL(nav.replaced[0] ?? '');
    expect(target.searchParams.get(FRESH_RELOAD_PARAM)).toMatch(/^[0-9a-z]+$/);
    // The same page: path, the other parameters and the hash all survive.
    expect(target.pathname).toBe('/loja/menu');
    expect(target.searchParams.get('mesa')).toBe('4');
    expect(target.hash).toBe('#bebidas');
  });

  it('rethrows a second stale chunk instead of looping reloads', async () => {
    const nav = stubNavigation();
    void loadRouteChunk(() => Promise.reject(staleChunkError()));
    await Promise.resolve();
    await Promise.resolve();
    expect(nav.replaced).toHaveLength(1);

    // The reload did not fix it — the boundary must get the error this time.
    await expect(loadRouteChunk(() => Promise.reject(staleChunkError()))).rejects.toThrow(
      /dynamically imported module/,
    );
    expect(nav.replaced).toHaveLength(1);
  });

  it('rethrows an ordinary module error without reloading', async () => {
    const nav = stubNavigation();
    await expect(loadRouteChunk(() => Promise.reject(new TypeError('bad export')))).rejects.toThrow(
      'bad export',
    );
    expect(nav.replaced).toEqual([]);
    expect(nav.reloads).toBe(0);
  });
});

describe('reloadOntoCurrentBuild', () => {
  it('replaces the entry with a marked URL of the same page, never a bare reload', () => {
    const nav = stubNavigation();
    reloadOntoCurrentBuild();
    // `replace`, so the back button does not step through the same page twice.
    expect(nav.replaced).toHaveLength(1);
    expect(nav.reloads).toBe(0);
    const target = new URL(nav.replaced[0] ?? '');
    expect(target.searchParams.has(FRESH_RELOAD_PARAM)).toBe(true);
    expect(target.origin + target.pathname).toBe('https://shop.example/loja/menu');
  });
});

describe('clearFreshReloadParam', () => {
  const home = window.location.href;

  afterEach(() => {
    window.history.replaceState(null, '', home);
  });

  it('takes the marker off and keeps everything else', () => {
    window.history.replaceState(null, '', `/loja/menu?mesa=4&${FRESH_RELOAD_PARAM}=lq2x#bebidas`);
    clearFreshReloadParam();
    expect(window.location.pathname).toBe('/loja/menu');
    expect(window.location.search).toBe('?mesa=4');
    expect(window.location.hash).toBe('#bebidas');
  });

  it('keeps the router’s history state', () => {
    const state = { usr: null, key: 'k1', idx: 3 };
    window.history.replaceState(state, '', `/loja/menu?${FRESH_RELOAD_PARAM}=lq2x`);
    clearFreshReloadParam();
    expect(window.location.search).toBe('');
    expect(window.history.state).toEqual(state);
  });

  it('leaves an ordinary load untouched', () => {
    window.history.replaceState(null, '', '/loja/menu?mesa=4');
    clearFreshReloadParam();
    expect(window.location.search).toBe('?mesa=4');
  });
});
