/**
 * Everything `@12-apps/audit` needs from a HOST, in one object (12-14).
 *
 * What is genuinely the host's, and all that is here: who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), which
 * tenant the slug names, what the user ids look like as people (the directory),
 * and where the one owned table lives (the PGlite-backed seam in `audit-db.ts`).
 * Everything else — the writer, the gate, the parsing, the statuses, the
 * envelope, the retention predicates — is the package's, which is the entire
 * claim under test.
 */
import type { PGlite } from '@electric-sql/pglite';
import { FUTURE_PAY_AUDIT_VOCABULARY } from '@12-apps/audit';
import { auditRouter } from '@12-apps/audit/hono';
import type { AuditUserIdentity } from '@12-apps/audit/server';

import { auditDb } from './audit-db';

/** The mounted surface's type — inferred, so nothing here restates it. */
export type HarnessAudit = ReturnType<typeof auditHost>;

/** The primary tenant — the one the SPA page and most specs drive. */
export const AUDIT_TENANT_ID = 'audit-harness';

/**
 * A second tenant. Tenant isolation is the property with the highest stakes on
 * an audit trail, and a harness with one tenant cannot exercise it at the
 * tarball level — every isolation proof would otherwise live only in the
 * package's in-memory suite.
 */
export const AUDIT_TENANT_B_ID = 'audit-harness-b';

/** The people. A real host joins its user table; this one holds the roster. */
export const AUDIT_USERS: readonly (AuditUserIdentity & { tenantId: string })[] = [
  { id: 'owner-1', name: 'Ana Proprietária', email: 'ana@harness.dev', tenantId: AUDIT_TENANT_ID },
  { id: 'chef-1', name: 'Camila Barbosa', email: 'camila@harness.dev', tenantId: AUDIT_TENANT_ID },
  // No `name`: the directory falls back to the e-mail, which is still a person.
  { id: 'support-1', email: 'suporte@futurepay.dev', tenantId: AUDIT_TENANT_ID },
  { id: 'owner-b', name: 'Beatriz Vizinha', email: 'beatriz@b.dev', tenantId: AUDIT_TENANT_B_ID },
];

const DIRECTORY = new Map(AUDIT_USERS.map((user) => [user.id, user]));

/** The headers a spec sets to act as someone else; the SPA's default is the owner. */
const ACTOR_HEADER = 'x-audit-user';
const SUBJECT_HEADER = 'x-audit-on-behalf-of';
const PERMISSIONS_HEADER = 'x-audit-permissions';

/** The tenant a slug names — the host's own resolution, not the package's. */
const tenantFor = (slug: string | undefined): string =>
  slug === 'tenant-b' ? AUDIT_TENANT_B_ID : AUDIT_TENANT_ID;

export function auditHost(pg: PGlite) {
  return auditRouter({
    db: () => Promise.resolve(auditDb(pg)),
    vocabulary: FUTURE_PAY_AUDIT_VOCABULARY,
    trackedModels: ['Product'],
    retention: { floorDays: 365 },
    directory: {
      getUsers: (ids) =>
        Promise.resolve(ids.map((id) => DIRECTORY.get(id)).filter((user) => user !== undefined)),
      listActors: (tenantId) =>
        Promise.resolve(AUDIT_USERS.filter((user) => user.tenantId === tenantId)),
    },
    /**
     * WHO is calling. A real host reads a session; this reads headers, which is
     * the one thing a browser genuinely cannot have — and it is the host's own
     * code either way, which is the point: the PACKAGE never reads a header.
     */
    resolveActor: (request) => {
      const userId = request.header(ACTOR_HEADER) ?? 'owner-1';
      if (userId === 'anonymous') return null;
      const permissions = request.header(PERMISSIONS_HEADER)?.split(',') ?? ['audit:read'];
      return {
        tenantId: tenantFor(request.params.tenantSlug),
        userId,
        permissions,
        role: userId === 'support-1' ? 'SUPERADMIN' : 'OWNER',
        scope: tenantFor(request.params.tenantSlug),
        onBehalfOfUserId: request.header(SUBJECT_HEADER) ?? null,
      };
    },
  });
}

