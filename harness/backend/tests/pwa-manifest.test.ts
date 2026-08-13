import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { PWA_HOST_A, PWA_HOST_B, PWA_HOST_UNKNOWN } from '../src/pwa-host';

/**
 * The @12-apps/pwa request-time half against the PUBLISHED tarball (12-23).
 *
 * The claim under test is the one future-pay's `docs/PWA.md` makes and a static
 * file cannot keep: **a PWA's identity is its origin**, so one installable app per
 * tenant means one manifest per host, which only a request-time answer produces. A
 * bundle has exactly one `index.html` for every tenant it serves.
 *
 * The second claim is the worker's, and it is the one with a permanent failure
 * behind it: a naive cache-first worker pins an old shell naming chunks the server
 * no longer has, and on an INSTALLED app "force-refresh" is advice the user cannot
 * follow. The rules live in the package's generated source, so they are asserted
 * against that source here rather than described in a README.
 */

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

/** Ask as a given host — what a reverse proxy in front of a tenant domain does. */
function manifestFor(host?: string): Promise<Response> {
  return backend.app.request('/manifest.webmanifest', {
    headers: host ? { 'x-forwarded-host': host } : {},
  });
}

async function manifestBody(host?: string): Promise<Manifest> {
  const response = await manifestFor(host);
  expect(response.status).toBe(200);
  return (await response.json()) as Manifest;
}

describe('the manifest is an endpoint, and answers per host', () => {
  it('serves a different app to each tenant domain on one deployment', async () => {
    const a = await manifestBody(PWA_HOST_A);
    const b = await manifestBody(PWA_HOST_B);

    expect(a.name).toBe('Loja da Ana Doces e Salgados');
    expect(b.name).toBe('Segunda Loja');
    // `id` is what the browser treats as app identity: two ids means two
    // installable apps, which is the entire feature.
    expect(a.id).not.toBe(b.id);
    expect(a.theme_color).not.toBe(b.theme_color);
  });

  it('404s a host the host-side rules do not know', async () => {
    const refused = await manifestFor(PWA_HOST_UNKNOWN);
    expect(refused.status).toBe(404);
    // Empty: the refusal has nothing to say and nothing to leak about which
    // domains do exist.
    expect(await refused.text()).toBe('');
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('answers the W3C shape at the TOP LEVEL, not in an envelope', async () => {
    const document = await manifestFor(PWA_HOST_A);
    expect(document.headers.get('content-type')).toContain('application/manifest+json');
    const body = (await document.json()) as Record<string, unknown>;
    // The browser's install machinery reads `name`/`icons` at the root; the house
    // `{ data }` envelope would simply make the document unreadable.
    expect(body.data).toBeUndefined();
    expect(body.name).toBeDefined();
  });

  it('elides a long name into a short_name a home screen can show', async () => {
    const a = await manifestBody(PWA_HOST_A);
    expect(a.name.length).toBeGreaterThan(a.short_name.length);
    expect(a.short_name.length).toBeLessThanOrEqual(12);
  });

  it('applies the host defaults without overriding what a tenant set', async () => {
    const a = await manifestBody(PWA_HOST_A);
    const b = await manifestBody(PWA_HOST_B);
    // The splash colour is deliberately not the theme colour, and it comes from
    // the one place a host sets it.
    expect(a.background_color).toBe('#F8FAFC');
    expect(a.display).toBe('standalone');
    expect(b.display).toBe('minimal-ui');
  });

  it('carries the maskable claim through untouched', async () => {
    const a = await manifestBody(PWA_HOST_A);
    expect(a.icons[0]).toMatchObject({ sizes: '192x192', purpose: 'any maskable' });
  });

  it('is revalidated rather than pinned, and varies on the forwarded host', async () => {
    const response = await manifestFor(PWA_HOST_A);
    // A hard cache here is what makes a rebrand invisible for a day; the icon URL
    // is the thing to version instead.
    expect(response.headers.get('cache-control')).toContain('must-revalidate');
    // And one path serves every tenant, so the host has to be part of the cache
    // key — otherwise a cache answers tenant B with tenant A's name and icon, and
    // that gets INSTALLED. The browser spec next to this one reproduces exactly
    // that, which is how the header came to be here.
    expect(response.headers.get('vary')).toBe('x-forwarded-host');
  });

  it('serves the loopback app to the SPA and to a vitest request alike', async () => {
    const local = await manifestBody();
    expect(local.name).toBe('Harness Storefront');
  });
});

describe('the packaged service worker, as the host serves it', () => {
  it('is served from the ROOT and allowed to claim it', async () => {
    const response = await backend.app.request('/sw.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    // Without this header a worker served anywhere but the root silently covers
    // almost nothing — the default scope is the script's own directory.
    expect(response.headers.get('service-worker-allowed')).toBe('/');
    // Never cached hard: replacing a bad worker is what this header buys.
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('is network-first for documents and never stores HTML as an asset', async () => {
    const source = await (await backend.app.request('/sw.js')).text();

    // The shell is fetched first and cached only as the offline answer.
    expect(source).toContain('documentNetworkFirst');
    expect(source).toMatch(/request\.mode === 'navigate'/);
    // The history fallback answers a vanished chunk with 200 text/html; storing
    // THAT under the asset URL is what makes the blank page permanent.
    expect(source).toContain("!contentType.includes('text/html')");
    // Live state is never cached — and the suite's own control plane is live too.
    expect(source).toContain('"/api/"');
    expect(source).toContain('"/__harness/"');
    // A cached document is keyed by the SHELL, so one route can never be answered
    // with another route's baked content.
    expect(source).toContain('cache.put(SHELL_URL');
  });

  it('sweeps only its own caches on activate', async () => {
    const source = await (await backend.app.request('/sw.js')).text();
    expect(source).toContain('key.startsWith(CACHE_PREFIX)');
    expect(source).toContain('"harness-shell-v1"');
  });
});
