import { describe, expect, it } from 'vitest';

import { LifecycleError } from '../errors';
import {
  createMemoryApprovalStore,
  createMemoryDraftStore,
  createMemoryRecycleBinStore,
  createMemoryVersionStore,
} from '../memory';
import { createEntityLifecycle, type EntityLifecycle } from '../service';
import type {
  EntityOps,
  LifecycleContext,
  LifecycleStores,
  Snapshot,
} from '../types';

/** A tiny in-memory "products table" standing in for the host repository. */
function createFakeOps() {
  const table = new Map<string, Snapshot & { archived?: boolean }>();
  const ops: EntityOps = {
    async readSnapshot(_tenantId, entityId) {
      const row = table.get(entityId);
      if (!row || row.archived) return null;
      const snapshot = { ...row };
      delete snapshot.archived;
      return snapshot;
    },
    async applySnapshot(_tenantId, entityId, snapshot) {
      // Fresh per-setup table, so a size-derived id stays unique per test.
      const id = entityId ?? `p${table.size + 1}`;
      table.set(id, { ...snapshot });
      return id;
    },
    async archive(_tenantId, entityId) {
      const row = table.get(entityId);
      if (!row) return false;
      row.archived = true;
      return true;
    },
    async unarchive(_tenantId, entityId) {
      const row = table.get(entityId);
      if (!row) return false;
      delete row.archived;
      return true;
    },
    async hardDelete(_tenantId, entityId) {
      table.delete(entityId);
    },
    async collectChildren(_tenantId, entityId) {
      return entityId === 'with-children'
        ? [
            {
              entityType: 'product',
              entityId: 'child-1',
              label: 'Variação lata',
              snapshot: { name: 'lata' },
            },
          ]
        : [];
    },
  };
  return { ops, table };
}

const fullyOn: LifecycleContext = {
  tenantId: 't1',
  actorId: 'admin-1',
  entitlements: { versioning: true, drafts: true, approvals: true },
  settings: { versioning: true, drafts: true, approvals: true },
  canApprove: true,
};

/** Fresh service + stores + table per test (no shared state across tests). */
function setup(): {
  lifecycle: EntityLifecycle;
  table: Map<string, Snapshot & { archived?: boolean }>;
  stores: LifecycleStores;
} {
  const fake = createFakeOps();
  const stores: LifecycleStores = {
    versions: createMemoryVersionStore(),
    recycleBin: createMemoryRecycleBinStore(),
    drafts: createMemoryDraftStore(),
    approvals: createMemoryApprovalStore(),
  };
  const lifecycle = createEntityLifecycle(
    {
      entityType: 'product',
      features: { versioning: true, drafts: true, approvals: true },
      label: (s) => String(s.name ?? s.id ?? 'item'),
      retention: { maxVersions: 100 },
    },
    stores,
    fake.ops,
  );
  return { lifecycle, table: fake.table, stores };
}

