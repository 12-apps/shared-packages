/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-network,
   test-flakiness/no-random-data, test-flakiness/no-test-isolation --
   the database and the socket-less-but-real HTTP path ARE the subject: these
   cases drive the PUBLISHED @12-apps/audit router through the harness's own app,
   over a real Postgres. Each case resets to the seeded fixture first. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { AUDIT_MOUNT_PATH } from '../src/audit-host';
import type { AuditLogPageWire } from '@12-apps/audit';

/**
 * The audit surface as a CONSUMER gets it: the published Hono router, mounted by
 * the harness host against the HOST'S OWN vocabulary, answering over PGlite with
 * rows the package's own writer produced.
 *
 * That vocabulary is a lighthouse authority's, in a domain the package was not
 * extracted from — which is the point of the harness after 2.0. The package
 * ships no actions, no resources and no labels, so a consumer proof written in
 * the package's own catalog would be proving nothing at all.
 */
let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 60_000);

beforeEach(async () => {
  const response = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(response.status).toBe(204);
});

const HEADERS = { actor: 'x-audit-user', subject: 'x-audit-on-behalf-of', perms: 'x-audit-permissions' };

async function list(
  query = '',
  headers: Record<string, string> = {},
): Promise<{ status: number; page: AuditLogPageWire }> {
  const response = await backend.app.request(
    `/api/admin/tenant-a/audit-logs${query}`,
    { headers },
  );
  const body = (await response.json().catch(() => ({}))) as AuditLogPageWire;
  return { status: response.status, page: body };
}

describe('the trail, over a real Postgres', () => {
  it('returns the tenant seeded rows, newest first', async () => {
    const { status, page } = await list();

    expect(status).toBe(200);
    expect(page.pagination.total).toBe(4);
    // The fixture writes in order, so newest-first is the reverse of the seed.
    expect(page.data.map((entry) => entry.resourceId)).toEqual([
      'beacon-7',
      'lamp-1002',
      'keeper-north',
      'lamp-1001',
    ]);
  });

  it('never leaks the neighbour tenant rows', async () => {
    // Tenant B has exactly one entry, and the slug is the only thing separating
    // them — resolved by the HOST, never read by the package.
    const mine = await list();
    const theirs = await backend.app.request('/api/admin/tenant-b/audit-logs');
    const theirPage = (await theirs.json()) as AuditLogPageWire;

    expect(mine.page.data.map((entry) => entry.resourceId)).not.toContain('lamp-b-1');
    expect(theirPage.data.map((entry) => entry.resourceId)).toEqual(['lamp-b-1']);
  });

  it('carries the redacted diff the writer produced, and nothing else', async () => {
    const { page } = await list('?resourceId=lamp-1001');

    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      action: 'lamp.extinguish',
      resourceType: 'lamp',
      before: { state: 'LIT', lumens: 4200 },
      after: { state: 'DARK' },
    });
  });

  it('names the actor through the host directory, e-mail as the fallback', async () => {
    const { page } = await list('?resourceId=keeper-north');

    expect(page.data[0]).toMatchObject({ actorUserId: 'chef-1', actorName: 'Cora Wick' });
  });

  it('renders a system write as an entry with no actor at all', async () => {
    const { page } = await list('?resourceId=lamp-1002');

    expect(page.data[0]).toMatchObject({
      actorUserId: null,
      actorName: null,
      actorRole: null,
      scope: null,
    });
  });

  it('carries the impersonation PAIR end to end, both ids and both names', async () => {
    // The whole point of the package, through the real stack: the middleware
    // stamped the pair from the host's session stand-in, the writer resolved the
    // real human, the row kept both, and the listing resolved both names in one
    // directory call.
    const { page } = await list('?resourceId=beacon-7');

    expect(page.data[0]).toMatchObject({
      actorUserId: 'support-1',
      actorName: 'relief@harness.dev',
      actorRole: 'SUPERADMIN',
      onBehalfOfUserId: 'owner-1',
      onBehalfOfName: 'Ada Keeper',
    });
  });
});

