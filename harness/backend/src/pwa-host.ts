/**
 * Everything `@12-apps/pwa/server` needs from a HOST, in one object (12-23).
 *
 * The manifest is a per-host ENDPOINT rather than a static file, and the reason is
 * the only thing left for a host to answer: **is this origin an app, and which
 * one?** The origin host resolves the request hostname against verified custom-domain
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
import { pwaManifest } from '@12-apps/pwa/manifest';
import { pwaServerManifest } from '@12-apps/pwa/manifest/server';
import type { PwaApp } from '@12-apps/pwa/server';
import { createWiringHost } from '@12-apps/wiring/consumer';

import { harnessLoggerFor, honoRouterFor } from './wire-hono';

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

/**
 * Where `mount-surfaces.ts` hangs the router: the ORIGIN ROOT.
 *
 * A service worker's DIRECTORY bounds its scope, so `/sw.js` served from under
 * a prefix could only ever control that prefix — and the manifest is linked
 * from a static `index.html` that cannot know one.
 */
export const PWA_MOUNT_PATH = '/';

/** Everything `@12-apps/pwa/server` asks a host for. */
function pwaConfig() {
  return {
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
  };
}

/**
 * The installable-app surface, ADOPTED rather than routed.
 *
 * This host used to call `pwaRouter(config)` — the package's own Hono mount,
 * which works and binds nothing. `@12-apps/pwa` declares `server: ['http']`,
 * and a manifest no host adopts is not an unanswered capability: it is a
 * package the wiring report never hears about. Third and last of the server
 * manifests that were in that position, after app-shell and mcp.
 *
 * Both routes are `public` and both need the RAW request — the app is resolved
 * from its Host header, so the package's wire view throws without one rather
 * than guessing. The wire view also sets `vary` on every answer itself, which
 * is the half worth checking on a conversion like this: a response that varies
 * on the forwarded host and does not SAY so is one a cache will hand to the
 * next domain.
 */
export function pwaHost() {
  const wiring = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });
  wiring.adoptServer({
    manifest: pwaManifest,
    server: pwaServerManifest,
    bindings: { http: { mountPath: PWA_MOUNT_PATH, config: pwaConfig() } },
  });
  const wired = wiring.assemble();

  return {
    // Spread, not just the router: `assemble()` hands back what `http.create`
    // returned, and for this package that carries the worker source the suite
    // reads. Dropping it is the mistake the mcp adoption made first, where the
    // resource-server probe caught it.
    ...(wired.http[pwaManifest.name] as Record<string, unknown>),
    router: honoRouterFor(wired.routes, () => null),
    report: wired.report,
    routes: wired.routes,
  };
}

/** The mounted surface's type — inferred, so the worker source stays reachable. */
export type HarnessPwa = ReturnType<typeof pwaHost>;
