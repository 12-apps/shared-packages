import type { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

import type { Hosts } from './app';
import { IMPERSONATION_PLATFORM_PATH } from './impersonation-host';
import { demoEntityRoutes } from './lifecycle-demo-crud';
import { reportsRouter } from './reports-host';
import { savedReportDb } from './saved-report-db';

/**
 * Every package's surface, in MOUNT ORDER — the half of `createHarnessBackend`
 * whose ordering is load-bearing (see the header).
 */
function mountSurfaces(app: Hono, hosts: Hosts, pg: PGlite): void {
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

  app.route('/api/admin/:tenantSlug', hosts.entitlements.router);
  app.route('/api/admin/:tenantSlug', reportsRouter(savedReportDb(pg)));
  app.route('/api/admin/:tenantSlug', hosts.rbac.router);
  app.route('/api/admin/:tenantSlug', hosts.audit.router);
  app.route('/api/admin/:tenantSlug', hosts.onboarding.router);
  // Self-scoped and TENANT-FREE (12-15): the account surface every signed-in
  // user has, wherever their stores are.
  app.route('/api/account', hosts.notifications.router);
  app.route('/__harness/notifications', hosts.notifications.harnessRoutes);
  // Mounted at the API root, not under the tenant prefix: the surface carries BOTH its
  // paths, and the account one takes no tenant slug at all. AFTER the notification
  // mount above, deliberately: `/api` is the broader prefix of the two, and this file's
  // header rule is that the more specific mount goes on first.
  app.route('/api', hosts.realtime.events.router);
  // 12-18, also at the API root and for the same reason: consent is a fact about the
  // CALLER, so neither of its two paths carries a tenant slug.
  app.route('/api', hosts.appShell.router);
  // The last three mount at the ROOT and have to — the header says why for each.
  // `/` is the broadest prefix here, so they go on LAST by the same
  // more-specific-first rule the `/api` mounts above follow.
  app.route('/', hosts.storage.router);
  app.route('/', hosts.mcpOauth.router);
  app.route('/', hosts.pwa.router);
}
