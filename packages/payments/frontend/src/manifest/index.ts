/**
 * `@12-apps/payments-frontend/manifest` — the SHARED wiring manifests.
 *
 * UNTYPED pure data, unlike most sibling producer halves: the portability
 * ruleset (`payments/no-host-imports`) allows no `@12-apps/wiring` import
 * anywhere under `packages/payments/**`, type-only included — this package
 * must vendor into a repo that has no wiring contract at all. The compliance
 * run lives in the wiring suite's `payments-frontend-manifest.test.ts`
 * instead, along a dependency edge that does exist, so a drift still fails a
 * test run before any host sees it. That is exactly the arrangement
 * `@12-apps/payments-backend`'s manifest already uses.
 *
 * TWO manifests, mirroring the backend's split for the same reason. The
 * backend ships two route tables that must never merge — every library row is
 * merchant-admin, every checkout row is the BUYER — and the browser half is
 * the same product cut the same way:
 *
 * - **settings** is the OWNER's screen: which providers exist, which
 *   credentials are stored, which one is tried first. It mounts in an admin
 *   SPA, behind that host's admin session.
 * - **checkout** is the SHOPPER's flow: methods, card entry, PIX, the hosted
 *   hand-off and the return leg. It mounts in a storefront SPA, for an
 *   anonymous visitor.
 *
 * One manifest would hand a host ONE surface config for two mounts that live
 * in different applications, behind different gates, built from different
 * ports — and would oblige the storefront to construct the owner's settings
 * transport in order to render a checkout. Two make that impossible to
 * express.
 *
 * ## THE NARROWINGS
 *
 * - **No `server` inventory on either.** There is no server half here; the
 *   HTTP surfaces are `@12-apps/payments-backend`'s, declared in its own
 *   manifest.
 * - **No `db`, `permissions`, `mcp`, `env` or `e2e`.** This package stores
 *   nothing, advertises no tools and reads no environment; every
 *   authorization question is answered by the endpoints it talks to, and the
 *   packaged journeys ship in the SIBLING `@12-apps/payments-e2e` (a
 *   manifest must not declare an entry another package exports).
 *
 * `observability` names where a wiring host files each surface's browser
 * reports. The package still binds no logger anywhere — it takes no
 * observability dependency, by the same portability rule as above.
 */

/**
 * The OWNER's provider-settings screen. Same identity as the package,
 * because it is the half a host adopting "payments-frontend" means by
 * default.
 */
export const paymentsFrontendManifest = {
  name: '@12-apps/payments-frontend',
  contract: 1,
  observability: { namespace: 'payments' },
  web: ['surface', 'areas'],
} as const;

/**
 * The SHOPPER's checkout flow. Its own identity so a host adopts it into the
 * storefront SPA alone — and so a version bump can never widen the admin
 * mount with a buyer screen nobody re-reviewed.
 *
 * The namespace matches the backend's buyer surface (`payments-checkout`)
 * rather than `payments`: a failed checkout is one incident across the two
 * halves, and filing the browser side under the merchant namespace is what
 * makes a shopper's dead end and the charge behind it look unrelated.
 */
export const paymentsCheckoutFrontendManifest = {
  name: '@12-apps/payments-checkout-ui',
  contract: 1,
  observability: { namespace: 'payments-checkout' },
  web: ['surface', 'areas'],
} as const;
