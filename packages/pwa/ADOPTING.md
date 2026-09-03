# Adopting @12-apps/pwa

A **plug-and-play installability plugin** (12-23): both halves of "this web app
can be installed" — the per-host manifest and the service worker on the server
side, the install invite and the boot registration on the browser side. A host
repo only *points* at these surfaces; when the library updates, every host
updates with **no app changes**. Same contract `@12-apps/report-builder` and
`@12-apps/rbac` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/pwa` | `useInstallPrompt()` + `isIosInstallable` / `isStandalone` / `isHandheld`, and `registerServiceWorker()` / `postToServiceWorker()`. React-free apart from the hook; no `hono`, no Node. |
| **React** | `@12-apps/pwa/react` | `<InstallInvite …>` — the captured `beforeinstallprompt` button on Chromium, the share-sheet instruction on iOS, dismissal memory, every string overridable. And `<PullToRefresh …>` — the reload an installed app has no chrome for (rule 12). |
| **Server** | `@12-apps/pwa/server` | `createApiPwa({ resolveApp })` and mount the `routes` it returns: the manifest endpoint, and optionally the packaged worker. Also exports `buildWebAppManifest` and `pwaServiceWorkerSource` for a host that serves them its own way. |
| **Hono** | `@12-apps/pwa/hono` | `const pwa = pwaRouter({ resolveApp }); app.route('/', pwa.router)`. Mounted at the **origin root** (see rule 2). `hono` is an OPTIONAL peer, so importing the root or `./react` never resolves it. |
| **Prisma** | — | **None, deliberately.** This package owns no tables: the app's identity, its branding and its domain rules all live in the host's own models. A partial for tables nothing writes is worse than none, because every host then adopts migrations it does not need. |

## Host wiring rules (the ones that bite)

1. **The manifest is an ENDPOINT, never a static file.** A PWA's identity IS its
   origin, and a static bundle has exactly one `index.html` for every tenant it
   serves — so a file cannot vary by the app the visitor is actually looking at.
   One installable app per tenant means one manifest per host, which only a
   request-time answer can produce.
2. **Mount at the origin root.** A worker's directory bounds its scope, and the
   manifest is linked from a static `index.html` that cannot know a prefix. The
   descriptors therefore carry absolute paths (`/manifest.webmanifest`, `/sw.js`);
   `manifestPath` / `serviceWorker.path` move them (the origin host serves the manifest
   at `/api/storefront-manifest`, because its edge only forwards `/api/*` on
   tenant domains).
3. **`resolveApp` returning `null` is the whole gate.** Installability then exists
   exactly where the host's own rules say it does, with no extra feature flag to
   keep in sync with the ones that already decide whether a domain serves.
   the origin host resolves the request host to a verified custom domain and checks the
   tenant's plan; anything else 404s with an empty body.
   > **iOS 26 weakened this and it is worth knowing how much:** Safari dropped
   > every installability requirement, so on iOS a visitor can add ANY origin to
   > their Home Screen. The 404 no longer *stops* them — it decides whether they
   > get the app's name and icon or the browser's fallback. Treat "the manifest
   > 404s, therefore it cannot be installed" as false.
4. **The forwarded host is a CLAIM.** The adapter reads `X-Forwarded-Host`'s first
   hop (lowercased) because a reverse proxy is the normal topology for per-tenant
   domains, but whether to honour it is `resolveApp`'s decision — the origin host
   resolves it against verified-domain rows, so a spoofed header resolves to
   nothing.
5. **CACHING: network-first for documents. This is not a preference.** Every
   hashed filename in a bundled SPA dies with the deploy that produced it, and a
   history fallback serves `index.html` in place of a missing chunk — which fails
   on the **MIME type**, not as a 404, and renders the page **blank** through
   `React.lazy`. A naive cache-first worker pins an old shell naming chunks the
   server no longer has, and the escape reload then runs against the cache,
   forever. On an INSTALLED app "force-refresh" is advice the user cannot follow.
   The packaged worker therefore hard-codes:
   - navigation / the shell → **network-first**, cache only as an offline fallback,
     stored under the shell key (never the request URL);
   - hashed assets → cache-first, and an **HTML answer is never stored** under an
     asset URL;
   - `neverCachePrefixes` (default `/api/`) → never cached, because a stale cart
     is a wrong total at checkout.
6. **The worker is a script, not a module — and it is behind `resolveApp` too.**
   The browser fetches it from your origin at a path whose directory bounds its
   scope, so either let `createApiPwa` serve it (`Service-Worker-Allowed: /`,
   `Cache-Control: no-cache`, and a 404 wherever `resolveApp` returns `null`, so
   the gate means the same thing on both routes) or write
   `pwaServiceWorkerSource(...)` to `public/sw.js` in a build step.
   `importScripts` is the seam for a host's own layers (error reporting, push) and
   accepts **same-origin absolute paths only** — a scheme or `//` throws
   at generation time, because a worker may only load scripts from its own origin.
7. **Two head tags the manifest cannot supply.** `theme-color` must be static in
   `index.html` (the browser paints the address bar before any JS runs), and
   `apple-touch-icon` is not optional: **iOS ignores the manifest's `icons`
   entirely**, so without it an iPhone home screen shows the platform's mark for
   an app that paid to be white-labelled.
8. **The app icon is its own asset.** A logo is whatever proportion its designer
   drew; an app icon is a square that has to survive a circular mask. Pass
   `purpose: "any maskable"` only for an asset your upload flow made opaque and
   square — declaring a transparent, edge-to-edge logo maskable produces the white
   plate this feature exists to avoid. Version the icon URL (`?v=`): an
   already-installed home-screen icon is the last asset a device re-fetches.
9. **`id` is permanent.** A changed `id` is a DIFFERENT app to the browser, so
   anyone who installed the old one ends up with two icons. Derive it from a
   permanent identity (a slug), never from a display name.
10. **The invite never fires itself.** A browser grants a page ONE install prompt;
    spending it on a first visit buys a near-certain refusal the browser remembers
    for a long time. `beforeinstallprompt` is captured and HELD — show the invite
    where the visitor already knows what they would be installing.
11. **The answer varies by host, so the cache key must too.** The Hono adapter
    sends `Vary: X-Forwarded-Host` on every response it serves — and an adapter you
    write yourself MUST do the same, which is why the requirement is also stated on
    `PwaRouteResponse`, the framework-neutral descriptor. It is not in the
    descriptor's own headers because only the adapter knows which header its
    `resolveApp` keys the tenant off. One
    cacheable path serves every tenant: a cache keyed on the URL alone hands tenant
    A's name and icon to tenant B, and that gets INSTALLED on a home screen, which
    outlives any cache entry. This was found in the harness, in one page — two
    `fetch`es of the same path with different forwarded hosts, the second answered
    from the browser's own cache with no request leaving the tab. A host resolving
    its app some other way (a path segment, a config map keyed on something else)
    should send the `Vary` matching ITS input instead.
12. **Give the reload back where the platform took it away.** Rule 5 says the
    quiet part out loud — *on an installed app "force-refresh" is advice the user
    cannot follow* — and the worker only fixes the half that does not need the
    user. Wrap the app in `<PullToRefresh>`; it is INERT unless
    `needsPullToRefresh()` is true, which is iOS home-screen apps and nothing
    else. Chromium keeps its overscroll refresh in standalone mode, so a second
    gesture there is one pull reloading twice — **unless your scroll root sets
    `overscroll-behavior`**, which disables Chromium's; then pass
    `platform={isStandalone}` and turn it on for Android too. Refresh with
    `reloadApp()` (the default) rather than `location.reload()`: it lets the
    worker update settle first, so a reload issued the moment a deploy lands is
    not answered by the outgoing worker with the very shell the user is escaping.

## The config, field by field

| Field | Required | Default | Notes |
|---|---|---|---|
| `resolveApp` | yes | — | `{ request, host }` → `PwaApp \| null`; `null` is the 404 gate, on the WORKER route as well as the manifest |
| `defaults` | no | theme `#6366F1`, background `#FFFFFF`, scope `/`, display `standalone`, short name ≤12 | per-host, set once |
| `manifestPath` | no | `/manifest.webmanifest` | the origin host uses `/api/storefront-manifest` |
| `manifestCacheControl` | no | `public, max-age=300, must-revalidate` | version the ICONS, don't shorten this |
| `serviceWorker` | no | `false` | `{ cachePrefix, cacheVersion, shellUrl, assetPrefixes, neverCachePrefixes, importScripts, path }` |

`scope: "/"` is safe only where the whole origin is one app — on a multi-tenant
platform host it is wrong, and that is one more reason the platform origin should
answer 404 rather than serve a generic manifest.

## Minimal host (Hono)

```ts
import { pwaRouter } from '@12-apps/pwa/hono';

const pwa = pwaRouter({
  manifestPath: '/api/storefront-manifest',
  serviceWorker: { cachePrefix: 'storefront', cacheVersion: 'v1' },
  resolveApp: async ({ host }) => {
    const domain = await findServableDomain(host);      // host's own rules
    if (!domain) return null;                            // → 404, and that is the gate
    if (!(await entitlements.check(domain.clientId, 'branding.custom_domain')).enabled) return null;
    const [tenant, branding] = await Promise.all([
      getTenantBySlug(domain.tenantSlug),
      getPublicBranding(domain.clientId),
    ]);
    if (!tenant) return null;
    return {
      id: `/${domain.tenantSlug}/`,                      // permanent, not the name
      name: branding?.displayName?.trim() || tenant.name,
      startUrl: '/menu',
      themeColor: branding?.primaryColor ?? undefined,
      icons: iconsFor(branding),                         // '' or [] is honest
    };
  },
});

app.route('/', pwa.router);
```

## Minimal host (browser)

```ts
import { registerServiceWorker } from '@12-apps/pwa';

registerServiceWorker();            // '/sw.js' at scope '/', after `load`
```

## Phase B — adopting into the origin host

- `apps/web/app/api/storefront-manifest/route.ts` keeps only `resolveApp`: the
  `findServableDomain` lookup, the entitlement check and the branding read. The
  manifest shape, the short-name elision, the icon rules, the 404 and the cache
  headers come from the package.
- `apps/client/public/sw.js` is replaced by the packaged worker with
  `importScripts: ['/observability-sw.js']`, which is where the storefront's
  Sentry-in-a-worker reporter and its push/notification handlers keep living —
  the worker is a separate global scope, so nothing thrown in it reaches the page
  and those handlers must stay reported.
- `@repo/spa-shared/service-worker` becomes a re-export of
  `registerServiceWorker` + a `setPushIcon` built on `postToServiceWorker`.

## What deliberately did NOT move into the package

- **Push notification rendering** (`push` / `notificationclick`, the per-tenant
  icon cache) — the payload contract belongs to the notifications transport, and
  the `importScripts` seam is where a host adds it.
- **The install invite's placement** — the origin host's storefront has a second
  claimant on the bottom of the viewport (the "Ver carrinho" bar), and that
  collision is a fact about that app's layout, not about installability.
- **`theme-color` / `apple-touch-icon`** — static head tags in the host's
  `index.html` (rule 7).
- **Locale.** The messages layer still defaults to pt-BR. Ticket **12-40** owns
  the locale seam across packages; this ticket deliberately did not widen the
  problem, and the strings stay overridable per host in the meantime.
