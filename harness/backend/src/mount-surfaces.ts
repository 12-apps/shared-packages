import type { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

import type { Hosts } from './app';
import { DISCOUNTS_MOUNT_PATH } from './discounts-host';
import { SHIFT_MOUNT_PATH } from './shift-host';
import { RESEARCH_MOUNT_PATH, researchListingRoutes } from './research-host';
import { BILLING_MOUNT_PATH } from './billing-host';
import { FEATURE_FLAGS_MOUNT_PATH, wireFeatureFlags } from './feature-flags-host';
import { IMPERSONATION_PLATFORM_PATH } from './impersonation-host';
import { demoEntityRoutes } from './lifecycle-demo-crud';
import { observabilityHarnessRoutes, observabilityRoutes } from './observability-host';
import { REALTIME_MOUNT_PATH } from './realtime-host';
import { reportsRouter } from './reports-host';
import { savedReportDb } from './saved-report-db';

/**
 * Every package's surface, in MOUNT ORDER — the half of `createHarnessBackend`
 * whose ordering is load-bearing (see the header).
 */
export function mountSurfaces(app: Hono, hosts: Hosts, pg: PGlite): void {
  mountTenantSurfaces(app, hosts, pg);
  mountAccountSurfaces(app, hosts);
}

/**
 * Everything under `/api/admin/:tenantSlug` — the store's own surfaces, in the
 * order the header's more-specific-first rule requires.
 */
function mountTenantSurfaces(app: Hono, hosts: Hosts, pg: PGlite): void {
  // FIRST — before the host's `/catalog-items/:id` CRUD below. See the header:
  // reversing these two blocks is a red test, not a silent 404.
  app.route('/api/admin/:tenantSlug', hosts.lifecycle.router);

  // The host's OWN demo-entity CRUD (12-17) — the glue a real adopter has.
  const demo = demoEntityRoutes(hosts.lifecycle, pg);
  app.get('/api/admin/:tenantSlug/catalog-items', demo.list);
  app.post('/api/admin/:tenantSlug/catalog-items', demo.save);
  app.get('/api/admin/:tenantSlug/catalog-items/:id', demo.getOne);
  app.put('/api/admin/:tenantSlug/catalog-items/:id', demo.save);
  app.delete('/api/admin/:tenantSlug/catalog-items/:id', demo.remove);
  app.delete('/api/admin/:tenantSlug/demo-suppliers/:id', demo.removeSupplier);

  // BEFORE the broader `/api/admin/:tenantSlug` mounts below: this file's rule
  // is more-specific-first, and Hono resolves by registration order.
  app.route('/api/admin/:tenantSlug/desk-session', hosts.impersonation.tenant);
  app.route(IMPERSONATION_PLATFORM_PATH, hosts.impersonation.platform);

  // @12-apps/feature-flags (FUT-884): user-level beta grants, the platform
  // operator's surface. Its own prefix, so it sits with the other platform
  // mounts and ahead of the broader `/api` routes below. The reset control is
  // the packaged journeys' way back to the seeded cohort.
  const featureFlags = wireFeatureFlags();
  app.route(FEATURE_FLAGS_MOUNT_PATH, featureFlags.router);
  app.route('/__harness/feature-flags', featureFlags.harnessRoutes);

  app.route('/api/admin/:tenantSlug', hosts.entitlements.router);
  app.route('/api/admin/:tenantSlug', reportsRouter(savedReportDb(pg)));
  app.route('/api/admin/:tenantSlug', hosts.rbac.router);
  app.route('/api/admin/:tenantSlug', hosts.audit.router);
  app.route('/api/admin/:tenantSlug', hosts.onboarding.router);
  app.route(DISCOUNTS_MOUNT_PATH, hosts.discounts.router);
  app.route(SHIFT_MOUNT_PATH, hosts.shift.router);
  app.route(RESEARCH_MOUNT_PATH, hosts.research.router);
  // BESIDE the packaged router, on the same prefix and the same path: the
  // history grid's `GET /research` is the one route of the seventeen the
  // package deliberately does not declare (its query grammar and envelope come
  // from the host's own search machinery), while the START on that path IS the
  // package's. Sharing a path and splitting the verbs is the arrangement a real
  // adopter has, so the harness has it too.
  app.route(RESEARCH_MOUNT_PATH, researchListingRoutes(pg));
}

/**
 * Everything that is NOT a store's: the signed-in user's own surfaces, the two
 * that carry no tenant at all, and the three at the origin root.
 *
 * Split from the tenant half for the size gate, and along the seam this file
 * already documents — the `/api/admin/:tenantSlug` prefix ends here, and every
 * mount below is broader than every mount above, which is the same
 * more-specific-first order stated once more between the two halves.
 */
function mountAccountSurfaces(app: Hono, hosts: Hosts): void {
  // @12-apps/billing (FUT-340). TENANT-FREE like the notifications surface
  // below, and for a sharper reason: a card on file is a standing financial
  // commitment by the person who signed up, so it is scoped to the resolved
  // OWNER and never to a path segment a caller can choose. First of the two by
  // this file's more-specific-first rule — `/api/account/billing` is the
  // narrower prefix.
  app.route(BILLING_MOUNT_PATH, hosts.billing.router);
  // Self-scoped and TENANT-FREE (12-15): the account surface every signed-in
  // user has, wherever their stores are.
  app.route('/api/account', hosts.notifications.router);
  app.route('/__harness/notifications', hosts.notifications.harnessRoutes);
  // Mounted at the API root, not under the tenant prefix: the surface carries BOTH its
  // paths, and the account one takes no tenant slug at all. AFTER the notification
  // mount above, deliberately: `/api` is the broader prefix of the two, and this file's
  // header rule is that the more specific mount goes on first.
  app.route(REALTIME_MOUNT_PATH, hosts.realtime.events.router);
  // 12-18, also at the API root and for the same reason: consent is a fact about the
  // CALLER, so neither of its two paths carries a tenant slug.
  app.route('/api', hosts.appShell.router);
  /**
   * @12-apps/auth (12-25). Three mounts, and the split between them is the
   * point:
   *
   *  - `/api/auth/**` is REAL Auth.js, served by `createApiAuth`'s handler —
   *    the session endpoint, the CSRF token and the credentials callback the
   *    packaged sign-in form posts to. Mounted with `app.all` over a `*` because
   *    it is one handler for a whole URL space rather than a router;
   *  - `/api/auth/email/**` is `emailAuthRouter`, mounted BEFORE it for this
   *    file's more-specific-first rule — Hono resolves by registration order,
   *    and the Auth.js catch-all would otherwise swallow every one of them and
   *    answer its own 404;
   *  - `/api/platform/auth-settings` is `emailAuthSettingsRouter`, and it is
   *    somewhere else entirely on purpose. Those two switches turn a sign-in
   *    method off for EVERYBODY, so they do not belong behind the same gate as
   *    "reset my password".
   */
  app.route('/api/auth/email', hosts.auth.emailRouter);
  app.all('/api/auth/*', (c) => hosts.auth.apiAuth.handler(c.req.raw));
  app.route('/api/platform/auth-settings', hosts.auth.settingsRouter);
  app.route('/__harness', hosts.auth.harnessRoutes);
  // The last three mount at the ROOT and have to — the header says why for each.
  // `/` is the broadest prefix here, so they go on LAST by the same
  // more-specific-first rule the `/api` mounts above follow.
  // @12-apps/observability-frontend's host half: the served DSN, and the ingest
  // a DSN pointed at this origin delivers to.
  //
  // The ingest path carries a `:projectId` segment, which LOOKS like the kind
  // of wildcard this file's more-specific-first rule exists for. It is not: the
  // route is POST-only and three segments ending in a literal `envelope`, and
  // no other mount here has that shape — measured, registering it FIRST changes
  // nothing. So its position is tidiness rather than a fix, and
  // `tests/observability-host.test.ts` asserts the property that actually
  // holds (it matches its own shape and nothing else) rather than an ordering
  // rule that would pass whatever the order was.
  app.route('/', observabilityRoutes());
  app.route('/__harness/observability', observabilityHarnessRoutes());

  app.route('/', hosts.storage.router);
  app.route('/', hosts.mcpOauth.router);
  app.route('/', hosts.pwa.router);
}
