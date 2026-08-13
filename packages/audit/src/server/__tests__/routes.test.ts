/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the "database" here is the in-memory fake in `fake-db.ts`, built fresh per
   case by `harness()`: there is no real database to isolate and no state that
   outlives a test. The rules fire on the seam's method NAMES (`seed`, `count`)
   and on locals the heuristic reads as shared. */
import { describe, expect, it, vi } from 'vitest';

import { FUTURE_PAY_AUDIT_VOCABULARY } from '../../index';
import type { AuditLogPageWire } from '../../core/types';
import type { AuditActor, AuditRequest, AuditServerConfig } from '../config';
import { createApiAudit } from '../create-api-audit';

import { fakeAuditDb, type FakeAuditDb } from './fake-db';

/**
 * The listing surface (12-14) — the package half of future-pay's
 * `app/api/admin/[tenantSlug]/audit-logs/route.ts` and its route test.
 *
 * The cases an adversarial reader asks for come first: can a caller read another
 * tenant's trail, can they read it without the permission, and can any request
 * input reach the tenant scope. Everything after that is the surface's contract.
 */
const TENANT = 'client-1';
const OTHER = 'client-2';

interface Harness {
  api: ReturnType<typeof createApiAudit>;
  fake: FakeAuditDb;
  get(path: '/audit-logs' | '/audit-logs/actors', query?: Record<string, string>): Promise<{
    status: number;
    body: unknown;
  }>;
}

function harness(options: {
  actor?: AuditActor | null;
  directory?: AuditServerConfig['directory'];
} = {}): Harness {
  const fake = fakeAuditDb();
  const actor =
    options.actor === undefined
      ? { tenantId: TENANT, userId: 'u-owner', permissions: ['audit:read'] }
      : options.actor;
  const api = createApiAudit({
    db: () => Promise.resolve(fake.db),
    resolveActor: () => actor,
    vocabulary: FUTURE_PAY_AUDIT_VOCABULARY,
    ...(options.directory ? { directory: options.directory } : {}),
  });
  const request = (query: Record<string, string>): AuditRequest => ({
    params: { tenantSlug: 'my-store' },
    query,
    header: () => undefined,
  });
  return {
    api,
    fake,
    async get(path, query = {}) {
      const route = api.routes.find((candidate) => candidate.path === path);
      if (!route) throw new Error(`no route for ${path}`);
      return route.handle(request(query));
    },
  };
}

const page = (body: unknown): AuditLogPageWire => body as AuditLogPageWire;

describe('tenancy', () => {
  it('never returns another tenant entry, and counts only its own', async () => {
    const h = harness();
    h.fake.seed(
      { clientId: TENANT, resourceId: 'mine-old', createdAt: new Date('2026-07-01T10:00:00Z') },
      { clientId: TENANT, resourceId: 'mine-new', createdAt: new Date('2026-07-20T10:00:00Z') },
      { clientId: OTHER, resourceId: 'theirs' },
    );

    const response = await h.get('/audit-logs');

    expect(response.status).toBe(200);
    // Newest first — the log has one ordering and it is not negotiable.
    expect(page(response.body).data.map((entry) => entry.resourceId)).toEqual([
      'mine-new',
      'mine-old',
    ]);
    expect(page(response.body).pagination.total).toBe(2);
  });

  it('scopes EVERY query to the actor tenant, whatever the request says', async () => {
    // The attack surface: a caller adding a tenant to the query string. The wire
    // schema declares no such key and zod strips what it does not declare, so the
    // predicate the package built must still carry the actor's tenant — and only
    // that one.
    const h = harness();
    h.fake.seed({ clientId: OTHER, resourceId: 'theirs' });

    const response = await h.get('/audit-logs', {
      clientId: OTHER,
      tenantId: OTHER,
      client_id: OTHER,
      where: JSON.stringify({ clientId: OTHER }),
    });

    expect(page(response.body).data).toEqual([]);
    expect(h.fake.wheres.length).toBeGreaterThan(0);
    for (const where of h.fake.wheres) expect(where.clientId).toBe(TENANT);
  });

  it('scopes the actor options to the tenant too', async () => {
    const listActors = vi.fn().mockResolvedValue([{ id: 'u-1', name: 'Ana' }]);

    const h = harness({ directory: { getUsers: () => Promise.resolve([]), listActors } });
    const response = await h.get('/audit-logs/actors', { tenantId: OTHER });

    expect(listActors).toHaveBeenCalledWith(TENANT);
    expect(response.body).toEqual({ data: [{ id: 'u-1', label: 'Ana' }] });
  });
});

