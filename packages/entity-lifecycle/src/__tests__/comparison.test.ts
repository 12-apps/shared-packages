import { describe, expect, it } from 'vitest';

import { compareVersions, type VersionComparison } from '../comparison';
import { LifecycleError } from '../errors';
import { createMemoryVersionStore } from '../memory';
import type { EntityRef, Snapshot } from '../types';
import { applyRetention, recordChange, recordCreate } from '../versioning';

/**
 * The comparison table (FUT-247): a selected version beside its previous, its
 * next and the current one.
 *
 * The cases that matter are about how many versions EXIST around the
 * selection, because every one of them collapses a different pair of roles
 * into one column: v1 alone is selected+current; the second-newest is
 * next+current; the newest has no next at all.
 */

const ref: EntityRef = { tenantId: 't1', entityType: 'product', entityId: 'p1' };

async function seed(states: Snapshot[]) {
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

/**
 * The catalog the scenarios below walk: v1 → v4, one field moving at a time.
 * A factory rather than a shared const — every test gets its own array, so no
 * test can leave a mutated one behind for the next.
 */
function catalog(): Snapshot[] {
  return [
    { name: 'Coca', priceCents: 500, sku: 'C1' },
    { name: 'Coca', priceCents: 700, sku: 'C1' },
    { name: 'Coca Zero', priceCents: 700, sku: 'C1' },
    { name: 'Coca Zero', priceCents: 900, sku: 'C1' },
  ];
}

/** `{ version: [roles] }` — the shape every assertion below is really about. */
function roleMap(comparison: VersionComparison): Record<number, string[]> {
  return Object.fromEntries(comparison.columns.map((column) => [column.version, column.roles]));
}

function row(comparison: VersionComparison, field: string) {
  const found = comparison.rows.find((entry) => entry.field === field);
  if (!found) throw new Error(`no row for ${field}`);
  return found;
}

/** `{ version: value }` for one field, absent columns marked. */
function values(comparison: VersionComparison, field: string): Record<number, unknown> {
  return Object.fromEntries(
    row(comparison, field).cells.map((cell) => [
      cell.version,
      cell.present ? cell.value : '<absent>',
    ]),
  );
}

describe('compareVersions — which columns exist', () => {
  it('collapses selected and current into one column when only v1 exists', async () => {
    const store = await seed([catalog()[0] as Snapshot]);

    const comparison = await compareVersions(store, ref, 1);

    expect(comparison.columns).toHaveLength(1);
    expect(roleMap(comparison)).toEqual({ 1: ['selected', 'current'] });
    // Nothing to differ from — a lone version must not paint every field as a
    // change, which is what a naive "first cell vs itself" comparison does.
    expect(comparison.rows.every((entry) => entry.changed)).toBe(false);
    expect(comparison.rows.map((entry) => entry.field)).toEqual([
      'name',
      'priceCents',
      'sku',
    ]);
  });

  it('gives v1 of a v1..v4 history a next but no previous', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 1);

    expect(roleMap(comparison)).toEqual({
      1: ['selected'],
      2: ['next'],
      4: ['current'],
    });
  });

  it('gives a middle version all four roles as four distinct columns', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 2);

    expect(roleMap(comparison)).toEqual({
      1: ['previous'],
      2: ['selected'],
      3: ['next'],
      4: ['current'],
    });
  });

  it('collapses next and current when the selection is the second-newest', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 3);

    expect(roleMap(comparison)).toEqual({
      2: ['previous'],
      3: ['selected'],
      4: ['next', 'current'],
    });
    expect(comparison.columns).toHaveLength(3);
  });

  it('gives the newest version no next, and folds current into it', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 4);

    expect(roleMap(comparison)).toEqual({
      3: ['previous'],
      4: ['selected', 'current'],
    });
  });

  it('handles a v1..v3 history the same way, one version shorter', async () => {
    const store = await seed(catalog().slice(0, 3));

    expect(roleMap(await compareVersions(store, ref, 1))).toEqual({
      1: ['selected'],
      2: ['next'],
      3: ['current'],
    });
    expect(roleMap(await compareVersions(store, ref, 2))).toEqual({
      1: ['previous'],
      2: ['selected'],
      3: ['next', 'current'],
    });
    expect(roleMap(await compareVersions(store, ref, 3))).toEqual({
      2: ['previous'],
      3: ['selected', 'current'],
    });
  });

  it('reads previous and next as the neighbouring ROWS, not version ± 1', async () => {
    const store = await seed(catalog());
    // Retention prunes v1 and v2; v3 is compacted into a full snapshot. v3's
    // "previous" is now nothing at all, and v4's is v3 — arithmetic on the
    // numbers would look for a v2 that no longer exists.
    await applyRetention(store, ref, { maxVersions: 2 });

    expect(roleMap(await compareVersions(store, ref, 3))).toEqual({
      3: ['selected'],
      4: ['next', 'current'],
    });
    expect(roleMap(await compareVersions(store, ref, 4))).toEqual({
      3: ['previous'],
      4: ['selected', 'current'],
    });
  });

  it('rejects a version the entity never had', async () => {
    const store = await seed(catalog());

    await expect(compareVersions(store, ref, 9)).rejects.toBeInstanceOf(LifecycleError);
    await expect(compareVersions(store, ref, 9)).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });
});

