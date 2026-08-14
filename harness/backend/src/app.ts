/**
 * The harness's backend, as an app.
 *
 * Built separately from the listener so a test can drive the very routes the
 * browser drives — `app.request()` and a socket reach the same handlers, and a
 * test of a hand-rolled second app would prove nothing about the one that
 * serves the SPA.
 *
 * Twelve surfaces, and the split between them is the point:
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
 *  - `/api/admin/:tenantSlug/{catalog-items,demo-suppliers}/{drafts,:id/…}`
 *    plus `{recycle-bin,approvals}/**` is @12-apps/entity-lifecycle's (12-17),
 *    GENERATED from two registrations; the host keeps only its seams
 *    (lifecycle-host.ts) and the demo-entity CRUD (lifecycle-demo-crud.ts),
 *    which is the glue a real adopter already has;
 *  - `/api/oauth/**` plus `/.well-known/**` is @12-apps/mcp's OAuth 2.1
 *    authorization server (12-23), mounted at the ORIGIN ROOT because a
 *    connector reads the two discovery documents from the origin;
 *  - `/manifest.webmanifest` and `/sw.js` are @12-apps/pwa's (12-23), also at
 *    the root — a worker's directory bounds its scope and the manifest is
 *    linked from a static `index.html` that cannot know a prefix;
 *  - `/api/uploads/**` is @12-apps/storage's (12-20), and deliberately NOT under
 *    `:tenantSlug`: an upload is scoped by the ACTOR the host resolves, never by
 *    a path segment a caller can choose, and the serve route answers a public
 *    `<img>` that carries no tenant at all;
 *  - `/api/admin/:tenantSlug/realtime` and `/api/account/realtime` are
 *    @12-apps/realtime's (12-16), mounted whole; the host keeps only its seams
 *    (realtime-host.ts) and the outbox's db adapter (realtime-db.ts). The
 *    matching WebSocket gateway is a THIRD process shape and lives in
 *    `server.ts`, on its own port, because that is where a port is bound;
 *  - `/api/consent/{status,terms}` is @12-apps/app-shell's (12-18), mounted whole;
 *    the host keeps only its seams (app-shell-host.ts) and owns no table for it,
 *    because the package owns no model — "has this user accepted version X" is a
 *    fact about the HOST's identity row, so here it is a Map;
 *  - `/api/admin/:tenantSlug/audit-logs/**` is @12-apps/audit's (12-14),
 *    mounted whole, with its actor-context middleware wrapped around EVERY
 *    route below — which is where a host puts it, because the stamp is what
 *    attributes the writes of every other surface too;
 *  - `/api/account/{notifications,notification-preferences,push-subscriptions}`
 *    is @12-apps/notifications' (12-15) — the only surface here that is
 *    TENANT-FREE, because every one of its endpoints is scoped to the signed-in
 *    user rather than to a store;
 *  - `/__harness/**` is the SUITE'S, and belongs to none of them.
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
import {
  createInlineRealtimeDriver,
  publishRealtimeEvent,
  tenantTopic,
  type RealtimeDriver,
} from '@12-apps/realtime';
import { enqueueRealtimeEvent } from '@12-apps/realtime/server';

import { appShellHost, mountAppShellControls } from './app-shell-host';
import { applyAuditMigrations } from './audit-db';
import { auditHost, reseedAudit } from './audit-host';
import { createEntitlementsHost, TENANT } from './entitlements-host';
import { impersonationHost, mountImpersonationDemo } from './impersonation-host';
import { mcpProbeRouter } from './harness-mcp-probe';
import { applyLifecycleMigrations } from './lifecycle-db';
import { createLifecycleDemoTables, lifecycleHost, reseedLifecycle } from './lifecycle-host';
import { applyMcpMigrations, mcpOauthHost, reseedMcpOauth } from './mcp-oauth-host';
import { applyNotificationMigrations } from './notifications-db';
import {
  createNotificationHostTables,
  notificationsHost,
  reseedNotifications,
} from './notifications-host';
import { applyOnboardingMigrations, onboardingHost, reseedOnboarding } from './onboarding-host';
import { pwaHost } from './pwa-host';
import { applyRbacMigrations } from './rbac-db';
import { rbacHost, reseedRbac } from './rbac-host';
import { applyRealtimeMigrations, realtimeOutboxWriteDb } from './realtime-db';
import { realtimeHost } from './realtime-host';
import { mountSurfaces } from './mount-surfaces';
import { openReportsDb, reseed } from './saved-report-db';
import { createStorageHost } from './storage-host';

export interface HarnessBackend {
  app: Hono;
  /** Where @12-apps/storage's driver keeps objects, so a suite can read files. */
  storageRoot: string;
  /**
   * The database itself, for suites whose subject is the SQL — a delivery row's
   * status, a JSONB round trip, an index doing its job. Reading it through an
   * endpoint the same suite would have to add is a longer way to assert less.
   */
  pg: PGlite;
  /**
   * The ONE realtime driver this process runs (12-16).
   *
   * Handed out so `server.ts` can give the same object to the gateway.
   * `configureRealtime` installs one driver per process, so sharing it is what makes
   * a publish on the API side observable by a subscription the gateway made — two
   * separately-resolved inline drivers would each be their own bus, and the socket
   * would sit open and silent, which is the failure the liveness watch exists for.
   */
  realtimeDriver: RealtimeDriver;
  /** Closing it is the caller's job; the server itself never does. */
  close: () => Promise<void>;
}