describe('the gate', () => {
  it('answers 401 for an unresolved caller', async () => {
    const h = harness({ actor: null });

    for (const path of ['/audit-logs', '/audit-logs/actors'] as const) {
      const response = await h.get(path);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Não autenticado.' });
    }
  });

  it('answers 403 without the read permission — on BOTH routes', async () => {
    // The actor options are the same security surface as the trail: they name who
    // works at the store.
    const h = harness({
      actor: { tenantId: TENANT, userId: 'u-waiter', permissions: ['orders:read'] },
    });

    for (const path of ['/audit-logs', '/audit-logs/actors'] as const) {
      const response = await h.get(path);
      expect(response.status).toBe(403);
    }
  });

  it('fails CLOSED for an actor carrying no permissions at all', async () => {
    // A host that forgot to resolve them must read nothing, not everything —
    // there is deliberately no "the host already checked" mode.
    const h = harness({ actor: { tenantId: TENANT, userId: 'u-x', permissions: [] } });

    expect((await h.get('/audit-logs')).status).toBe(403);
  });

  it('accepts a wildcard permission and a platform operator', async () => {
    const wildcard = harness({
      actor: { tenantId: TENANT, userId: 'u-owner', permissions: ['*'] },
    });
    expect((await wildcard.get('/audit-logs')).status).toBe(200);

    const platform = harness({
      actor: { tenantId: TENANT, userId: null, permissions: [], isSuper: true },
    });
    expect((await platform.get('/audit-logs')).status).toBe(200);
  });

  it('honours a host gate permission id', async () => {
    const fake = fakeAuditDb();
    const api = createApiAudit({
      db: () => Promise.resolve(fake.db),
      resolveActor: () => ({ tenantId: TENANT, userId: 'u', permissions: ['trail.view'] }),
      vocabulary: FUTURE_PAY_AUDIT_VOCABULARY,
      gatePermissions: { read: 'trail.view' },
    });
    const route = api.routes.find((candidate) => candidate.path === '/audit-logs');

    const response = await route?.handle({ params: {}, query: {}, header: () => undefined });

    expect(response?.status).toBe(200);
  });
});

