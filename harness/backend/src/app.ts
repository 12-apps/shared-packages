/**
 * The harness's backend, as an app.
 *
 * Built separately from the listener so a test can drive the very routes the
 * browser drives — `app.request()` and a socket reach the same handlers, and a
 * test of a hand-rolled second app would prove nothing about the one that
 * serves the SPA.
 *
 * Four surfaces, and the split between them is the point:
 *
 *  - `/api/admin/:tenantSlug/reports/**` is @12-apps/report-builder's, mounted
 *    whole;
 *  - `/api/admin/:tenantSlug/{entitlements,plan,plan/request}` is
 *    @12-apps/entitlements', mounted whole the same way (entitlements-host.ts);
 *  - `/api/admin/:tenantSlug/{roles,permissions,team}/**` is @12-apps/rbac's
 *    (12-13), mounted whole — including the `/roles` read the reports surface
 *    consumes for its "Cargos específicos" allowlist picker, which used to be
 *    a host stub answering an empty page and is now the real seeded catalog;
 *  - `/api/admin/:tenantSlug/{catalog-items,demo-suppliers}/{drafts,:id/…}`
 *    plus `{recycle-bin,approvals}/**` is @12-apps/entity-lifecycle's (12-17),
 *    GENERATED from two registrations; the host keeps only its seams
 *    (lifecycle-host.ts) and the demo-entity CRUD (lifecycle-demo-crud.ts),
 *    which is the glue a real adopter already has;
 *  - `/__harness/**` is the SUITE'S, and belongs to neither.
 *
 * MOUNT ORDER is load-bearing for the lifecycle surface (ADOPTING rule 7).
 * Hono resolves by REGISTRATION order, mounted sub-routers included, and a
 * host route shaped `/:slug/:id` is two segments — exactly like the package's
 * literal `GET /:slug/drafts`. Registered first, the host's route captures it
 * and the drafts endpoint starts answering the host's "not found" while every
 * other lifecycle endpoint keeps working, which is what makes it a silent
 * breakage. So `lifecycle.router` goes on BEFORE the demo CRUD below. It is
 * safe in that direction: the package emits no 2-segment `:id` GET under a
 * collection slug, so a real id still falls through to the host. The demo host
 * carries a `GET /catalog-items/:id` for the sole purpose of making a
 * violation red rather than silent (`tests/lifecycle-endpoints.test.ts`,
 * "mount order").
 */
import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

import { entitlementDenialResponse, isEntitlementDenial } from '@12-apps/entitlements/server';

import { createEntitlementsHost, TENANT } from './entitlements-host';
import { applyLifecycleMigrations } from './lifecycle-db';
import { demoEntityRoutes } from './lifecycle-demo-crud';
import { createLifecycleDemoTables, lifecycleHost, reseedLifecycle } from './lifecycle-host';
import { applyRbacMigrations } from './rbac-db';
import { rbacHost, reseedRbac } from './rbac-host';
import { reportsRouter } from './reports-host';
import { openReportsDb, reseed, savedReportDb } from './saved-report-db';

export interface HarnessBackend {
  app: Hono;
  /** Closing it is the caller's job; the server itself never does. */
  close: () => Promise<void>;
}

export async function createHarnessBackend(): Promise<HarnessBackend> {
  const pg: PGlite = await openReportsDb();
  // The RBAC tables arrive the way a host deploy applies them: the package's
  // own migrations, read out of the installed tarball (12-13). This also
  // retires the `/roles` stub that used to answer the reports "Cargos
  // específicos" picker with an empty page — the picker now reads the REAL
  // roles endpoint, seeded catalog and all.
  await applyRbacMigrations(pg);
  const rbac = rbacHost(pg);
  await reseedRbac(pg, rbac);
  // The lifecycle tables arrive the same way (12-17): the package's own
  // migrations out of the installed tarball; the two DEMO entity tables are
  // the host's (a real adopter's schema already has its own).
  await applyLifecycleMigrations(pg);
  await createLifecycleDemoTables(pg);
  const lifecycle = lifecycleHost(pg);
  await reseedLifecycle(pg);
  const entitlements = createEntitlementsHost();
  const app = new Hono();

  // Liveness, and what Playwright's `webServer` waits on before starting the
  // SPA: the database is migrated and seeded by the time this answers, so the
  // first spec never races the first migration.
  app.get('/health', (c) => c.json({ ok: true }));

  /**
   * Back to the seeded fixture, for the suite between cases.
   *
   * Real persistence is the whole point of this server and it is also what
   * makes a suite order-dependent: the case that archives `r1` would leave it
   * archived for every case after it, and for every later RUN. The in-browser
   * backend hid that by rebuilding its array on each page load. This endpoint
   * is the replacement, and it is deliberately explicit — a reset that
   * happened on its own (per request, on a timer) would be a persistence layer
   * that quietly is not one.
   */
  app.post('/__harness/reset', async (c) => {
    await reseed(pg);
    await reseedRbac(pg, rbac);
    await reseedLifecycle(pg);
    entitlements.reset();
    return c.body(null, 204);
  });

  /**
   * A HOST endpoint standing behind the package's guard — the arrangement
   * every gated host route has. What it proves is the denial WIRE: the free
   * tenant answers 402 here with the body the react half's 402 interceptor
   * parses into an upsell prompt.
   */
  app.get('/api/admin/:tenantSlug/audit-demo', async (c) => {
    try {
      await entitlements.requireEntitlement(TENANT, 'audit');
      return c.json({ entries: [] });
    } catch (error) {
      if (!isEntitlementDenial(error)) throw error;
      const denial = entitlementDenialResponse(error);
      return c.json(denial.body, denial.status as 402);
    }
  });

  // FIRST — before the host's `/catalog-items/:id` CRUD below. See the header:
  // reversing these two blocks is a red test, not a silent 404.
  app.route('/api/admin/:tenantSlug', lifecycle.router);

  // The host's OWN demo-entity CRUD (12-17) — the glue a real adopter has.
  const demo = demoEntityRoutes(lifecycle, pg);
  app.get('/api/admin/:tenantSlug/catalog-items', demo.list);
  app.post('/api/admin/:tenantSlug/catalog-items', demo.save);
  app.get('/api/admin/:tenantSlug/catalog-items/:id', demo.getOne);
  app.put('/api/admin/:tenantSlug/catalog-items/:id', demo.save);
  app.delete('/api/admin/:tenantSlug/catalog-items/:id', demo.remove);
  app.delete('/api/admin/:tenantSlug/demo-suppliers/:id', demo.removeSupplier);

  app.route('/api/admin/:tenantSlug', entitlements.router);
  app.route('/api/admin/:tenantSlug', reportsRouter(savedReportDb(pg)));
  app.route('/api/admin/:tenantSlug', rbac.router);

  return { app, close: () => pg.close() };
}
