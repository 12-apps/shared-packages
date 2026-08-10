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
 *  - `/api/admin/:tenantSlug/reports/**` is the PACKAGE'S, mounted whole;
 *  - `/api/admin/:tenantSlug/roles` is the HOST'S — the reports surface reads
 *    it for the "Cargos específicos" allowlist picker and it is not a reports
 *    endpoint, which is why the transport has a `getRaw` at all;
 *  - `/__harness/**` is the SUITE'S, and belongs to neither.
 */
import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

import { reportsRouter } from './reports-host';
import { openReportsDb, reseed, savedReportDb } from './saved-report-db';

/**
 * The roles picker's endpoint, which belongs to the host, not to the package.
 *
 * The harness tenant has no custom roles, so an empty page is a legitimate
 * answer — and it has to be the roles endpoint's OWN envelope
 * (`{ data, pagination }`), not the reports `{ data }` one, or the picker's
 * paging loop reads `hasNextPage` off `undefined` and never terminates.
 */
const ROLES_PAGE = { data: [], pagination: { hasNextPage: false } };

export interface HarnessBackend {
  app: Hono;
  /** Closing it is the caller's job; the server itself never does. */
  close: () => Promise<void>;
}

export async function createHarnessBackend(): Promise<HarnessBackend> {
  const pg: PGlite = await openReportsDb();
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
    return c.body(null, 204);
  });

  app.get('/api/admin/:tenantSlug/roles', (c) => c.json(ROLES_PAGE));
  app.route('/api/admin/:tenantSlug', reportsRouter(savedReportDb(pg)));

  return { app, close: () => pg.close() };
}
