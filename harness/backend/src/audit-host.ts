/**
 * Everything `@12-apps/audit` needs from a HOST, in one object.
 *
 * What is genuinely the host's, and all that is here: the VOCABULARY (what this
 * application audits, and what its rows may say), who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), which
 * tenant the slug names, what the user ids look like as people (the directory),
 * and where the one owned table lives (the PGlite-backed seam in `audit-db.ts`).
 * Everything else — the writer, the gate, the parsing, the statuses, the
 * envelope, the retention predicates, the total order — is the package's, which
 * is the entire claim under test.
 *
 * The harness is a NEUTRAL second consumer and reads like one: a lighthouse
 * authority, in a domain the package was not extracted from. It used to seed the
 * origin application's own actions and resource ids against the vocabulary the
 * package itself exported, which made the consumer proof circular.
 */
import type { PGlite } from '@electric-sql/pglite';
import { defineAuditVocabulary } from '@12-apps/audit';
import { auditRouter } from '@12-apps/audit/hono';
import type { AuditUserIdentity } from '@12-apps/audit/server';

import { auditDb } from './audit-db';

/** The mounted surface's type — inferred, so nothing here restates it. */
export type HarnessAudit = ReturnType<typeof auditHost>;

/**
 * THE host vocabulary. Declared here, in the host, and passed to both halves —
 * the package ships none and defaults to none.
 */
export const AUDIT_VOCABULARY = defineAuditVocabulary({
  actions: {
    'lamp.extinguish': { label: 'Lamp extinguished' },
    'lamp.relight': { label: 'Lamp relit' },
    'supply.deliver': { label: 'Supply run delivered' },
    'keeper.assign': { label: 'Keeper assigned' },
  },
  resources: {
    lamp: { label: 'Lamp', fields: ['state', 'lumens', 'characteristic'] },
    supply: { label: 'Supply run', fields: ['crates', 'vessel', 'status'] },
    keeper: { label: 'Keeper', fields: ['watch', 'previousWatch', 'note'] },
  },
});

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
  { id: 'owner-1', name: 'Ada Keeper', email: 'ada@harness.dev', tenantId: AUDIT_TENANT_ID },
  { id: 'chef-1', name: 'Cora Wick', email: 'cora@harness.dev', tenantId: AUDIT_TENANT_ID },
  // No `name`: the directory falls back to the e-mail, which is still a person.
  { id: 'support-1', email: 'relief@harness.dev', tenantId: AUDIT_TENANT_ID },
  { id: 'owner-b', name: 'Bram Neighbour', email: 'bram@b.dev', tenantId: AUDIT_TENANT_B_ID },
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
    vocabulary: AUDIT_VOCABULARY,
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
      action: 'lamp.extinguish',
      resourceType: 'lamp',
      resourceId: 'lamp-1001',
      before: { state: 'LIT', lumens: 4200 },
      after: { state: 'DARK' },
    });
  });
  await audit.withActorContext(stampedAs('chef-1'), async () => {
    await write({
      clientId: AUDIT_TENANT_ID,
      action: 'keeper.assign',
      resourceType: 'keeper',
      resourceId: 'keeper-north',
      after: { watch: 'MIDDLE', note: 'Storm relief' },
    });
  });
  // A SYSTEM entry: the webhook path, which names nobody.
  await write({
    clientId: AUDIT_TENANT_ID,
    action: 'supply.deliver',
    resourceType: 'supply',
    resourceId: 'lamp-1002',
    actorUserId: null,
    after: { status: 'LANDED', vessel: 'TENDER', crates: 9 },
  });
  // An IMPERSONATED entry: relief staff acting as the keeper. The pair is what
  // the viewer must render, and what a spec asserts on.
  await audit.withActorContext(stampedAs('support-1', 'owner-1'), async () => {
    await write({
      clientId: AUDIT_TENANT_ID,
      action: 'lamp.relight',
      resourceType: 'lamp',
      resourceId: 'beacon-7',
      before: { state: 'DARK' },
      after: { state: 'LIT' },
    });
  });
  // The neighbour's row, which must never appear in tenant A's trail.
  await write({
    clientId: AUDIT_TENANT_B_ID,
    action: 'lamp.extinguish',
    resourceType: 'lamp',
    resourceId: 'lamp-b-1',
    actorUserId: 'owner-b',
  });
  await spreadSeedInstants(pg);
}

/**
 * The seed order, oldest first — the sequence the writes above happen in.
 *
 * Read back newest-first, the reverse of this IS the trail, which is what
 * `audit-endpoints.test.ts` asserts. That claim held only by luck until the
 * stamping below: see {@link spreadSeedInstants}.
 */
const SEED_ORDER = ['lamp-1001', 'keeper-north', 'lamp-1002', 'beacon-7', 'lamp-b-1'];

/**
 * Give the seeded rows distinct instants, in seed order.
 *
 * `created_at` is `timestamp(3)` and takes the statement's own clock, so five
 * writes into an in-process PGlite routinely land in the SAME millisecond, and
 * `id` is a random `uuid()`. Before the package's listing carried an `id`
 * tie-break, a tie came back in an order chosen by a random number, and "newest
 * first" was asserted against whichever draw the run happened to get: it passed
 * on a slow machine, where the writes straddle a millisecond, and failed on a
 * fast one. It went red on `main`, and because `Release` needs this job, a
 * sibling package's major never published.
 *
 * The package now asks for a TOTAL order, so a tie is resolved deterministically
 * rather than by the engine's discretion — but this fixture keeps stamping,
 * because the claim these cases make is about SEED ORDER specifically, and
 * `id DESC` over random uuids is deterministic without being the seed's order.
 * Each row keeps its own DAY — one case filters `?from=<today>&to=<today>` and
 * expects all four — and moves to midday, so a seed that straddles midnight
 * cannot change which day that is. Raw SQL for the same reason the `TRUNCATE`
 * above is raw: the trail is append-only at the model layer, and this is fixture
 * setup rather than something the writer should be able to do.
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