describe('the filters, over a real Postgres', () => {
  const ids = async (query: string): Promise<string[]> =>
    (await list(query)).page.data.map((entry) => entry.resourceId);

  it('filters by action, resource type, actor and exact resource id', async () => {
    expect(await ids('?action_in=keeper.assign')).toEqual(['keeper-north']);
    expect(await ids('?resourceType_in=supply')).toEqual(['lamp-1002']);
    expect(await ids('?actorUserId=support-1')).toEqual(['beacon-7']);
    expect(await ids('?resourceId=lamp-1002')).toEqual(['lamp-1002']);
  });

  it('searches the resource id case-insensitively', async () => {
    // ILIKE at the database, not a filter in JavaScript over a full page.
    expect(await ids('?q=LAMP-100')).toEqual(['lamp-1002', 'lamp-1001']);
  });

  it('filters by an inclusive day range', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await ids(`?from=${today}&to=${today}`)).length).toBe(4);
    expect(await ids('?from=2020-01-01&to=2020-01-02')).toEqual([]);
  });

  it('paginates at the database, and totals the whole filtered set', async () => {
    const { page } = await list('?pageSize=2');

    expect(page.data).toHaveLength(2);
    expect(page.pagination).toMatchObject({ total: 4, pageCount: 2, hasNextPage: true });
    const second = await list('?pageSize=2&page=2');
    expect(second.page.data).toHaveLength(2);
    expect(second.page.pagination.hasNextPage).toBe(false);
  });

  it('rejects an unknown filter value and a malformed date with 400', async () => {
    // `lamp.vanish` is not in the HOST's vocabulary, and the enum the endpoint
    // validates against is built from that vocabulary — so the value the writer
    // would refuse is the value the filter refuses.
    expect((await list('?action_in=lamp.vanish')).status).toBe(400);
    expect((await list('?from=31-12-2026')).status).toBe(400);
  });

  it('ignores a tenant a caller tries to name in the query string', async () => {
    const { page } = await list('?clientId=audit-harness-b&tenantId=audit-harness-b');

    expect(page.data.map((entry) => entry.resourceId)).not.toContain('lamp-b-1');
    expect(page.pagination.total).toBe(4);
  });
});

describe('paging a burst written into ONE millisecond', () => {
  /**
   * The defect the total order closes, proven against a REAL Postgres.
   *
   * `created_at` is `timestamp(3)` and an audit trail is written in bursts — one
   * request that relights a lamp, logs its supply run and reassigns its keeper
   * writes three entries inside one transaction. Postgres guarantees NO order
   * among rows a sort cannot distinguish, and each page is a separate statement,
   * so `ORDER BY created_at DESC` alone lets page 1 and page 2 disagree about
   * the same tied group: the reader sees one entry twice and never sees another.
   *
   * The package's listing now asks for `created_at DESC, id DESC`, and the seam
   * in `src/audit-db.ts` builds its ORDER BY FROM that argument rather than from
   * its own initiative — which it used to, quietly making this harness stronger
   * than the Prisma host it stands in for.
   */
  const SAME_INSTANT = '2026-05-05 12:00:00.000';
  const BURST_SIZE = 10;

  async function seedBurst(): Promise<void> {
    // A straight INSERT through the harness's own PGlite handle: the point is a
    // GUARANTEED tie, and a writer takes the statement's own clock.
    for (let index = 0; index < BURST_SIZE; index += 1) {
      await backend.pg.query(
        `INSERT INTO audit_logs (id, client_id, action, resource_type, resource_id, created_at)
         VALUES ($1, 'audit-harness', 'lamp.relight', 'lamp', $2, $3::timestamp)`,
        [crypto.randomUUID(), `burst-${String(index).padStart(2, '0')}`, SAME_INSTANT],
      );
    }
  }

  it('shows every tied row exactly once across consecutive pages', async () => {
    await seedBurst();

    const pages = [];
    for (const page of [1, 2, 3]) {
      pages.push(await list(`?q=burst-&pageSize=4&page=${page}`));
    }
    const seen = pages.flatMap(({ page }) => page.data.map((entry) => entry.resourceId));

    expect(seen).toHaveLength(BURST_SIZE);
    expect(new Set(seen).size).toBe(BURST_SIZE);
    expect(pages[0]?.page.pagination.total).toBe(BURST_SIZE);
  });

  it('answers the same page identically when it is asked twice', async () => {
    await seedBurst();

    const first = await list('?q=burst-&pageSize=4&page=2');
    const again = await list('?q=burst-&pageSize=4&page=2');

    expect(again.page.data.map((entry) => entry.id)).toEqual(
      first.page.data.map((entry) => entry.id),
    );
  });
});

