/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-network,
   test-flakiness/no-random-data, test-flakiness/no-test-isolation --
   the database and the socket-less-but-real HTTP path ARE the subject: these
   cases drive the PUBLISHED @12-apps/audit router through the harness's own app,
   over a real Postgres. Each case resets to the seeded fixture first. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import type { AuditLogPageWire } from '@12-apps/audit';

/**
 * The audit surface as a CONSUMER gets it (12-14): the published Hono router,
 * mounted by the harness host, answering over PGlite with rows the package's own
 * writer produced.
 *
 * This is the port of future-pay's `tests/integration/audit-log.integration.test.ts`
 * viewer half and its route test — the parts that were about the SURFACE rather
 * than about future-pay's own money paths.
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
      'mesa-7',
      'order-1002',
      'item-carne',
      'order-1001',
    ]);
  });

  it('never leaks the neighbour tenant rows', async () => {
    // Tenant B has exactly one entry, and the slug is the only thing separating
    // them — resolved by the HOST, never read by the package.
    const mine = await list();
    const theirs = await backend.app.request('/api/admin/tenant-b/audit-logs');
    const theirPage = (await theirs.json()) as AuditLogPageWire;

    expect(mine.page.data.map((entry) => entry.resourceId)).not.toContain('order-b-1');
    expect(theirPage.data.map((entry) => entry.resourceId)).toEqual(['order-b-1']);
  });

  it('carries the redacted diff the writer produced, and nothing else', async () => {
    const { page } = await list('?resourceId=order-1001');

    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      action: 'order.cancel',
      resourceType: 'order',
      before: { fulfillmentStatus: 'PENDING', totalCents: 4200 },
      after: { fulfillmentStatus: 'CANCELED' },
    });
  });

  it('names the actor through the host directory, e-mail as the fallback', async () => {
    const { page } = await list('?resourceId=item-carne');

    expect(page.data[0]).toMatchObject({ actorUserId: 'chef-1', actorName: 'Camila Barbosa' });
  });

  it('renders a system write as an entry with no actor at all', async () => {
    const { page } = await list('?resourceId=order-1002');

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
    const { page } = await list('?resourceId=mesa-7');

    expect(page.data[0]).toMatchObject({
      actorUserId: 'support-1',
      actorName: 'suporte@futurepay.dev',
      actorRole: 'SUPERADMIN',
      onBehalfOfUserId: 'owner-1',
      onBehalfOfName: 'Ana Proprietária',
    });
  });
});

describe('the filters, over a real Postgres', () => {
  const ids = async (query: string): Promise<string[]> =>
    (await list(query)).page.data.map((entry) => entry.resourceId);

  it('filters by action, resource type, actor and exact resource id', async () => {
    expect(await ids('?action_in=order.cancel')).toEqual(['order-1001']);
    expect(await ids('?resourceType_in=inventory_item')).toEqual(['item-carne']);
    expect(await ids('?actorUserId=support-1')).toEqual(['mesa-7']);
    expect(await ids('?resourceId=order-1002')).toEqual(['order-1002']);
  });

  it('searches the resource id case-insensitively', async () => {
    // ILIKE at the database, not a filter in JavaScript over a full page.
    expect(await ids('?q=ORDER-100')).toEqual(['order-1002', 'order-1001']);
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
    expect((await list('?action_in=order.vanish')).status).toBe(400);
    expect((await list('?from=31-12-2026')).status).toBe(400);
  });

  it('ignores a tenant a caller tries to name in the query string', async () => {
    const { page } = await list('?clientId=audit-harness-b&tenantId=audit-harness-b');

    expect(page.data.map((entry) => entry.resourceId)).not.toContain('order-b-1');
    expect(page.pagination.total).toBe(4);
  });
});

describe('the gate, over a real Postgres', () => {
  it('answers 401 for an unresolved caller', async () => {
    const { status } = await list('', { [HEADERS.actor]: 'anonymous' });
    expect(status).toBe(401);
  });

  it('answers 403 without the read permission, on both routes', async () => {
    const denied = { [HEADERS.perms]: 'orders:read' };
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
      'suporte@futurepay.dev',
    );

    const neighbour = await backend.app.request('/api/admin/tenant-b/audit-logs/actors');
    const neighbourBody = (await neighbour.json()) as { data: { id: string }[] };
    expect(neighbourBody.data.map((option) => option.id)).toEqual(['owner-b']);
  });
});
