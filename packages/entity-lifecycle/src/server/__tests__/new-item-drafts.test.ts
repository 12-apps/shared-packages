/* eslint-disable test-flakiness/no-test-isolation --
   nothing here is shared between tests: every `api` is a fresh `buildApi()`
   created INSIDE its own `it`, over a fresh in-memory db. The rule flags the
   name, not a cross-test dependency (as in `create-api.test.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityOps, Snapshot } from '../../types';
import type { LifecycleActor, LifecycleRoute } from '../context';
import type { LifecycleDb } from '../db';
import { createApiEntityLifecycle } from '../create-api-entity-lifecycle';
import { PT_BR_LIFECYCLE_MESSAGES } from '../pt-BR';
import type { LifecycleEntityRegistration } from '../registration';

import { createMemoryLifecycleDb } from './memory-db';

/**
 * New-item drafts, opted into per collection (FUT-3244): update in place by
 * the draft's id, resume the caller's own, sweep the untouched — and nothing
 * at all for a collection that did not opt in.
 */

const DAY_MS = 86_400_000;

// "Newest" and "untouched since" are both read off the clock, so the clock is
// the test's: every write lands a second after the one before it.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The pinned clock, in ms. */
const pinnedNow = (): number => vi.getMockedSystemTime()?.getTime() ?? 0;

const aSecondLater = (): void => {
  vi.setSystemTime(pinnedNow() + 1000);
};

function memoryOps(): { ops: EntityOps; rows: Map<string, Snapshot> } {
  const rows = new Map<string, Snapshot>();
  let next = 0;
  const ops: EntityOps = {
    readSnapshot: async (_tenant, id) => rows.get(id) ?? null,
    async applySnapshot(_tenant, id, snapshot) {
      const key = id ?? `item-${++next}`;
      rows.set(key, { ...snapshot });
      return key;
    },
    archive: async (_tenant, id) => rows.delete(id),
    unarchive: async () => false,
    async hardDelete(_tenant, id) {
      rows.delete(id);
    },
  };
  return { ops, rows };
}

/** Products opt in (unless `optIn: false`); suppliers never do. */
function buildApi(
  productOverrides: Partial<LifecycleEntityRegistration> = {},
  optIn = true,
  wrapDb: (db: LifecycleDb) => LifecycleDb = (db) => db,
) {
  const db = wrapDb(createMemoryLifecycleDb());
  const { ops, rows } = memoryOps();
  const base = {
    features: { versioning: true, drafts: true, approvals: true },
    label: () => 'Item',
    approvePermission: 'products:approve',
    ops,
  };
  const api = createApiEntityLifecycle({
    messages: PT_BR_LIFECYCLE_MESSAGES,
    db: async () => db,
    entities: [
      {
        ...base,
        entityType: 'product',
        slug: 'products',
        ...(optIn ? { newItemDrafts: {} } : {}),
        ...productOverrides,
      },
      { ...base, entityType: 'supplier', slug: 'suppliers' },
    ],
  });
  return { api, rows };
}

const owner: LifecycleActor = {
  tenantId: 't1',
  userId: 'u-owner',
  entitlements: { versioning: true, drafts: true, approvals: true },
  settings: { versioning: true, drafts: true, approvals: false },
  permissions: new Set(['products:approve']),
};
const colleague: LifecycleActor = { ...owner, userId: 'u-colleague' };
/** Approvals on, and no right to decide them: every write parks. */
const parked: LifecycleActor = {
  ...owner,
  settings: { ...owner.settings, approvals: true },
  permissions: new Set(),
};
const neighbour: LifecycleActor = { ...owner, tenantId: 't2' };
const draftsOff: LifecycleActor = { ...owner, settings: { ...owner.settings, drafts: false } };

type Api = ReturnType<typeof buildApi>['api'];

function routeOf(api: Api, method: string, path: string): LifecycleRoute {
  const found = api.routes.find((route) => route.method === method && route.path === path);
  if (!found) throw new Error(`No route ${method} ${path}`);
  return found;
}

const hasRoute = (api: Api, method: string, path: string): boolean =>
  api.routes.some((route) => route.method === method && route.path === path);

interface DraftBody {
  id: string;
  entityId: string | null;
  data: Snapshot;
  status: string;
}

const draftOf = (response: { body?: unknown }): DraftBody | null =>
  (response.body as { data: { draft: DraftBody | null } }).data.draft;

