/* eslint-disable test-flakiness/no-test-isolation --
   nothing here is shared between tests: every `api`/`rows` binding is a fresh
   `buildApi()` created INSIDE its own `it`, backed by a fresh in-memory db.
   The rule flags the names, not an actual cross-test dependency. */
import { describe, expect, it } from 'vitest';

import type { EntityOps, Snapshot } from '../../types';
import { createApiEntityLifecycle } from '../create-api-entity-lifecycle';
import type { LifecycleActor, LifecycleRoute } from '../context';
import type { LifecycleEntityRegistration } from '../registration';

import { createMemoryLifecycleDb } from './memory-db';

/**
 * The generated surface, end to end over the in-memory db seam (12-17): the
 * per-entity endpoints exist because a REGISTRATION exists — none of them is
 * hand-written — and their wire (paths, envelopes, statuses, pt-BR copy) is
 * byte-compatible with the future-pay routes they replace.
 */

const TENANT = 't1';

/** A tiny host entity: rows in a map, archive = flag — the ops seam. */
function memoryEntityOps(): { ops: EntityOps; rows: Map<string, Snapshot & { _archived?: boolean }> } {
  const rows = new Map<string, Snapshot & { _archived?: boolean }>();
  let nextId = 0;
  const ops: EntityOps = {
    async readSnapshot(_tenantId, entityId) {
      const row = rows.get(entityId);
      if (!row || row._archived) return null;
      const snapshot = { ...row };
      delete snapshot._archived;
      return snapshot as Snapshot;
    },
    async applySnapshot(_tenantId, entityId, snapshot) {
      const id = entityId ?? `item-${++nextId}`;
      rows.set(id, { ...snapshot });
      return id;
    },
    async archive(_tenantId, entityId) {
      const row = rows.get(entityId);
      if (!row || row._archived) return false;
      row._archived = true;
      return true;
    },
    async unarchive(_tenantId, entityId) {
      const row = rows.get(entityId);
      if (!row) return false;
      delete row._archived;
      return true;
    },
    async hardDelete(_tenantId, entityId) {
      rows.delete(entityId);
    },
  };
  return { ops, rows };
}

function buildApi(registrations?: Partial<LifecycleEntityRegistration>[]) {
  const db = createMemoryLifecycleDb();
  const { ops, rows } = memoryEntityOps();
  const api = createApiEntityLifecycle({
    db: async () => db,
    entities: (registrations ?? [{}]).map((overrides, index) => ({
      entityType: overrides.entityType ?? (index === 0 ? 'product' : `type-${index}`),
      slug: overrides.slug ?? (index === 0 ? 'products' : `type-${index}s`),
      features: { versioning: true, drafts: true, approvals: true },
      label: (snapshot) => (typeof snapshot.name === 'string' ? snapshot.name : 'Item'),
      approvePermission: 'products:approve',
      ops,
      ...overrides,
    })),
    directory: {
      getUsers: async (ids) => ids.map((id) => ({ id, name: `User ${id}` })),
    },
  });
  return { api, rows };
}

/** The seeded feature layers: everything entitled, approvals ON. */
const approver: LifecycleActor = {
  tenantId: TENANT,
  userId: 'u-approver',
  entitlements: { versioning: true, drafts: true, approvals: true },
  settings: { versioning: true, drafts: true, approvals: true },
  permissions: new Set(['products:approve']),
};

const editor: LifecycleActor = { ...approver, userId: 'u-editor', permissions: new Set() };

const noApprovals: LifecycleActor = {
  ...approver,
  settings: { versioning: true, drafts: true, approvals: false },
};

function routeOf(routes: LifecycleRoute[], method: string, path: string): LifecycleRoute {
  const found = routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found;
}

const call = (
  route: LifecycleRoute,
  actor: LifecycleActor,
  params: Record<string, string> = {},
  body?: unknown,
  query: Record<string, string> = {},
) => route.handle({ actor, params, query, body });