describe('filters', () => {
  const seedThree = (h: Harness): void =>
    h.fake.seed(
      {
        clientId: TENANT,
        actorUserId: 'u-ana',
        action: 'payment.capture',
        resourceId: 'o-1',
        createdAt: new Date('2026-07-20T10:00:00Z'),
      },
      {
        clientId: TENANT,
        actorUserId: null,
        action: 'order.cancel',
        resourceId: 'o-2',
        createdAt: new Date('2026-07-19T10:00:00Z'),
      },
      {
        clientId: TENANT,
        actorUserId: 'u-ana',
        action: 'stock.loss',
        resourceType: 'loss_event',
        resourceId: 'loss-1',
        createdAt: new Date('2026-06-01T09:00:00Z'),
      },
    );

  const ids = async (h: Harness, query: Record<string, string>): Promise<string[]> =>
    page((await h.get('/audit-logs', query)).body).data.map((entry) => entry.resourceId);

  it('filters by actor, action, resource type/id, keyword and day range', async () => {
    const h = harness();
    seedThree(h);

    expect((await ids(h, { actorUserId: 'u-ana' })).sort()).toEqual(['loss-1', 'o-1']);
    expect(await ids(h, { action_in: 'order.cancel' })).toEqual(['o-2']);
    expect(await ids(h, { resourceType_in: 'loss_event' })).toEqual(['loss-1']);
    expect(await ids(h, { resourceId: 'o-1' })).toEqual(['o-1']);
    // `q` searches the resource id (contains, case-insensitive).
    expect(await ids(h, { q: 'LOSS' })).toEqual(['loss-1']);
    expect(await ids(h, { from: '2026-06-01', to: '2026-06-01' })).toEqual(['loss-1']);
  });

  it('treats `to` as an INCLUSIVE day, whatever time the entry was written', async () => {
    // The bug this guards: forwarding `to` as its own UTC midnight hides every
    // entry written after 00:00 on the last day of the range — which is the day
    // somebody filtering by date is usually asking about.
    const h = harness();
    h.fake.seed({
      clientId: TENANT,
      resourceId: 'late',
      createdAt: new Date('2026-07-20T23:59:59Z'),
    });

    expect(await ids(h, { from: '2026-07-20', to: '2026-07-20' })).toEqual(['late']);
  });

  it('paginates, and reports the totals for the whole filtered set', async () => {
    const h = harness();
    seedThree(h);

    const first = page((await h.get('/audit-logs', { page: '1', pageSize: '2' })).body);
    expect(first.data).toHaveLength(2);
    expect(first.pagination).toEqual({
      total: 3,
      page: 1,
      pageSize: 2,
      pageCount: 2,
      hasNextPage: true,
    });

    const second = page((await h.get('/audit-logs', { page: '2', pageSize: '2' })).body);
    expect(second.data).toHaveLength(1);
    expect(second.pagination.hasNextPage).toBe(false);
  });

  it('caps pageSize and ignores nonsense paging rather than failing', async () => {
    const h = harness();
    seedThree(h);

    const capped = page((await h.get('/audit-logs', { pageSize: '5000' })).body);
    expect(capped.pagination.pageSize).toBe(100);
    const nonsense = page((await h.get('/audit-logs', { page: 'abc', pageSize: '-3' })).body);
    expect(nonsense.pagination).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('answers 400 for a malformed date or an unknown filter value', async () => {
    const h = harness();

    expect((await h.get('/audit-logs', { from: '20-07-2026' })).status).toBe(400);
    expect((await h.get('/audit-logs', { action_in: 'order.vanish' })).status).toBe(400);
    expect((await h.get('/audit-logs', { resourceType_in: 'invoice' })).status).toBe(400);
    // The message names the offending field so a caller can fix it.
    expect((await h.get('/audit-logs', { from: 'nope' })).body).toEqual({
      error: 'Filtros inválidos (from).',
    });
  });

  it('lets an exact resourceId win over the keyword — both target one column', async () => {
    const h = harness();
    h.fake.seed(
      { clientId: TENANT, resourceId: 'order-1' },
      { clientId: TENANT, resourceId: 'order-12' },
    );

    expect(await ids(h, { resourceId: 'order-1', q: 'order' })).toEqual(['order-1']);
  });
});

describe('identity resolution', () => {
  it('resolves BOTH id columns in ONE batched call', async () => {
    // Resolving only the actor leaves "X em nome de <uuid>" on screen: a row that
    // names one person and reduces the other to an id, which defeats the point of
    // recording the pair. A second call would mostly re-fetch what the first had.
    const getUsers = vi
      .fn()
      .mockResolvedValue([
        { id: 'u-real', name: 'Ana' },
        { id: 'u-target', email: 'bruno@loja.test' },
      ]);
    const h = harness({ directory: { getUsers } });
    h.fake.seed({
      clientId: TENANT,
      actorUserId: 'u-real',
      onBehalfOfUserId: 'u-target',
      actorRole: 'SUPERADMIN',
    });

    const [entry] = page((await h.get('/audit-logs')).body).data;

    expect(getUsers).toHaveBeenCalledTimes(1);
    expect((getUsers.mock.calls[0]?.[0] as string[]).sort()).toEqual(['u-real', 'u-target']);
    expect(entry).toMatchObject({
      actorUserId: 'u-real',
      actorName: 'Ana',
      onBehalfOfUserId: 'u-target',
      // No name → the e-mail, which is still a person; the id is the last resort.
      onBehalfOfName: 'bruno@loja.test',
    });
  });

  it('de-duplicates the ids it asks for', async () => {
    const getUsers = vi.fn().mockResolvedValue([]);
    const h = harness({ directory: { getUsers } });
    h.fake.seed(
      { clientId: TENANT, actorUserId: 'u-real', onBehalfOfUserId: 'u-target' },
      { clientId: TENANT, actorUserId: 'u-target' },
      { clientId: TENANT, actorUserId: 'u-real' },
    );

    await h.get('/audit-logs');

    expect((getUsers.mock.calls[0]?.[0] as string[]).sort()).toEqual(['u-real', 'u-target']);
  });

  it('leaves names null with no directory, and asks nobody', async () => {
    const h = harness();
    h.fake.seed({ clientId: TENANT, actorUserId: 'u-real', onBehalfOfUserId: 'u-t' });

    const [entry] = page((await h.get('/audit-logs')).body).data;

    expect(entry).toMatchObject({ actorName: null, onBehalfOfName: null });
  });

  it('answers an empty option list when the host wired no roster', async () => {
    // Not a 501: an empty list is what the viewer needs to fall back to a
    // free-text actor id, and an error status would make a host that legitimately
    // has no roster look broken.
    const h = harness();

    expect(await h.get('/audit-logs/actors')).toEqual({ status: 200, body: { data: [] } });
  });
});

describe('the surface itself', () => {
  it('mounts /audit-logs/actors BEFORE /audit-logs', async () => {
    // Route order is a rule of the surface: a framework that matches greedily must
    // not route the literal segment into the listing.
    const h = harness();

    expect(h.api.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /audit-logs/actors',
      'GET /audit-logs',
    ]);
  });

  it('exposes no write endpoint at all', async () => {
    // Entries are written transactionally by the mutations themselves, so the read
    // surface is the whole surface. A POST here would be a way to forge history.
    const h = harness();

    expect(h.api.routes.every((route) => route.method === 'GET')).toBe(true);
  });
});