/** Wipe + reseed the trail — the `/__harness/reset` contract. */
export async function reseedAudit(pg: PGlite, audit: HarnessAudit): Promise<void> {
  // Append-only at the MODEL layer, so teardown goes raw — the same reason the
  // retention sweep does (and the blind spot the package documents).
  await pg.exec('TRUNCATE TABLE audit_logs');
  const write = (entry: Parameters<HarnessAudit['write']>[1]) =>
    audit.write(auditDbFor(pg), entry);
  // Written through the PACKAGE'S writer, not by INSERT: the seeded rows are then
  // the writer's own output, so the viewer is reading what a real mutation
  // produces rather than what a fixture author imagined it produces.
  await audit.withActorContext(stampedAs('owner-1'), async () => {
    await write({
      clientId: AUDIT_TENANT_ID,
      action: 'order.cancel',
      resourceType: 'order',
      resourceId: 'order-1001',
      before: { fulfillmentStatus: 'PENDING', totalCents: 4200 },
      after: { fulfillmentStatus: 'CANCELED' },
    });
  });
  await audit.withActorContext(stampedAs('chef-1'), async () => {
    await write({
      clientId: AUDIT_TENANT_ID,
      action: 'stock.loss',
      resourceType: 'inventory_item',
      resourceId: 'item-carne',
      after: { quantityDelta: -3, reason: 'Quebra' },
    });
  });
  // A SYSTEM entry: the webhook path, which names nobody.
  await write({
    clientId: AUDIT_TENANT_ID,
    action: 'payment.capture',
    resourceType: 'order',
    resourceId: 'order-1002',
    actorUserId: null,
    after: { status: 'PAID', method: 'PIX', amountCents: 990 },
  });
  // An IMPERSONATED entry: support acting as the owner. The pair is what the
  // viewer must render, and what a spec asserts on.
  await audit.withActorContext(stampedAs('support-1', 'owner-1'), async () => {
    await write({
      clientId: AUDIT_TENANT_ID,
      action: 'comanda.force_close',
      resourceType: 'table_session',
      resourceId: 'mesa-7',
      before: { status: 'OPEN' },
      after: { status: 'CLOSED' },
    });
  });
  // The neighbour's row, which must never appear in tenant A's trail.
  await write({
    clientId: AUDIT_TENANT_B_ID,
    action: 'order.cancel',
    resourceType: 'order',
    resourceId: 'order-b-1',
    actorUserId: 'owner-b',
  });
  await spreadSeedInstants(pg);
}

/**
 * The seed order, oldest first — the sequence the writes above happen in.
 *
 * Read back newest-first, the reverse of this IS the trail, which is what
 * `audit-endpoints.test.ts` asserts. That claim held only by luck until now:
 * see {@link spreadSeedInstants}.
 */
const SEED_ORDER = ['order-1001', 'item-carne', 'order-1002', 'mesa-7', 'order-b-1'];

/**
 * Give the seeded rows distinct instants, in seed order.
 *
 * `created_at` is `timestamp(3)` and takes the statement's own clock, so five
 * writes into an in-process PGlite routinely land in the SAME millisecond. The
 * delegate's total order is `created_at DESC, id DESC` (`audit-db.ts:145`) and
 * `id` is a random `uuid()` — so on a tie the trail comes back in an order
 * chosen by a random number, and "newest first" was asserted against whichever
 * draw the run happened to get. It passes on a slow machine, where the writes
 * straddle a millisecond, and fails on a fast one.
 *
 * Not hypothetical: it went red on `main`, and because `Release` needs this
 * job, `@12-apps/stock-domain@2.0.0` did not publish.
 *
 * Stamping makes the ordering claim true by construction rather than by timing.
 * Each row keeps its own DAY — one case filters `?from=<today>&to=<today>` and
 * expects all four — and moves to midday, so a seed that straddles midnight
 * cannot change which day that is. Raw SQL for the same reason the `TRUNCATE`
 * above is raw: the trail is append-only at the model layer, and this is
 * fixture setup rather than something the writer should be able to do.
 */
async function spreadSeedInstants(pg: PGlite): Promise<void> {
  for (const [index, resourceId] of SEED_ORDER.entries()) {
    await pg.query(
      `UPDATE audit_logs
          SET created_at = date_trunc('day', created_at)
                         + INTERVAL '12 hours'
                         + make_interval(secs => $1)
        WHERE resource_id = $2`,
      [index, resourceId],
    );
  }
}

/** A request shaped like the one the middleware receives, for the seed writes. */
function stampedAs(userId: string, subject?: string) {
  const headers: Record<string, string> = { [ACTOR_HEADER]: userId };
  if (subject) headers[SUBJECT_HEADER] = subject;
  return {
    params: {},
    query: {},
    header: (name: string) => headers[name],
  };
}

/** The seam again, for the seed writes (the router does not expose its own). */
const auditDbFor = (pg: PGlite) => auditDb(pg);