async function startDraft(api: Api, actor: LifecycleActor, data: Snapshot): Promise<DraftBody> {
  aSecondLater();
  const response = await routeOf(api, 'POST', '/products/drafts').handle({
    actor,
    params: {},
    query: {},
    body: { data },
  });
  const draft = draftOf(response);
  if (!draft) throw new Error('no draft started');
  return draft;
}

const updateDraft = (api: Api, actor: LifecycleActor, draftId: string, body: unknown) => {
  aSecondLater();
  return routeOf(api, 'PUT', '/products/drafts/:draftId').handle({
    actor,
    params: { draftId },
    query: {},
    body,
  });
};

const myDraft = (api: Api, actor: LifecycleActor) =>
  routeOf(api, 'GET', '/products/drafts/mine').handle({ actor, params: {}, query: {} });

const listDrafts = async (api: Api, actor: LifecycleActor): Promise<DraftBody[]> => {
  const response = await routeOf(api, 'GET', '/products/drafts').handle({
    actor,
    params: {},
    query: {},
  });
  return (response.body as { data: { drafts: DraftBody[] } }).data.drafts;
};

const publish = (api: Api, actor: LifecycleActor, draftId: string) =>
  routeOf(api, 'POST', '/products/drafts/:draftId/publish').handle({
    actor,
    params: { draftId },
    query: {},
  });

const daysFromNow = (days: number): Date => new Date(pinnedNow() + days * DAY_MS);

