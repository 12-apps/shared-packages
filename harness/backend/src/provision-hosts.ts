/**
 * Every package's tables + host, applied the way a real deploy would: each
 * package's OWN migrations, read out of its own installed tarball. A host that
 * had to hand-write this DDL would be a host the partial never reached.
 *
 * Its own file, not a section of `app.ts`, for the reason the extraction from
 * `createHarnessBackend` gave in the first place: the two halves outgrew the
 * size gate. The seam is unchanged — PROVISIONING here, MOUNTING in
 * `mount-surfaces.ts` — and mount order (see `app.ts`'s header) lives entirely
 * on the mounting side. What pushed it over this time was the fourth adoption
 * whose schema is the HOST's (`billing-db.ts`), which is a shape this list is
 * going to keep acquiring.
 */
import type { PGlite } from '@electric-sql/pglite';
import { createInlineRealtimeDriver } from '@12-apps/realtime';

import { appShellHost } from './app-shell-host';
import { applyAuditMigrations } from './audit-db';
import { auditHost, reseedAudit } from './audit-host';
import { applyAuthMigrations, reseedAuth } from './auth-db';
import { authHost } from './auth-host';
import { billingHost, provisionBilling } from './billing-host';
import { applyDiscountMigrations } from './discounts-db';
import { createDiscountCatalogTables, discountsHost, reseedDiscounts } from './discounts-host';
import { createEntitlementsHost } from './entitlements-host';
import { impersonationHost } from './impersonation-host';
import { applyLifecycleMigrations } from './lifecycle-db';
import { createLifecycleDemoTables, lifecycleHost, reseedLifecycle } from './lifecycle-host';
import { applyMcpMigrations, mcpOauthHost } from './mcp-oauth-host';
import { applyNotificationMigrations } from './notifications-db';
import {
  createNotificationHostTables,
  notificationsHost,
  reseedNotifications,
} from './notifications-host';
import { applyOnboardingMigrations, onboardingHost } from './onboarding-host';
import { pwaHost } from './pwa-host';
import { applyRbacMigrations } from './rbac-db';
import { rbacHost, reseedRbac } from './rbac-host';
import { paymentsHost } from './payments-host';
import { applyPaymentsMigrations } from './payments-stores';
import { createPrismaClient } from './prisma';
import { applyRealtimeMigrations } from './realtime-db';
import { realtimeHost } from './realtime-host';
import { provisionResearch, researchHost } from './research-host';
import { provisionShift, shiftHost } from './shift-host';
import { createStorageHost } from './storage-host';

/**
 * The half that touches the DATABASE: every package's own migrations, the
 * host-owned tables beside them, and the seeds.
 *
 * Split from the assembly below along the line the surfaces themselves draw —
 * a package here either ships a schema the harness replays or needs one the
 * host authors, and everything in `provisionHosts` needs neither. The hosts
 * this returns are the ones that have to be BUILT mid-way, because a seed
 * calls into them.
 */
async function provisionStored(pg: PGlite) {
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
  // 12-23: onboarding, and the OAuth 2.1 authorization server's tables.
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
  // 12-16: the outbox table, again out of the package's own tarball.
  await applyRealtimeMigrations(pg);
  // 12-25: the e-mail + password tables. HAND-WRITTEN, unlike every other
  // surface here, because @12-apps/auth ships no migration and owns no model —
  // an account is the host's row. See auth-db.ts for why that is the design.
  await applyAuthMigrations(pg);
  await reseedAuth(pg);
  // FUT-244: the promotions tables, again out of the package's own tarball. Its
  // migration is REPLAY-SAFE by construction (it adopts an existing `discounts`
  // table rather than demanding a baseline), so applying it here is a no-op on a
  // database that already has one. `harness_categories` / `harness_menu_items`
  // are the HOST's — a discount targets a host's catalog, which is exactly the
  // separation `ForeignTargetError` protects.
  await applyDiscountMigrations(pg);
  await createDiscountCatalogTables(pg);
  await reseedDiscounts(pg);
  // FUT-146: the shift tables plus the ledger the package does NOT ship — see
  // `provisionShift`, and `shift-db.ts` for why that split is the adoption.
  const shift = await provisionShift(pg);
  // FUT-430: five tables, eight migrations, seventeen routes — see research-host.ts.
  const research = await provisionResearch(pg);
  // FUT-340: four routes, three ports and a schema the PACKAGE deliberately
  // does not ship — see billing-db.ts.
  const billing = await provisionBilling(pg);
  // 12-20: no migrations — @12-apps/storage owns no models. What it needs from a
  // host is the two tables its reference probes read (storage-host.ts) and a
  // directory to keep objects in.
  const storage = await createStorageHost(pg);
  // @12-apps/payments-backend is the one surface here built on the GENERATED
  // client rather than on hand-written SQL: the package ships Prisma stores,
  // and a consumer that re-wrote them would be testing its own SQL. See
  // `payments-stores.ts`.
  await applyPaymentsMigrations(pg);
  const payments = paymentsHost(await createPrismaClient(pg));
  return { rbac, audit, lifecycle, notifications, shift, research, billing, storage, payments };
}

export async function provisionHosts(pg: PGlite): Promise<Hosts> {
  const stored = await provisionStored(pg);
  // The driver is created HERE and shared, for the reason on
  // `HarnessBackend.realtimeDriver`.
  const realtimeDriver = createInlineRealtimeDriver({ logger: console });
  return {
    ...stored,
    auth: authHost(pg),
    realtimeDriver,
    realtime: realtimeHost(pg, realtimeDriver),
    onboarding: onboardingHost(pg),
    discounts: discountsHost(pg),
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
  auth: ReturnType<typeof authHost>;
  rbac: ReturnType<typeof rbacHost>;
  audit: ReturnType<typeof auditHost>;
  lifecycle: ReturnType<typeof lifecycleHost>;
  notifications: ReturnType<typeof notificationsHost>;
  realtime: ReturnType<typeof realtimeHost>;
  realtimeDriver: RealtimeDriver;
  onboarding: ReturnType<typeof onboardingHost>;
  discounts: ReturnType<typeof discountsHost>;
  shift: ReturnType<typeof shiftHost>;
  research: ReturnType<typeof researchHost>;
  billing: ReturnType<typeof billingHost>;
  mcpOauth: ReturnType<typeof mcpOauthHost>;
  pwa: ReturnType<typeof pwaHost>;
  entitlements: ReturnType<typeof createEntitlementsHost>;
  impersonation: ReturnType<typeof impersonationHost>;
  appShell: ReturnType<typeof appShellHost>;
  storage: Awaited<ReturnType<typeof createStorageHost>>;
  payments: ReturnType<typeof paymentsHost>;
}

