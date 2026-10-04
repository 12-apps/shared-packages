import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMemoryApprovalStore,
  createMemoryDraftStore,
  createMemoryRecycleBinStore,
  createMemoryVersionStore,
} from '../memory';
import { createEntityLifecycle } from '../service';
import type { EntityOps, LifecycleContext, LifecycleStores, Snapshot } from '../types';

/**
 * New-item drafts on the framework-free service, over the in-memory stores
 * (FUT-3244) — the same behaviour the generated routes give, proven on the
 * store a host prototypes with.
 */

const DAY_MS = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const pinnedNow = (): number => vi.getMockedSystemTime()?.getTime() ?? 0;
const aSecondLater = (): void => {
  vi.setSystemTime(pinnedNow() + 1000);
};

const ops: EntityOps = {
  readSnapshot: async () => ({ name: 'Live' }),
  applySnapshot: async (_tenant, id) => id ?? 'p-new',
  archive: async () => true,
  unarchive: async () => true,
  hardDelete: async () => undefined,
};

const ctx = (actorId: string, approvals = false): LifecycleContext => ({
  tenantId: 't1',
  actorId,
  entitlements: { versioning: true, drafts: true, approvals: true },
  settings: { versioning: true, drafts: true, approvals },
  canApprove: !approvals,
});

function setup(optIn = true) {
  const stores: LifecycleStores = {
    versions: createMemoryVersionStore(),
    recycleBin: createMemoryRecycleBinStore(),
    drafts: createMemoryDraftStore(),
    approvals: createMemoryApprovalStore(),
  };
  const service = createEntityLifecycle(
    {
      entityType: 'product',
      features: { versioning: true, drafts: true, approvals: true },
      label: () => 'Item',
      ...(optIn ? { newItemDrafts: { staleAfterDays: 30 } } : {}),
    },
    stores,
    ops,
  );
  return { lifecycle: service, stores };
}

const start = (svc: ReturnType<typeof setup>, actor: string, data: Snapshot) => {
  aSecondLater();
  return svc.lifecycle.saveDraft(ctx(actor), null, data);
};

describe('new-item drafts on the in-memory stores', () => {
  it('updates in place, resumes the newest of mine, and leaves the item drafts alone', async () => {
    const svc = setup();
    const first = await start(svc, 'u1', { name: 'A' });
    await start(svc, 'u2', { name: 'B' });
    aSecondLater();
    const updated = await svc.lifecycle.updateNewDraft(ctx('u1'), first.id, { name: 'A2' });
    expect(updated).toMatchObject({ id: first.id, data: { name: 'A2' }, updatedBy: 'u1' });
    await svc.lifecycle.saveDraft(ctx('u1'), 'p1', { name: 'Item draft' });
    expect((await svc.lifecycle.myNewDraft(ctx('u1')))?.id).toBe(first.id);
    expect(await svc.lifecycle.listDrafts(ctx('u1'))).toHaveLength(3);
  });

  it('keeps no draft for a system actor', async () => {
    const svc = setup();
    await svc.lifecycle.saveDraft({ ...ctx('u1'), actorId: null }, null, { name: 'Job' });
    expect(await svc.lifecycle.myNewDraft({ ...ctx('u1'), actorId: null })).toBeNull();
  });

  it('closes a parked new-item publish, and only with the opt-in', async () => {
    const optedIn = setup();
    const draft = await start(optedIn, 'u1', { name: 'Novo' });
    const result = await optedIn.lifecycle.publishDraft(ctx('u1', true), draft.id);
    expect(result.status).toBe('pending-approval');
    expect((await optedIn.stores.drafts?.get('t1', draft.id))?.status).toBe('PUBLISHED');

    const plain = setup(false);
    const other = await start(plain, 'u1', { name: 'Novo' });
    await plain.lifecycle.publishDraft(ctx('u1', true), other.id);
    expect((await plain.stores.drafts?.get('t1', other.id))?.status).toBe('OPEN');
  });

  it("sweeps this type's open new-item drafts past the window, and nothing else", async () => {
    const svc = setup();
    await start(svc, 'u1', { name: 'Velho' });
    await svc.lifecycle.saveDraft(ctx('u1'), 'p1', { name: 'Item draft' });
    await svc.stores.drafts?.upsertOpen({
      tenantId: 't1',
      entityType: 'supplier',
      entityId: null,
      data: { name: 'Outro tipo' },
      actorId: 'u1',
    });
    expect(await svc.lifecycle.sweepStaleNewDrafts(new Date(pinnedNow() + 29 * DAY_MS))).toBe(0);
    expect(await svc.lifecycle.sweepStaleNewDrafts(new Date(pinnedNow() + 31 * DAY_MS))).toBe(1);
    expect(await svc.lifecycle.myNewDraft(ctx('u1'))).toBeNull();
    expect(await svc.stores.drafts?.listOpen('t1')).toHaveLength(2);
  });

  it('refuses every new-item call without the opt-in', async () => {
    const svc = setup(false);
    await expect(svc.lifecycle.myNewDraft(ctx('u1'))).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    await expect(svc.lifecycle.updateNewDraft(ctx('u1'), 'd', {})).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    await expect(svc.lifecycle.sweepStaleNewDrafts()).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('refuses a draft store that cannot serve them', async () => {
    const { upsertOpen, get, getOpenFor, listOpen, setStatus } = createMemoryDraftStore();
    const bare = createEntityLifecycle(
      {
        entityType: 'product',
        features: { drafts: true },
        label: () => 'Item',
        newItemDrafts: {},
      },
      {
        versions: createMemoryVersionStore(),
        recycleBin: createMemoryRecycleBinStore(),
        drafts: { upsertOpen, get, getOpenFor, listOpen, setStatus },
      },
      ops,
    );
    await expect(bare.myNewDraft(ctx('u1'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
