import { describe, expect, it } from 'vitest';

import { applyDelta, diffSnapshots, isEmptyDiff, jsonEquals } from '../diff';

describe('jsonEquals', () => {
  it('compares primitives, arrays and nested objects structurally', () => {
    expect(jsonEquals(1, 1)).toBe(true);
    expect(jsonEquals('a', 'b')).toBe(false);
    expect(jsonEquals(null, null)).toBe(true);
    expect(jsonEquals(null, 0)).toBe(false);
    expect(jsonEquals([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(jsonEquals([1, { a: 2 }], [1, { a: 3 }])).toBe(false);
    expect(jsonEquals({ a: [1] }, { a: [1, 2] })).toBe(false);
  });
});

describe('diffSnapshots', () => {
  it('captures only changed/added fields and removed field names', () => {
    const diff = diffSnapshots(
      { name: 'Coca', priceCents: 500, sku: 'C1', extras: [{ id: 'e1' }] },
      { name: 'Coca Zero', priceCents: 500, extras: [{ id: 'e1' }, { id: 'e2' }] },
    );
    expect(diff.changed).toEqual({
      name: 'Coca Zero',
      extras: [{ id: 'e1' }, { id: 'e2' }],
    });
    expect(diff.removed).toEqual(['sku']);
  });

  it('honours ignoreFields and reports empty diffs', () => {
    const diff = diffSnapshots(
      { name: 'Coca', updatedAt: '2026-01-01' },
      { name: 'Coca', updatedAt: '2026-02-02' },
      { ignoreFields: ['updatedAt'] },
    );
    expect(isEmptyDiff(diff)).toBe(true);
  });
});

describe('applyDelta', () => {
  it('merges changes and deletes removed fields without mutating input', () => {
    const state = { name: 'Coca', sku: 'C1' };
    const next = applyDelta(state, { priceCents: 700 }, ['sku']);
    expect(next).toEqual({ name: 'Coca', priceCents: 700 });
    expect(state).toEqual({ name: 'Coca', sku: 'C1' });
  });
});
