import { describe, expect, it } from 'vitest';

import { LifecycleError } from '../errors';
import { createMemoryVersionStore } from '../memory';
import {
  applyRetention,
  listHistory,
  materializeVersion,
  recordChange,
  recordCreate,
} from '../versioning';
import type { EntityRef, Snapshot } from '../types';

const ref: EntityRef = { tenantId: 't1', entityType: 'product', entityId: 'p1' };

async function seedHistory(states: Snapshot[]) {
  const store = createMemoryVersionStore();
  const first = states[0];
  if (!first) throw new Error('need at least one state');
  await recordCreate(store, ref, first, 'user-1');
  for (let i = 1; i < states.length; i += 1) {
    const before = states[i - 1];
    const after = states[i];
    if (before && after) {
      await recordChange(store, ref, { before, after, actorId: `user-${i + 1}` });
    }
  }
  return store;
}

describe('version recording + materialization', () => {
  it('stores v1 as a snapshot and later versions as deltas only', async () => {
    const store = await seedHistory([
      { name: 'Coca', priceCents: 500, sku: 'C1' },
      { name: 'Coca', priceCents: 700, sku: 'C1' },
      { name: 'Coca Zero', priceCents: 700 },
    ]);

    expect(store.rows).toHaveLength(3);
    expect(store.rows[0]?.isSnapshot).toBe(true);
    expect(store.rows[1]?.isSnapshot).toBe(false);
    expect(store.rows[1]?.data).toEqual({ priceCents: 700 });
    expect(store.rows[2]?.data).toEqual({ name: 'Coca Zero' });
    expect(store.rows[2]?.removedFields).toEqual(['sku']);
  });

  it('materializes every intermediate version exactly', async () => {
    const states: Snapshot[] = [
      { name: 'Coca', priceCents: 500, sku: 'C1' },
      { name: 'Coca', priceCents: 700, sku: 'C1' },
      { name: 'Coca Zero', priceCents: 700 },
    ];
    const store = await seedHistory(states);
    for (let v = 1; v <= states.length; v += 1) {
      expect(await materializeVersion(store, ref, v)).toEqual(states[v - 1]);
    }
    await expect(materializeVersion(store, ref, 9)).rejects.toThrow(LifecycleError);
  });

  it('skips empty changes and seeds a base for adopted entities', async () => {
    const store = createMemoryVersionStore();
    // Adopted mid-life: no CREATE row exists yet.
    const seeded = await recordChange(store, ref, {
      before: { name: 'Coca' },
      after: { name: 'Coca Zero' },
      actorId: 'u1',
    });
    expect(seeded?.isSnapshot).toBe(true);
    expect(seeded?.data).toEqual({ name: 'Coca Zero' });

    const noop = await recordChange(store, ref, {
      before: { name: 'Coca Zero' },
      after: { name: 'Coca Zero' },
      actorId: 'u1',
    });
    expect(noop).toBeNull();
    expect(store.rows).toHaveLength(1);
  });

  it('lists history newest-first with changed fields and actor', async () => {
    const store = await seedHistory([
      { name: 'Coca', priceCents: 500 },
      { name: 'Coca', priceCents: 700 },
    ]);
    const history = await listHistory(store, ref);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect(history[0]?.changedFields).toEqual(['priceCents']);
    expect(history[0]?.actorId).toBe('user-2');
    expect(history[1]?.kind).toBe('CREATE');
  });
});

describe('applyRetention', () => {
  it('prunes beyond maxVersions and compacts the survivor into a snapshot', async () => {
    const states: Snapshot[] = [
      { name: 'v1', priceCents: 1 },
      { name: 'v2', priceCents: 2 },
      { name: 'v3', priceCents: 3 },
      { name: 'v4', priceCents: 4 },
      { name: 'v5', priceCents: 5 },
    ];
    const store = await seedHistory(states);
    const pruned = await applyRetention(store, ref, { maxVersions: 2 });

    expect(pruned).toBe(3);
    expect(store.rows.map((r) => r.version)).toEqual([4, 5]);
    // The oldest surviving row became a full snapshot, so the chain still
    // materializes without the pruned prefix.
    expect(store.rows[0]?.isSnapshot).toBe(true);
    expect(await materializeVersion(store, ref, 4)).toEqual(states[3]);
    expect(await materializeVersion(store, ref, 5)).toEqual(states[4]);
  });

  it('prunes by age but never below minKeep', async () => {
    const store = await seedHistory([
      { name: 'v1' },
      { name: 'v2' },
      { name: 'v3' },
    ]);
    // Fixed clock: every row is 10 days older than the sweep's "now".
    const NOW = new Date('2026-07-22T00:00:00.000Z');
    for (const row of store.rows) {
      row.createdAt = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    }
    const pruned = await applyRetention(store, ref, { maxAgeDays: 5, minKeep: 2 }, NOW);
    expect(pruned).toBe(1);
    expect(store.rows.map((r) => r.version)).toEqual([2, 3]);
    expect(await materializeVersion(store, ref, 3)).toEqual({ name: 'v3' });
  });

  it('is a no-op when the policy is satisfied', async () => {
    const store = await seedHistory([{ name: 'v1' }, { name: 'v2' }]);
    expect(await applyRetention(store, ref, { maxVersions: 10, maxAgeDays: 30 })).toBe(0);
    expect(store.rows).toHaveLength(2);
  });
});
