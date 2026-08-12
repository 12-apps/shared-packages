/**
 * The harness's backend, as an app.
 *
 * Built separately from the listener so a test can drive the very routes the
 * browser drives — `app.request()` and a socket reach the same handlers, and a
 * test of a hand-rolled second app would prove nothing about the one that
 * serves the SPA.
 *
 * Three surfaces, and the split between them is the point:
 *
 *  - `/api/admin/:tenantSlug/reports/**` is @12-apps/report-builder's, mounted
 *    whole;
 *  - `/api/admin/:tenantSlug/{roles,permissions,team}/**` is @12-apps/rbac's
 *    (12-13), mounted whole — including the `/roles` read the reports surface
 *    consumes for its "Cargos específicos" allowlist picker, which used to be
 *    a host stub answering an empty page and is now the real seeded catalog;
 *  - `/__harness/**` is the SUITE'S, and belongs to neither.
 */
import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

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
    return c.body(null, 204);
  });

  app.route('/api/admin/:tenantSlug', reportsRouter(savedReportDb(pg)));
  app.route('/api/admin/:tenantSlug', rbac.router);

  return { app, close: () => pg.close() };
}
