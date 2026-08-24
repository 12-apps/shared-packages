/**
 * `@12-apps/pwa/manifest` — the SHARED wiring manifest.
 *
 * Identity, the observability namespace, and one runtime inventory entry:
 * `http` on the server. Two endpoints — the web-app manifest and, when the
 * host asks for it, the packaged service worker.
 *
 * ## THE ROOT-MOUNT CONSTRAINT — the one note the adaptation report left
 *
 * Every other `http` contribution in the estate declares paths RELATIVE to
 * whatever prefix the adopting host binds (`mountPath: '/api/admin/:tenantSlug'`
 * and a route path of `/reports/custom/:id`). This one cannot. `PwaRoute.path`
 * is absolute from the ORIGIN ROOT because both assets are only correct
 * there:
 *
 * - **the service worker's scope is its own directory.** A worker served
 *   from `/api/pwa/sw.js` may only control `/api/pwa/**`, which is nothing
 *   the storefront renders. `service-worker-allowed: /` lets a worker served
 *   elsewhere CLAIM the root, and `createApiPwa` sets it — but the browser
 *   still honours it only for a worker the page registers by that path, so a
 *   prefix mount turns "installable" into "registered and inert".
 * - **the manifest is linked from a static `index.html`** that cannot know a
 *   prefix. The SPA ships one `index.html` for every store, so the `<link
 *   rel="manifest">` in it is a literal — it is not templated per host, and
 *   a prefix a host chose at bind time can never reach it.
 *
 * The consumer joins `mountPath + path`, so the ONLY correct binding is
 * `mountPath: '/'` — which joins to the declared path unchanged. A host that
 * serves the manifest somewhere else says so through `config.manifestPath`
 * (an absolute path, still from the root), NOT through the mount; the origin
 * host does exactly that, serving it at `/api/storefront-manifest` because
 * that is the only prefix its proxy forwards on a tenant domain. Both routes
 * therefore stay reachable at the URL the browser was told about, which is
 * the property the mount cannot be allowed to move.
 *
 * ## THE OTHER NARROWINGS
 *
 * - **No `db`.** Whether an origin is an app, and which one, is
 *   `config.resolveApp` — the host's domain rows and plan gates. This
 *   package owns no model and stores nothing.
 * - **No `web` inventory**, though `./react` ships the install invite.
 *   `InstallInvite` is a component a host renders where its own layout
 *   wants it, not a `createWeb*` factory; there is no bound surface to
 *   declare and no area to suggest, because the invite is chrome rather
 *   than a route.
 * - **No `permissions`, `mcp`, `env`, `e2e` or `jobs`.** Both routes are
 *   `public` by necessity (a browser fetches a manifest with no session,
 *   and a service worker registers before one exists), nothing reads
 *   `process.env`, and nothing runs on a clock.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from "@12-apps/wiring";

/**
 * The one mount path this contribution may be bound at — see the
 * root-mount constraint above. Exported so an adopting host names the
 * constraint rather than retyping a string, and so the compliance suite can
 * assert the joined URLs stay where the browser was told they are.
 */
export const PWA_MOUNT_PATH = "/";

export const pwaManifest = {
  name: "@12-apps/pwa",
  contract: 1,
  /**
   * Mandatory for runtime manifests since wiring 1.3.0. Worth having here
   * because every failure on this surface is silent by construction: a
   * `resolveApp` that throws becomes an unhandled rejection on a route the
   * browser fetches in the background, and the only user-visible symptom is
   * an app that quietly stops being installable.
   */
  observability: { namespace: "pwa" },
  server: ["http"],
} as const satisfies PackageManifest;
