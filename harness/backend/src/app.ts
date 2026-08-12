/**
 * The harness's backend, as an app.
 *
 * Built separately from the listener so a test can drive the very routes the
 * browser drives — `app.request()` and a socket reach the same handlers, and a
 * test of a hand-rolled second app would prove nothing about the one that
 * serves the SPA.
 *
 * Seven surfaces, and the split between them is the point:
 *
 *  - `/api/admin/:tenantSlug/reports/**` is @12-apps/report-builder's, mounted
 *    whole;
 *  - `/api/admin/:tenantSlug/{entitlements,plan,plan/request}` is
 *    @12-apps/entitlements', mounted whole the same way (entitlements-host.ts);
 *  - `/api/admin/:tenantSlug/{roles,permissions,team}/**` is @12-apps/rbac's
 *    (12-13), mounted whole — including the `/roles` read the reports surface
 *    consumes for its "Cargos específicos" allowlist picker, which used to be
 *    a host stub answering an empty page and is now the real seeded catalog;
 *  - `/api/admin/:tenantSlug/onboarding/:featureKey` is @12-apps/onboarding's
 *    (12-23), the guided-progress surface its React half persists through;
 *  - `/api/oauth/**` plus `/.well-known/**` is @12-apps/mcp's OAuth 2.1
 *    authorization server (12-23), mounted at the ORIGIN ROOT because a
 *    connector reads the two discovery documents from the origin;
 *  - `/manifest.webmanifest` and `/sw.js` are @12-apps/pwa's (12-23), also at
 *    the root — a worker's directory bounds its scope and the manifest is
 *    linked from a static `index.html` that cannot know a prefix;
 *  - `/__harness/**` is the SUITE'S, and belongs to none of them.
 */
import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

import { entitlementDenialResponse, isEntitlementDenial } from '@12-apps/entitlements/server';

import { createEntitlementsHost, TENANT } from './entitlements-host';
import { mcpProbeRouter } from './harness-mcp-probe';
import { applyMcpMigrations, mcpOauthHost, reseedMcpOauth } from './mcp-oauth-host';
import { applyOnboardingMigrations, onboardingHost, reseedOnboarding } from './onboarding-host';
import { pwaHost } from './pwa-host';
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
  // Same arrangement for the three surfaces added in 12-23: each package's own
  // migration, applied out of its own installed tarball. A host that had to hand-
  // write this DDL would be a host the partial never reached.
  await applyOnboardingMigrations(pg);
  await applyMcpMigrations(pg);
  const onboarding = onboardingHost(pg);
  const mcpOauth = mcpOauthHost(pg);
  const pwa = pwaHost();
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
    await reseedOnboarding(pg);
    await reseedMcpOauth(pg);
    entitlements.reset();
    return c.body(null, 204);
  });

  // The suite's own window onto what the authorization server wrote, and its
  // one-endpoint resource server (harness-mcp-probe.ts). Hashes and flags only.
  app.route('/', mcpProbeRouter(pg, mcpOauth));

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

  app.route('/api/admin/:tenantSlug', entitlements.router);
  app.route('/api/admin/:tenantSlug', reportsRouter(savedReportDb(pg)));
  app.route('/api/admin/:tenantSlug', rbac.router);
  app.route('/api/admin/:tenantSlug', onboarding.router);
  // The last two mount at the ROOT, and have to: `.well-known` documents and a
  // service worker are read from the origin, never from under a prefix.
  app.route('/', mcpOauth.router);
  app.route('/', pwa.router);

  return { app, close: () => pg.close() };
}