describe('the gate, over a real Postgres', () => {
  it('answers 401 for an unresolved caller', async () => {
    const { status } = await list('', { [HEADERS.actor]: 'anonymous' });
    expect(status).toBe(401);
  });

  it('answers 403 without the read permission, on both routes', async () => {
    const denied = { [HEADERS.perms]: 'charts:read' };
    expect((await list('', denied)).status).toBe(403);
    const actors = await backend.app.request('/api/admin/tenant-a/audit-logs/actors', {
      headers: denied,
    });
    expect(actors.status).toBe(403);
  });
});

describe('the actor options', () => {
  it('offers the tenant roster, and only that tenant', async () => {
    const response = await backend.app.request('/api/admin/tenant-a/audit-logs/actors');
    const body = (await response.json()) as { data: { id: string; label: string }[] };

    expect(body.data.map((option) => option.id).sort()).toEqual([
      'chef-1',
      'owner-1',
      'support-1',
    ]);
    // The e-mail stands in for a missing name — a person either way.
    expect(body.data.find((option) => option.id === 'support-1')?.label).toBe(
      'relief@harness.dev',
    );

    const neighbour = await backend.app.request('/api/admin/tenant-b/audit-logs/actors');
    const neighbourBody = (await neighbour.json()) as { data: { id: string }[] };
    expect(neighbourBody.data.map((option) => option.id)).toEqual(['owner-b']);
  });
});

describe('adopted through @12-apps/wiring, not through the per-package adapter', () => {
  it('accounts for every capability, with none unanswered', () => {
    const statuses = new Map(
      backend.hosts.audit.report.packages[0]?.capabilities.map((e) => [e.kind, e.status]),
    );

    expect(statuses.get('http')).toBe('bound');
    expect(statuses.get('observability')).toBe('bound');
    expect(statuses.get('db')).toBe('collected');
    expect([...statuses.values()]).not.toContain('unanswered');
  });

  it('keeps the routes in DESCRIPTOR order, which is a rule of the surface', () => {
    // `/audit-logs/actors` before `/audit-logs` — the package's own adapter
    // says this is "a rule of the surface, not of the host". The consumer
    // orders by specificity and the bridge registers in the order it is given,
    // so the property survives the move; reversed, the actors endpoint would
    // be swallowed by the list route and answer a page of rows.
    const paths = backend.hosts.audit.routes.map((mounted) => mounted.route.path);
    const actors = paths.indexOf('/audit-logs/actors');
    const list = paths.indexOf('/audit-logs');

    expect(actors).toBeGreaterThanOrEqual(0);
    expect(list).toBeGreaterThanOrEqual(0);
    expect(actors).toBeLessThan(list);
  });

  it('names a descriptor this host forgot to claim', () => {
    const { routes } = backend.hosts.audit;
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${AUDIT_MOUNT_PATH}${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.hosts.audit.report)).toContain(AUDIT_MOUNT_PATH);
  });
});
