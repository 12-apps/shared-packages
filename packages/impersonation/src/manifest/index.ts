/**
 * `@12-apps/impersonation/manifest` — the SHARED wiring manifests.
 *
 * TWO of them, matched by name to the two server manifests, because this
 * package serves two mounts at different privilege levels (see `./server` for
 * why they must never merge). payments-backend's merchant/buyer pair is the
 * same shape and the precedent for it.
 *
 * Three absences are deliberate:
 *
 * - **No `db`.** The session lives in a signed COOKIE, not a table — which is
 *   the design decision that makes an impersonation end when the browser says
 *   so rather than when a row is cleaned up.
 * - **No `env`.** Every deployment-shaped choice (the cookie name, `secure`,
 *   the time box) is an argument to the factory.
 * - **No `permissions`.** The permission id this surface gates on is the
 *   HOST's — the config names it — because which permission admits an
 *   operator to a preview is a decision about that host's role matrix.
 *
 * The `e2e` world is declared on the operator manifest, and that declaration
 * is the point of the capability rather than a formality: the contract's own
 * note records that a shipped world nobody adopts is a few hundred lines of
 * journeys re-derived by hand in the host, undiscovered.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

/** The OPERATOR mount: start, stop and describe, behind platform authority. */
export const impersonationManifest = {
  name: '@12-apps/impersonation',
  contract: 1,
  observability: { namespace: 'impersonation' },
  e2e: { entry: '@12-apps/impersonation/e2e', world: { factory: 'defineImpersonationWorld' } },
  server: ['http'],
} as const satisfies PackageManifest;

/** The tenant PREVIEW mount: slug-scoped, gated in that tenant. */
export const impersonationPreviewManifest = {
  name: '@12-apps/impersonation-preview',
  contract: 1,
  observability: { namespace: 'impersonation' },
  server: ['http'],
} as const satisfies PackageManifest;
