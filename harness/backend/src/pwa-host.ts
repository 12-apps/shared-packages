/**
 * Everything `@12-apps/pwa/server` needs from a HOST, in one object (12-23).
 *
 * The manifest is a per-host ENDPOINT rather than a static file, and the reason is
 * the only thing left for a host to answer: **is this origin an app, and which
 * one?** future-pay resolves the request hostname against verified custom-domain
 * rows and the tenant's plan; this harness resolves it against a map. Everything
 * after that answer — the W3C document, the short-name elision, the 404 that IS
 * the gate, the worker's caching rules — is the package's.
 *
 * Both assets are served from the ORIGIN ROOT, which is not a detail: a worker's
 * directory bounds its scope, and the manifest is linked from a static
 * `index.html` that cannot know a prefix. `harness/frontend`'s Vite proxy forwards
 * both paths here, so the browser sees them at its own origin exactly as a
 * deployed SPA does.
 */
import { pwaRouter } from '@12-apps/pwa/hono';
import type { PwaApp } from '@12-apps/pwa/server';

/** A tenant's custom domain — the per-host proof. */
export const PWA_HOST_A = 'loja.harness.test';

/** A second one, so "the manifest varies by host" is observable rather than claimed. */
export const PWA_HOST_B = 'segunda.harness.test';

/** A domain nobody registered — the 404 gate. */
export const PWA_HOST_UNKNOWN = 'nao-registrada.harness.test';

/**
 * The app served on `localhost` — what the SPA (through its proxy) and a vitest
 * `app.request()` both resolve to. A deployed host would not special-case a
 * hostname; a harness has to, because the only name its own two halves share is
 * the loopback one.
 */
const LOCAL_APP: PwaApp = {
  id: '/harness/',
  name: 'Harness Storefront',
  startUrl: '/#/pwa-manifest',
  scope: '/',
  icons: [],
};

/** One installable app per tenant domain — the whole point of the endpoint. */
const APPS = new Map<string, PwaApp>([
  [
    PWA_HOST_A,
    {
      id: '/loja-da-ana/',
      // Long on purpose: `short_name` is derived and elided by the package, and a
      // home screen that shows the full name is the regression that hides.
      name: 'Loja da Ana Doces e Salgados',
      startUrl: '/?utm_source=pwa',
      scope: '/',
      themeColor: '#B91C1C',
      icons: [
        {
          src: '/icons/loja-da-ana-192.png',
          sizes: '192x192',
          type: 'image/png',
          // The claim only an opaque, square asset may make.
          purpose: 'any maskable',
        },
      ],
    },
  ],
  [
    PWA_HOST_B,
    {
      id: '/segunda/',
      name: 'Segunda Loja',
      startUrl: '/',
      scope: '/',
      themeColor: '#1D4ED8',
      display: 'minimal-ui',
      icons: [],
    },
  ],
]);

/** Loopback under any port — see {@link LOCAL_APP}. */
function isLocal(host: string): boolean {
  const [hostname] = host.split(':');
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function pwaHost() {
  return pwaRouter({
    /**
     * The host's ONE decision. Returning `null` is a 404, and that 404 is the
     * gate: "installable" exists exactly where the host's own domain rules say it
     * does, with no second feature flag to keep in sync.
     */
    resolveApp: ({ host }) => APPS.get(host) ?? (isLocal(host) ? LOCAL_APP : null),
    defaults: { themeColor: '#6366F1', backgroundColor: '#F8FAFC' },
    serviceWorker: {
      cachePrefix: 'harness',
      cacheVersion: 'v1',
      shellUrl: '/index.html',
      assetPrefixes: ['/assets/'],
      // The suite's own control plane is live state too — a cached reset would
      // reseed nothing while reporting 204.
      neverCachePrefixes: ['/api/', '/__harness/'],
    },
  });
}

/** The mounted surface's type — inferred, so the worker source stays reachable. */
export type HarnessPwa = ReturnType<typeof pwaHost>;