describe('compareVersions — what the cells say', () => {
  it('materializes each column, so a delta-only version still shows every field', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 2);

    // v2's ROW stores only `{ priceCents: 700 }`; its column must still carry
    // the name and sku it inherited.
    expect(values(comparison, 'name')).toEqual({
      1: 'Coca',
      2: 'Coca',
      3: 'Coca Zero',
      4: 'Coca Zero',
    });
    expect(values(comparison, 'priceCents')).toEqual({ 1: 500, 2: 700, 3: 700, 4: 900 });
  });

  it('marks a row changed only when the columns disagree', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 2);

    expect(row(comparison, 'name').changed).toBe(true);
    expect(row(comparison, 'priceCents').changed).toBe(true);
    // Untouched across all four columns.
    expect(row(comparison, 'sku').changed).toBe(false);
  });

  it('distinguishes a field a version never had from one set to null', async () => {
    const store = await seed([
      { name: 'Coca' },
      { name: 'Coca', note: null },
      { name: 'Coca', note: 'promo' },
    ]);

    const comparison = await compareVersions(store, ref, 2);

    expect(values(comparison, 'note')).toEqual({ 1: '<absent>', 2: null, 3: 'promo' });
    expect(row(comparison, 'note').changed).toBe(true);
    const [v1, v2] = row(comparison, 'note').cells;
    expect(v1?.present).toBe(false);
    expect(v2?.present).toBe(true);
  });

  it('reports a removed field as absent in the versions after it', async () => {
    const store = await seed([
      { name: 'Coca', sku: 'C1' },
      { name: 'Coca' },
      { name: 'Coca Zero' },
    ]);

    const comparison = await compareVersions(store, ref, 2);

    expect(values(comparison, 'sku')).toEqual({ 1: 'C1', 2: '<absent>', 3: '<absent>' });
    expect(row(comparison, 'sku').changed).toBe(true);
  });

  it('compares nested values structurally, not by identity', async () => {
    const store = await seed([
      { name: 'Coca', tags: ['a', 'b'] },
      { name: 'Coca', tags: ['a', 'b'], priceCents: 500 },
      { name: 'Coca', tags: ['b', 'a'], priceCents: 500 },
    ]);

    const comparison = await compareVersions(store, ref, 2);

    // Same members, different order — a real change to an ordered list.
    expect(row(comparison, 'tags').changed).toBe(true);
    const untouched = await compareVersions(store, ref, 1);
    expect(untouched.rows.find((entry) => entry.field === 'tags')?.changed).toBe(true);
  });
});

describe('compareVersions — which version counts as current', () => {
  it("uses the host's published version when it names a real row", async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 1, { currentVersion: 3 });

    expect(roleMap(comparison)).toEqual({
      1: ['selected'],
      2: ['next'],
      3: ['current'],
    });
  });

  it('falls back to the newest row when the host reports 0 (archived record)', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 2, { currentVersion: 0 });

    expect(roleMap(comparison)[4]).toEqual(['current']);
  });

  it('falls back to the newest row when the published version was pruned', async () => {
    const store = await seed(catalog());
    await applyRetention(store, ref, { maxVersions: 2 });

    const comparison = await compareVersions(store, ref, 3, { currentVersion: 1 });

    expect(roleMap(comparison)[4]).toEqual(['next', 'current']);
  });

  it('still orders columns oldest-first when a stale current sits behind the selection', async () => {
    const store = await seed(catalog());

    const comparison = await compareVersions(store, ref, 4, { currentVersion: 2 });

    expect(comparison.columns.map((column) => column.version)).toEqual([2, 3, 4]);
    expect(roleMap(comparison)).toEqual({
      2: ['current'],
      3: ['previous'],
      4: ['selected'],
    });
  });
});