/**
 * Every package's tables + host, applied the way a real deploy would: each
 * package's OWN migrations, read out of its own installed tarball. A host that had
 * to hand-write this DDL would be a host the partial never reached.
 *
 * Extracted from `createHarnessBackend` because the two together outgrew the
 * size gate once 12-17 and 12-23 both landed — the split is along the obvious
 * seam, PROVISIONING here and MOUNTING there, and mount order (see the header)
 * lives entirely on the mounting side.
 */
async function provisionHosts(pg: PGlite): Promise<Hosts> {
  // 12-13. This also retired the `/roles` stub that used to answer the reports
  // "Cargos específicos" picker with an empty page — the picker now reads the REAL
  // roles endpoint, seeded catalog and all.
  await applyRbacMigrations(pg);
  const rbac = rbacHost(pg);
  await reseedRbac(pg, rbac);
  // 12-14: the audit table arrives the same way. Its migration is REPLAY-SAFE, so
  // applying it over a database that already has an `audit_logs` table is a no-op
  // rather than a failure — `tests/audit-migrations.test.ts` is what pins that.
  await applyAuditMigrations(pg);
  const audit = auditHost(pg);
  await reseedAudit(pg, audit);
  // 12-23: onboarding, the OAuth 2.1 authorization server, and the PWA endpoints.
  await applyOnboardingMigrations(pg);
  await applyMcpMigrations(pg);
  // 12-17: the lifecycle tables the same way; the two DEMO entity tables are the
  // host's own (a real adopter's schema already has its equivalents).
  await applyLifecycleMigrations(pg);
  await createLifecycleDemoTables(pg);
  const lifecycle = lifecycleHost(pg);
  await reseedLifecycle(pg);
  // 12-15: the notification tables the same way. `notification_audience` is the
  // HOST's — the authorization engine behind the permission fan-out.
  await applyNotificationMigrations(pg);
  await createNotificationHostTables(pg);
  const notifications = notificationsHost(pg);
  await reseedNotifications(pg, notifications);
  // 12-16: the outbox table, again out of the package's own tarball. The driver is
  // created HERE and shared, for the reason on `HarnessBackend.realtimeDriver`.
  await applyRealtimeMigrations(pg);
  const realtimeDriver = createInlineRealtimeDriver({ logger: console });
  // 12-20: no migrations — @12-apps/storage owns no models. What it needs from a
  // host is the two tables its reference probes read (storage-host.ts) and a
  // directory to keep objects in.
  const storage = await createStorageHost(pg);
  return {
    rbac,
    audit,
    lifecycle,
    storage,
    notifications,
    realtimeDriver,
    realtime: realtimeHost(pg, realtimeDriver),
    onboarding: onboardingHost(pg),
    mcpOauth: mcpOauthHost(pg),
    pwa: pwaHost(),
    entitlements: createEntitlementsHost(),
    // No migrations and no table: @12-apps/impersonation owns no model. The
    // session IS the cookie, and the trail is a port the host implements —
    // an array here, an append-only table in a real adopter.
    impersonation: impersonationHost(),
    // 12-18: no migration and no table — the shell owns no model, so its state is a
    // Map here exactly as it is a column on `users` in a real adopter.
    appShell: appShellHost(),
  };
}