describe('route generation from registrations', () => {
  it('emits the seven per-entity endpoints per registration, plus the shared six', () => {
    const { api } = buildApi([{}, { entityType: 'supplier', slug: 'suppliers' }]);
    const ids = api.routes.map((route) => `${route.method} ${route.path}`);
    for (const slug of ['products', 'suppliers']) {
      expect(ids).toContain(`GET /${slug}/:id/versions`);
      expect(ids).toContain(`POST /${slug}/:id/versions/:version/restore`);
      expect(ids).toContain(`GET /${slug}/:id/draft`);
      expect(ids).toContain(`PUT /${slug}/:id/draft`);
      expect(ids).toContain(`GET /${slug}/drafts`);
      expect(ids).toContain(`POST /${slug}/drafts`);
      expect(ids).toContain(`DELETE /${slug}/drafts/:draftId`);
      expect(ids).toContain(`POST /${slug}/drafts/:draftId/publish`);
    }
    expect(ids).toContain('GET /recycle-bin');
    expect(ids).toContain('POST /recycle-bin/:entryId/restore');
    expect(ids).toContain('DELETE /recycle-bin/:entryId');
    expect(ids).toContain('GET /approvals');
    expect(ids).toContain('POST /approvals/:requestId/approve');
    expect(ids).toContain('POST /approvals/:requestId/reject');
  });

  it('emits the literal /drafts routes before the /:id ones (mount order)', () => {
    const { api } = buildApi();
    const paths = api.routes.filter((r) => r.path.startsWith('/products')).map((r) => r.path);
    expect(paths.indexOf('/products/drafts')).toBeLessThan(paths.indexOf('/products/:id/draft'));
  });

  it('rejects duplicate and reserved slugs at build time', () => {
    expect(() => buildApi([{}, { entityType: 'x', slug: 'products' }])).toThrow(/slug/);
    expect(() => buildApi([{ slug: 'recycle-bin' }])).toThrow(/slug/);
    expect(() => buildApi([{}, { entityType: 'product', slug: 'others' }])).toThrow(
      /entityType/,
    );
  });
});