describe('createEntityLifecycle', () => {

  it('create + update record versions; restore reverts and appends a RESTORE row', async () => {
    const svc = setup();
    const created = await svc.lifecycle.create(fullyOn, { name: 'Coca', priceCents: 500 });
    expect(created.status).toBe('applied');
    const id = created.status === 'applied' ? created.entityId : '';

    await svc.lifecycle.update(fullyOn, id, { name: 'Coca', priceCents: 700 });
    await svc.lifecycle.update(fullyOn, id, { name: 'Coca Zero', priceCents: 700 });

    const history = await svc.lifecycle.history(fullyOn, id);
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]);
    expect(history[0]?.changedFields).toEqual(['name']);

    // Restore v1: live row reverts, and a v4 RESTORE entry is appended.
    await svc.lifecycle.restoreVersion(fullyOn, id, 1);
    expect(svc.table.get(id)).toEqual({ name: 'Coca', priceCents: 500 });
    const after = await svc.lifecycle.history(fullyOn, id);
    expect(after[0]?.kind).toBe('RESTORE');
    expect(after[0]?.restoredFromVersion).toBe(1);
  });

  it('versioning disabled by tenant: writes work, history is denied', async () => {
    const svc = setup();
    const ctx: LifecycleContext = { ...fullyOn, settings: { ...fullyOn.settings, versioning: false } };
    const created = await svc.lifecycle.create(ctx, { name: 'Coca' });
    expect(created.status).toBe('applied');
    await expect(
      svc.lifecycle.history(ctx, created.status === 'applied' ? created.entityId : ''),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('soft delete lands a tree in the recycle bin; restore brings it back', async () => {
    const svc = setup();
    await svc.table.set('with-children', { name: 'Coca 2L' });
    await svc.lifecycle.softDelete(fullyOn, 'with-children');
    expect(svc.table.get('with-children')?.archived).toBe(true);

    const bin = await svc.lifecycle.listRecycleBin(fullyOn);
    expect(bin).toHaveLength(1);
    expect(bin[0]?.label).toBe('Coca 2L');

    const tree = await svc.lifecycle.recycleBinTree(fullyOn, bin[0]?.id ?? '');
    expect(tree).toHaveLength(2);
    expect(tree[1]?.label).toBe('Variação lata');

    await svc.lifecycle.restoreDeleted(fullyOn, bin[0]?.id ?? '');
    expect(svc.table.get('with-children')?.archived).toBeUndefined();
    expect(await svc.lifecycle.listRecycleBin(fullyOn)).toHaveLength(0);
  });

  it('purge hard-deletes and closes the bin entry', async () => {
    const svc = setup();
    svc.table.set('p-purge', { name: 'Velho' });
    await svc.lifecycle.softDelete(fullyOn, 'p-purge');
    const bin = await svc.lifecycle.listRecycleBin(fullyOn);
    await svc.lifecycle.purgeDeleted(fullyOn, bin[0]?.id ?? '');
    expect(svc.table.has('p-purge')).toBe(false);
    expect(await svc.lifecycle.listRecycleBin(fullyOn)).toHaveLength(0);
    // Restoring a purged entry is rejected.
    await expect(svc.lifecycle.restoreDeleted(fullyOn, bin[0]?.id ?? '')).rejects.toThrow(
      LifecycleError,
    );
  });

  it('drafts: save + publish applies to the live record', async () => {
    const svc = setup();
    svc.table.set('p1', { name: 'Coca', priceCents: 500 });
    await svc.lifecycle.saveDraft(fullyOn, 'p1', { name: 'Coca Nova', priceCents: 600 });
    const draft = await svc.lifecycle.openDraft(fullyOn, 'p1');
    expect(draft?.status).toBe('OPEN');

    const result = await svc.lifecycle.publishDraft(fullyOn, draft?.id ?? '');
    expect(result.status).toBe('applied');
    expect(svc.table.get('p1')).toEqual({ name: 'Coca Nova', priceCents: 600 });
    expect(await svc.lifecycle.openDraft(fullyOn, 'p1')).toBeNull();
  });

  it('drafts: a new-item draft creates on publish', async () => {
    const svc = setup();
    const draft = await svc.lifecycle.saveDraft(fullyOn, null, { name: 'Produto novo' });
    const result = await svc.lifecycle.publishDraft(fullyOn, draft.id);
    expect(result.status).toBe('applied');
    const id = result.status === 'applied' ? result.entityId : '';
    expect(svc.table.get(id)).toEqual({ name: 'Produto novo' });
  });

  it('approvals: a non-approver write parks a change request; approve applies it', async () => {
    const svc = setup();
    const author: LifecycleContext = { ...fullyOn, actorId: 'staff-1', canApprove: false };
    const parked = await svc.lifecycle.create(author, { name: 'Suco' });
    expect(parked.status).toBe('pending-approval');
    const requestId = parked.status === 'pending-approval' ? parked.requestId : '';
    expect(svc.table.size).toBe(0);

    const pending = await svc.lifecycle.listChangeRequests(fullyOn, { status: 'PENDING' });
    expect(pending).toHaveLength(1);

    const applied = await svc.lifecycle.approveChange(fullyOn, requestId);
    expect(applied.status).toBe('applied');
    const id = applied.status === 'applied' ? applied.entityId : '';
    expect(svc.table.get(id)).toEqual({ name: 'Suco' });

    // The version is attributed to the change AUTHOR, not the approver.
    const history = await svc.lifecycle.history(fullyOn, id);
    expect(history[0]?.actorId).toBe('staff-1');

    // Double-decide is rejected.
    await expect(svc.lifecycle.approveChange(fullyOn, requestId)).rejects.toMatchObject({
      code: 'REQUEST_ALREADY_DECIDED',
    });
  });

  it('approvals: two concurrent approvers apply the parked write exactly once', async () => {
    const svc = setup();
    const author: LifecycleContext = { ...fullyOn, actorId: 'staff-1', canApprove: false };
    const parked = await svc.lifecycle.create(author, { name: 'Suco' });
    const requestId = parked.status === 'pending-approval' ? parked.requestId : '';

    // Both approvers pass the PENDING read; the decide compare-and-set lets
    // only one claim + apply — the other gets REQUEST_ALREADY_DECIDED.
    const outcomes = await Promise.allSettled([
      svc.lifecycle.approveChange(fullyOn, requestId),
      svc.lifecycle.approveChange({ ...fullyOn, actorId: 'admin-2' }, requestId),
    ]);
    const applied = outcomes.filter((o) => o.status === 'fulfilled');
    const refused = outcomes.filter(
      (o) =>
        o.status === 'rejected' &&
        (o.reason as LifecycleError).code === 'REQUEST_ALREADY_DECIDED',
    );
    expect(applied).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // Exactly one product was created by the single applied write.
    expect(svc.table.size).toBe(1);
  });

  it('approvals: reject leaves the live record untouched; non-approvers cannot decide', async () => {
    const svc = setup();
    svc.table.set('p1', { name: 'Coca' });
    const author: LifecycleContext = { ...fullyOn, actorId: 'staff-1', canApprove: false };
    const parked = await svc.lifecycle.update(author, 'p1', { name: 'Coca Editada' });
    const requestId = parked.status === 'pending-approval' ? parked.requestId : '';

    await expect(svc.lifecycle.approveChange(author, requestId)).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
    await svc.lifecycle.rejectChange(fullyOn, requestId, 'não aprovado');
    expect(svc.table.get('p1')).toEqual({ name: 'Coca' });
    const decided = await svc.lifecycle.listChangeRequests(fullyOn, { status: 'REJECTED' });
    expect(decided[0]?.decisionNote).toBe('não aprovado');
  });

  it('approvals off (not entitled): writes apply directly even without canApprove', async () => {
    const svc = setup();
    const ctx: LifecycleContext = {
      tenantId: 't1',
      actorId: 'staff-1',
      entitlements: { versioning: true },
      settings: {},
      canApprove: false,
    };
    const created = await svc.lifecycle.create(ctx, { name: 'Direto' });
    expect(created.status).toBe('applied');
  });
});