/** The mounted hosts one harness server is assembled from. */
export interface Hosts {
  rbac: ReturnType<typeof rbacHost>;
  audit: ReturnType<typeof auditHost>;
  lifecycle: ReturnType<typeof lifecycleHost>;
  notifications: ReturnType<typeof notificationsHost>;
  realtime: ReturnType<typeof realtimeHost>;
  realtimeDriver: RealtimeDriver;
  onboarding: ReturnType<typeof onboardingHost>;
  mcpOauth: ReturnType<typeof mcpOauthHost>;
  pwa: ReturnType<typeof pwaHost>;
  entitlements: ReturnType<typeof createEntitlementsHost>;
  impersonation: ReturnType<typeof impersonationHost>;
  appShell: ReturnType<typeof appShellHost>;
  storage: Awaited<ReturnType<typeof createStorageHost>>;
}

/**
 * Back to the seeded fixture, for the suite between cases.
 *
 * Real persistence is the whole point of this server and it is also what makes a
 * suite order-dependent: the case that archives `r1` would leave it archived for
 * every case after it, and for every later RUN. The in-browser backend hid that by
 * rebuilding its array on each page load. This endpoint is the replacement, and it
 * is deliberately explicit — a reset that happened on its own (per request, on a
 * timer) would be a persistence layer that quietly is not one.
 */
function mountReset(app: Hono, pg: PGlite, hosts: Hosts): void {
  app.post('/__harness/reset', async (c) => {
    await reseed(pg);
    await reseedRbac(pg, hosts.rbac);
    await reseedAudit(pg, hosts.audit);
    await reseedOnboarding(pg);
    await reseedMcpOauth(pg);
    await reseedLifecycle(pg);
    await reseedNotifications(pg, hosts.notifications);
    await hosts.storage.reset();
    hosts.entitlements.reset();
    hosts.appShell.reset();
    hosts.impersonation.reset();
    return c.body(null, 204);
  });
}

/**
 * A HOST endpoint standing behind the package's guard — the arrangement every
 * gated host route has. What it proves is the denial WIRE: the free tenant answers
 * 402 here with the body the react half's 402 interceptor parses into an upsell
 * prompt.
 */
function mountEntitlementDemo(app: Hono, hosts: Hosts): void {
  app.get('/api/admin/:tenantSlug/jury-demo', async (c) => {
    try {
      await hosts.entitlements.requireEntitlement(TENANT, 'jury.deliberation');
      return c.json({ entries: [] });
    } catch (error) {
      if (!isEntitlementDenial(error)) throw error;
      const denial = entitlementDenialResponse(error);
      return c.json(denial.body, denial.status as 402);
    }
  });
}

/**
 * The suite's realtime controls — the stand-in for a domain mutation's publisher.
 *
 * Deliberately under `/__harness` rather than `/api`: nothing may mistake them for part of
 * the package's surface. Deciding WHICH mutations a screen draws is exactly what stays in a
 * host, so this is the one piece of the realtime story a harness cannot get from the package.
 */