describe('versions + restore', () => {
  it('lists history with resolved actor names and the published version', async () => {
    const { api } = buildApi();
    const handle = api.entity('product');
    const created = await handle.lifecycle.create(handle.context(approver), { name: 'Coca' });
    if (created.status !== 'applied') throw new Error('expected applied');
    await handle.lifecycle.update(handle.context(approver), created.entityId, { name: 'Coca 2L' });

    const response = await call(
      routeOf(api.routes, 'GET', '/products/:id/versions'),
      approver,
      { id: created.entityId },
    );
    expect(response.status).toBe(200);
    const { data } = response.body as {
      data: { versions: { version: number; actorName: string | null }[]; publishedVersion: number };
    };
    expect(data.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(data.versions[0]?.actorName).toBe('User u-approver');
    expect(data.publishedVersion).toBe(2);
  });

  it('restores a version (200 applied) and parks it for a non-approver (202)', async () => {
    const { api, rows } = buildApi();
    const handle = api.entity('product');
    const created = await handle.lifecycle.create(handle.context(approver), { name: 'v1' });
    if (created.status !== 'applied') throw new Error('expected applied');
    const id = created.entityId;
    await handle.lifecycle.update(handle.context(approver), id, { name: 'v2' });

    const restore = routeOf(api.routes, 'POST', '/products/:id/versions/:version/restore');
    const applied = await call(restore, approver, { id, version: '1' });
    expect(applied.status).toBe(200);
    expect((applied.body as { data: { applied: boolean } }).data.applied).toBe(true);
    expect(rows.get(id)?.name).toBe('v1');

    const parked = await call(restore, editor, { id, version: '2' });
    expect(parked.status).toBe(202);
    const outcome = (parked.body as { data: { applied: boolean; requestId: string } }).data;
    expect(outcome.applied).toBe(false);
    expect(outcome.requestId).toBeTruthy();
    // Nothing changed yet — the write is parked, not applied.
    expect(rows.get(id)?.name).toBe('v1');
  });

  it('answers 403 with the pt-BR copy when versioning is off for the tenant', async () => {
    const { api } = buildApi();
    const offActor: LifecycleActor = { ...approver, settings: { versioning: false } };
    const response = await call(
      routeOf(api.routes, 'GET', '/products/:id/versions'),
      offActor,
      { id: 'whatever' },
    );
    expect(response.status).toBe(403);
    expect((response.body as { error: string }).error).toBe(
      'Este recurso não está ativo para esta loja.',
    );
  });
});

describe('drafts', () => {
  it('saves, reads, lists, publishes and discards through the generated wire', async () => {
    const { api, rows } = buildApi();
    const handle = api.entity('product');
    const created = await handle.lifecycle.create(handle.context(noApprovals), { name: 'Live' });
    if (created.status !== 'applied') throw new Error('expected applied');
    const id = created.entityId;

    const put = await call(
      routeOf(api.routes, 'PUT', '/products/:id/draft'),
      noApprovals,
      { id },
      { data: { name: 'Rascunho' } },
    );
    expect(put.status).toBe(200);
    const draft = (put.body as { data: { draft: { id: string; entityId: string } } }).data.draft;
    expect(draft.entityId).toBe(id);
    // The live record is untouched by a draft save.
    expect(rows.get(id)?.name).toBe('Live');

    const get = await call(routeOf(api.routes, 'GET', '/products/:id/draft'), noApprovals, { id });
    expect((get.body as { data: { draft: { id: string } | null } }).data.draft?.id).toBe(draft.id);

    const list = await call(routeOf(api.routes, 'GET', '/products/drafts'), noApprovals);
    expect((list.body as { data: { drafts: unknown[] } }).data.drafts).toHaveLength(1);

    const published = await call(
      routeOf(api.routes, 'POST', '/products/drafts/:draftId/publish'),
      noApprovals,
      { draftId: draft.id },
    );
    expect(published.status).toBe(200);
    expect(rows.get(id)?.name).toBe('Rascunho');

    // A published draft is no longer open — discard is now a 404.
    const discard = await call(
      routeOf(api.routes, 'DELETE', '/products/drafts/:draftId'),
      noApprovals,
      { draftId: draft.id },
    );
    expect(discard.status).toBe(422);
  });

  it('starts a NEW-item draft (entityId null) and creates the record on publish', async () => {
    const { api, rows } = buildApi();
    const post = await call(
      routeOf(api.routes, 'POST', '/products/drafts'),
      noApprovals,
      {},
      { data: { name: 'Novo item' } },
    );
    expect(post.status).toBe(200);
    const draft = (post.body as { data: { draft: { id: string; entityId: null } } }).data.draft;
    expect(draft.entityId).toBeNull();

    const published = await call(
      routeOf(api.routes, 'POST', '/products/drafts/:draftId/publish'),
      noApprovals,
      { draftId: draft.id },
    );
    expect(published.status).toBe(200);
    const outcome = (published.body as { data: { entityId: string } }).data;
    expect(rows.get(outcome.entityId)?.name).toBe('Novo item');
  });

  it('rejects a body without a data object as the 400 the wire promises', async () => {
    const { api } = buildApi();
    const response = await call(
      routeOf(api.routes, 'POST', '/products/drafts'),
      noApprovals,
      {},
      { nope: true },
    );
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toBe('Dados inválidos.');
  });
});

describe('recycle bin', () => {
  it('round-trips a soft delete: bin list → restore; purge flips to PURGED', async () => {
    const { api, rows } = buildApi();
    const handle = api.entity('product');
    const ctx = handle.context(noApprovals);
    const created = await handle.lifecycle.create(ctx, { name: 'Suco' });
    if (created.status !== 'applied') throw new Error('expected applied');
    await handle.lifecycle.softDelete(ctx, created.entityId);

    const list = routeOf(api.routes, 'GET', '/recycle-bin');
    const listed = await call(list, noApprovals);
    const entries = (listed.body as { data: { entries: { id: string; label: string }[] } }).data
      .entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('Suco');

    const restored = await call(
      routeOf(api.routes, 'POST', '/recycle-bin/:entryId/restore'),
      noApprovals,
      { entryId: entries[0]!.id },
    );
    expect(restored.status).toBe(204);
    expect(restored.body).toBeUndefined();
    expect(rows.get(created.entityId)?._archived).toBeUndefined();

    // Restored entries leave the bin — the list is empty again.
    const relisted = await call(list, noApprovals);
    expect((relisted.body as { data: { entries: unknown[] } }).data.entries).toHaveLength(0);

    // Delete again, then purge for good: 204, and the record is hard-gone.
    await handle.lifecycle.softDelete(ctx, created.entityId);
    const second = await call(list, noApprovals);
    const entryId = (second.body as { data: { entries: { id: string }[] } }).data.entries[0]!.id;
    const purged = await call(routeOf(api.routes, 'DELETE', '/recycle-bin/:entryId'), noApprovals, {
      entryId,
    });
    expect(purged.status).toBe(204);
    expect(rows.has(created.entityId)).toBe(false);
  });

  it('is tenant-scoped: a neighbour tenant sees nothing and cannot restore', async () => {
    const { api } = buildApi();
    const handle = api.entity('product');
    const ctx = handle.context(noApprovals);
    const created = await handle.lifecycle.create(ctx, { name: 'Isolado' });
    if (created.status !== 'applied') throw new Error('expected applied');
    await handle.lifecycle.softDelete(ctx, created.entityId);

    const neighbour: LifecycleActor = { ...noApprovals, tenantId: 't2' };
    const listed = await call(routeOf(api.routes, 'GET', '/recycle-bin'), neighbour);
    expect((listed.body as { data: { entries: unknown[] } }).data.entries).toHaveLength(0);

    const own = await call(routeOf(api.routes, 'GET', '/recycle-bin'), noApprovals);
    const entryId = (own.body as { data: { entries: { id: string }[] } }).data.entries[0]!.id;
    const foreign = await call(
      routeOf(api.routes, 'POST', '/recycle-bin/:entryId/restore'),
      neighbour,
      { entryId },
    );
    expect(foreign.status).toBe(404);
  });
});

describe('approvals', () => {
  async function park(api: ReturnType<typeof buildApi>['api']): Promise<string> {
    const handle = api.entity('product');
    const result = await handle.lifecycle.create(handle.context(editor), { name: 'Pendente' });
    if (result.status !== 'pending-approval') throw new Error('expected a parked write');
    return result.requestId;
  }

  it('lists pending requests with labels and requester names', async () => {
    const { api } = buildApi();
    await park(api);
    const listed = await call(routeOf(api.routes, 'GET', '/approvals'), approver);
    const requests = (
      listed.body as {
        data: { requests: { label: string; requestedByName: string | null; status: string }[] };
      }
    ).data.requests;
    expect(requests).toHaveLength(1);
    expect(requests[0]?.label).toBe('Pendente');
    expect(requests[0]?.status).toBe('PENDING');
    expect(requests[0]?.requestedByName).toBe('User u-editor');
  });

  it('approve applies the parked write; a second decision is the 409', async () => {
    const { api, rows } = buildApi();
    const requestId = await park(api);
    const approve = routeOf(api.routes, 'POST', '/approvals/:requestId/approve');

    const decided = await call(approve, approver, { requestId });
    expect(decided.status).toBe(200);
    expect((decided.body as { data: { applied: boolean } }).data.applied).toBe(true);
    expect([...rows.values()].some((row) => row.name === 'Pendente')).toBe(true);

    const again = await call(approve, approver, { requestId });
    expect(again.status).toBe(409);
    expect((again.body as { error: string }).error).toBe('Esta solicitação já foi decidida.');
  });

  it('a non-approver cannot decide (403, pt-BR copy); reject keeps the record unwritten', async () => {
    const { api, rows } = buildApi();
    const requestId = await park(api);

    const denied = await call(
      routeOf(api.routes, 'POST', '/approvals/:requestId/approve'),
      editor,
      { requestId },
    );
    expect(denied.status).toBe(403);
    expect((denied.body as { error: string }).error).toBe(
      'Você não tem permissão para aprovar alterações.',
    );

    const rejected = await call(
      routeOf(api.routes, 'POST', '/approvals/:requestId/reject'),
      approver,
      { requestId },
      { note: 'não agora' },
    );
    expect(rejected.status).toBe(204);
    expect([...rows.values()].some((row) => row.name === 'Pendente')).toBe(false);

    const listed = await call(
      routeOf(api.routes, 'GET', '/approvals'),
      approver,
      {},
      undefined,
      { status: 'REJECTED' },
    );
    const requests = (
      listed.body as { data: { requests: { decisionNote: string | null }[] } }
    ).data.requests;
    expect(requests[0]?.decisionNote).toBe('não agora');
  });

  it('answers 404 with the pt-BR copy for a request that never existed', async () => {
    const { api } = buildApi();
    const response = await call(
      routeOf(api.routes, 'POST', '/approvals/:requestId/approve'),
      approver,
      { requestId: 'nope' },
    );
    expect(response.status).toBe(404);
    expect((response.body as { error: string }).error).toBe('Esta solicitação não existe mais.');
  });
});