describe('a collection that did not opt in', () => {
  it('gets neither route', () => {
    const { api } = buildApi({}, false);
    for (const slug of ['products', 'suppliers']) {
      expect(hasRoute(api, 'GET', `/${slug}/drafts/mine`)).toBe(false);
      expect(hasRoute(api, 'PUT', `/${slug}/drafts/:draftId`)).toBe(false);
    }
  });

  it('keeps a parked publish OPEN, as it always has', async () => {
    const { api } = buildApi({}, false);
    const draft = await startDraft(api, parked, { name: 'Novo' });
    expect((await publish(api, parked, draft.id)).status).toBe(202);
    expect((await listDrafts(api, parked)).map((row) => row.status)).toEqual(['OPEN']);
  });

  it('is not swept, and the sweep does not list it', async () => {
    const { api } = buildApi({}, false);
    await startDraft(api, owner, { name: 'Antigo' });
    expect(await api.sweepStaleNewItemDrafts(daysFromNow(400))).toEqual([]);
    expect(await listDrafts(api, owner)).toHaveLength(1);
  });

  it('refuses the service calls with the feature-off 403 copy', async () => {
    const { api } = buildApi({}, false);
    const handle = api.entity('product');
    await expect(handle.lifecycle.myNewDraft(handle.context(owner))).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});

describe('the opted-in routes', () => {
  it('are emitted for the opted-in collection only, mine before :draftId', () => {
    const { api } = buildApi();
    expect(hasRoute(api, 'GET', '/products/drafts/mine')).toBe(true);
    expect(hasRoute(api, 'PUT', '/products/drafts/:draftId')).toBe(true);
    expect(hasRoute(api, 'GET', '/suppliers/drafts/mine')).toBe(false);
    const paths = api.routes.map((route) => `${route.method} ${route.path}`);
    expect(paths.indexOf('GET /products/drafts/mine')).toBeLessThan(
      paths.indexOf('DELETE /products/drafts/:draftId'),
    );
  });

  it('answer 403 while the tenant keeps drafts off', async () => {
    const { api } = buildApi();
    const draft = await startDraft(api, owner, { name: 'Novo' });
    expect((await myDraft(api, draftsOff)).status).toBe(403);
    expect((await updateDraft(api, draftsOff, draft.id, { data: { name: 'x' } })).status).toBe(403);
  });
});

describe('updating a new-item draft in place', () => {
  it('writes over the same draft, however many times', async () => {
    const { api, rows } = buildApi();
    const draft = await startDraft(api, owner, { name: 'P' });
    await updateDraft(api, owner, draft.id, { data: { name: 'Pa' } });
    const response = await updateDraft(api, owner, draft.id, { data: { name: 'Pastel' } });
    expect(response.status).toBe(200);
    expect(draftOf(response)).toMatchObject({ id: draft.id, entityId: null, data: { name: 'Pastel' } });
    const drafts = await listDrafts(api, owner);
    expect(drafts.map((row) => row.id)).toEqual([draft.id]);
    // A draft is never the live record.
    expect(rows.size).toBe(0);
  });

  it("refuses an item's draft — that one is saved on the item", async () => {
    const { api } = buildApi();
    const handle = api.entity('product');
    const created = await handle.lifecycle.create(handle.context(owner), { name: 'Live' });
    if (created.status !== 'applied') throw new Error('expected applied');
    const itemDraft = await handle.lifecycle.saveDraft(handle.context(owner), created.entityId, {
      name: 'Rascunho',
    });
    const response = await updateDraft(api, owner, itemDraft.id, { data: { name: 'x' } });
    expect(response.status).toBe(422);
  });

  it('refuses a draft no longer open', async () => {
    const { api } = buildApi();
    const draft = await startDraft(api, owner, { name: 'Novo' });
    expect((await publish(api, owner, draft.id)).status).toBe(200);
    expect((await updateDraft(api, owner, draft.id, { data: { name: 'x' } })).status).toBe(422);
  });

  it("answers 404 for a colleague's draft, and leaves it as it was", async () => {
    const { api } = buildApi();
    const theirs = await startDraft(api, colleague, { name: 'Deles' });
    expect((await updateDraft(api, owner, theirs.id, { data: { name: 'Meu' } })).status).toBe(404);
    expect(draftOf(await myDraft(api, colleague))?.data).toEqual({ name: 'Deles' });
  });

  it("answers 404 for another tenant's draft", async () => {
    const { api } = buildApi();
    const theirs = await startDraft(api, neighbour, { name: 'Vizinho' });
    expect((await updateDraft(api, owner, theirs.id, { data: { name: 'x' } })).status).toBe(404);
  });

  it("answers 404 for an unknown id and for another collection's draft", async () => {
    const { api } = buildApi();
    expect((await updateDraft(api, owner, 'nope', { data: { name: 'x' } })).status).toBe(404);
    const handle = api.entity('supplier');
    const other = await handle.lifecycle.saveDraft(handle.context(owner), null, { name: 'F' });
    expect((await updateDraft(api, owner, other.id, { data: { name: 'x' } })).status).toBe(404);
  });

  it('answers 400 for a body without a data object', async () => {
    const { api } = buildApi();
    const draft = await startDraft(api, owner, { name: 'Novo' });
    const response = await updateDraft(api, owner, draft.id, { nope: true });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toBe('Dados inválidos.');
  });
});

describe("resuming the caller's own new-item draft", () => {
  it('is null before anything was started', async () => {
    const { api } = buildApi();
    const response = await myDraft(api, owner);
    expect(response.status).toBe(200);
    expect(draftOf(response)).toBeNull();
  });

  it("returns the caller's newest, never a colleague's", async () => {
    const { api } = buildApi();
    const older = await startDraft(api, owner, { name: 'Primeiro' });
    const theirs = await startDraft(api, colleague, { name: 'Deles' });
    const newer = await startDraft(api, owner, { name: 'Segundo' });
    expect(draftOf(await myDraft(api, owner))?.id).toBe(newer.id);
    expect(draftOf(await myDraft(api, colleague))?.id).toBe(theirs.id);
    // Writing to the older one makes it the newest touched.
    await updateDraft(api, owner, older.id, { data: { name: 'Primeiro, de novo' } });
    expect(draftOf(await myDraft(api, owner))?.id).toBe(older.id);
  });

  it("does not return an item's draft", async () => {
    const { api } = buildApi();
    const handle = api.entity('product');
    const created = await handle.lifecycle.create(handle.context(owner), { name: 'Live' });
    if (created.status !== 'applied') throw new Error('expected applied');
    await handle.lifecycle.saveDraft(handle.context(owner), created.entityId, { name: 'R' });
    expect(draftOf(await myDraft(api, owner))).toBeNull();
  });

  it('does not return a draft once it was published', async () => {
    const { api } = buildApi();
    const draft = await startDraft(api, owner, { name: 'Novo' });
    await publish(api, owner, draft.id);
    expect(draftOf(await myDraft(api, owner))).toBeNull();
  });
});

describe('a publish parked for approval', () => {
  it('closes the draft: no longer resumed, listed, written or published again', async () => {
    const { api } = buildApi();
    const draft = await startDraft(api, parked, { name: 'Novo' });
    expect((await publish(api, parked, draft.id)).status).toBe(202);
    expect(draftOf(await myDraft(api, parked))).toBeNull();
    expect(await listDrafts(api, parked)).toEqual([]);
    expect((await updateDraft(api, parked, draft.id, { data: { name: 'x' } })).status).toBe(422);
    expect((await publish(api, parked, draft.id)).status).toBe(422);
  });

  it('lets the next "+ Novo" start fresh', async () => {
    const { api } = buildApi();
    const first = await startDraft(api, parked, { name: 'Novo' });
    await publish(api, parked, first.id);
    const next = await startDraft(api, parked, { name: 'Outro' });
    expect(draftOf(await myDraft(api, parked))?.id).toBe(next.id);
  });
});

describe('the sweep', () => {
  it('deletes only open new-item drafts untouched for 30 days, in the opted-in collection', async () => {
    const { api } = buildApi();
    const product = api.entity('product');
    const supplier = api.entity('supplier');
    const created = await product.lifecycle.create(product.context(owner), { name: 'Live' });
    if (created.status !== 'applied') throw new Error('expected applied');
    await product.lifecycle.saveDraft(product.context(owner), created.entityId, { name: 'Item' });
    await startDraft(api, owner, { name: 'Esquecido' });
    const submitted = await startDraft(api, parked, { name: 'Em aprovação' });
    await publish(api, parked, submitted.id);
    await supplier.lifecycle.saveDraft(supplier.context(owner), null, { name: 'Fornecedor' });

    expect(await api.sweepStaleNewItemDrafts(daysFromNow(29))).toEqual([
      { entityType: 'product', deleted: 0 },
    ]);
    expect(await api.sweepStaleNewItemDrafts(daysFromNow(31))).toEqual([
      { entityType: 'product', deleted: 1 },
    ]);
    // What is left: the item's draft, the other collection's — and the
    // parked one, closed but still there.
    expect((await listDrafts(api, owner)).map((row) => row.entityId)).toEqual([created.entityId]);
    expect(await supplier.lifecycle.listDrafts(supplier.context(owner))).toHaveLength(1);
    expect((await api.stores.drafts?.get('t1', submitted.id))?.status).toBe('PUBLISHED');
  });

  it('keeps published and discarded rows, which are history', async () => {
    const { api } = buildApi();
    const published = await startDraft(api, owner, { name: 'Publicado' });
    await publish(api, owner, published.id);
    const discarded = await startDraft(api, owner, { name: 'Descartado' });
    await routeOf(api, 'DELETE', '/products/drafts/:draftId').handle({
      actor: owner,
      params: { draftId: discarded.id },
      query: {},
    });
    expect(await api.sweepStaleNewItemDrafts(daysFromNow(400))).toEqual([
      { entityType: 'product', deleted: 0 },
    ]);
    expect((await api.stores.drafts?.get('t1', published.id))?.status).toBe('PUBLISHED');
    expect((await api.stores.drafts?.get('t1', discarded.id))?.status).toBe('DISCARDED');
  });

  it('sweeps every tenant in one run', async () => {
    const { api } = buildApi();
    await startDraft(api, owner, { name: 'Aqui' });
    await startDraft(api, neighbour, { name: 'Lá' });
    expect(await api.sweepStaleNewItemDrafts(daysFromNow(31))).toEqual([
      { entityType: 'product', deleted: 2 },
    ]);
    expect(draftOf(await myDraft(api, neighbour))).toBeNull();
  });

  it('names the collection it stopped at when the seam cannot delete', async () => {
    const { api } = buildApi({}, true, (db) => ({
      ...db,
      entityDraft: { ...db.entityDraft, deleteMany: undefined },
    }));
    await expect(api.sweepStaleNewItemDrafts(daysFromNow(31))).rejects.toThrow(
      'The new-item draft sweep stopped at "product".',
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a staleAfterDays of %s when the collection is plugged in',
    (staleAfterDays) => {
      expect(() => buildApi({ newItemDrafts: { staleAfterDays } })).toThrow(/positive number of days/);
    },
  );

  it("counts from the last touch, and follows the collection's own window", async () => {
    const { api } = buildApi({ newItemDrafts: { staleAfterDays: 7 } });
    await startDraft(api, owner, { name: 'Novo' });
    expect(await api.sweepStaleNewItemDrafts(daysFromNow(6))).toEqual([
      { entityType: 'product', deleted: 0 },
    ]);
    expect(await api.sweepStaleNewItemDrafts(daysFromNow(8))).toEqual([
      { entityType: 'product', deleted: 1 },
    ]);
    expect(draftOf(await myDraft(api, owner))).toBeNull();
  });
});