function mountRealtimeControls(app: Hono, pg: PGlite, hosts: Hosts): void {
  app.post('/__harness/realtime/publish', async (c) => {
    const body = (await c.req.json()) as { tenantId?: string; domain?: string; type?: string };
    const tenantId = body.tenantId ?? 'tenant-a';
    // Fire-and-forget in a host; awaited here so the response means "it reached the bus".
    const result = await publishRealtimeEvent(tenantTopic(tenantId, body.domain ?? 'kitchen'), {
      type: body.type ?? 'kitchen.changed',
      // Identifiers only — the payload rule the whole bus is built on.
      data: {},
    });
    return c.json({ published: result.published, reason: result.reason ?? null });
  });

  /**
   * Enqueue through the OUTBOX inside a transaction, then report what is pending.
   *
   * The transaction is the point: a host's domain write and its event commit together, so
   * `fail` throws inside it to prove the pair is atomic in BOTH directions.
   */
  app.post('/__harness/realtime/outbox', async (c) => {
    const body = (await c.req.json()) as { domain?: string; fail?: boolean };
    const topic = tenantTopic('tenant-a', body.domain ?? 'kitchen');
    const write = async (tx: unknown): Promise<void> => {
      await enqueueRealtimeEvent(realtimeOutboxWriteDb(tx as never), {
        topic,
        type: 'kitchen.changed',
      });
      if (body.fail) throw new Error('the host write failed');
    };
    await pg.transaction(write).catch(() => undefined);
    const { rows } = await pg.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM realtime_outbox_events WHERE published_at IS NULL',
    );
    return c.json({ pending: Number(rows[0]?.count ?? '0') });
  });

  /** Drain the outbox once, so a spec can watch a durable event arrive on the wire. */
  app.post('/__harness/realtime/drain', async (c) => {
    const pass = await hosts.realtime.events.outbox?.drain();
    return c.json(pass ?? { published: 0, failed: 0, contended: 0, more: false });
  });
}

export async function createHarnessBackend(): Promise<HarnessBackend> {
  const pg: PGlite = await openReportsDb();
  const hosts = await provisionHosts(pg);
  const app = new Hono();

  // The actor-context middleware (12-14), around EVERYTHING and before every
  // mount below. A host puts it here rather than in front of the audit routes
  // alone: the stamp is what the writer and the created_by/updated_by extension
  // read, so every surface's writes need it in scope.
  app.use('*', hosts.audit.actorContext);

  // Liveness, and what Playwright's `webServer` waits on before starting the
  // SPA: the database is migrated and seeded by the time this answers, so the
  // first spec never races the first migration.
  app.get('/health', (c) => c.json({ ok: true }));
  // The impersonation write gate (12-24), in front of EVERY api route and
  // before any body is read — where a host puts it.
  app.use('/api/*', hosts.impersonation.writeGate);
  mountReset(app, pg, hosts);
  mountRealtimeControls(app, pg, hosts);
  mountAppShellControls(app, hosts.appShell);
  // Installs the driver for THIS process, which is what lets a `/__harness/publish` reach a
  // stream the SPA is holding open through Vite's proxy. No Redis: the harness is one
  // process, so inline delivery is the whole bus.
  await hosts.realtime.events.start();

  // The suite's own window onto what the authorization server wrote, and its
  // one-endpoint resource server (harness-mcp-probe.ts). Hashes and flags only.
  app.route('/', mcpProbeRouter(pg, hosts.mcpOauth));
  mountEntitlementDemo(app, hosts);
  // The host endpoints that stand BEHIND the gate above.
  mountImpersonationDemo(app, hosts.impersonation);

  mountSurfaces(app, hosts, pg);

  return {
    app,
    storageRoot: hosts.storage.root,
    pg,
    realtimeDriver: hosts.realtimeDriver,
    close: async () => {
      // Streams first, then the bus, then storage's temp dir, then the database: a stream
      // severed after its driver is gone throws into the sink rather than closing cleanly.
      await hosts.realtime.events.stop();
      hosts.storage.close();
      await pg.close();
    },
  };
}
