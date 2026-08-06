import { describe, expect, it } from 'vitest';

import { dimensionAt, withDimension } from '../builder-dimensions';
import type { BuilderDraft } from '../builder-model';

/**
 * The two dimension slots mean different things (FUT-391): slot 0 buckets the
 * rows, slot 1 divides each bucket into a series. The array they serialize to
 * hides that, which is what these cases pin.
 */

const draftWith = (dimensions: BuilderDraft['dimensions']): BuilderDraft =>
  ({ dimensions }) as BuilderDraft;

describe('dimensionAt', () => {
  it('returns an empty slot rather than undefined, so the form always renders both', () => {
    const draft = draftWith([]);
    expect(dimensionAt(draft, 0)).toEqual({ field: '', timeGrain: 'day' });
    expect(dimensionAt(draft, 1)).toEqual({ field: '', timeGrain: 'day' });
  });

  it('reads an occupied slot', () => {
    const draft = draftWith([{ field: 'createdAt', timeGrain: 'month' }]);
    expect(dimensionAt(draft, 0)).toEqual({ field: 'createdAt', timeGrain: 'month' });
  });
});

describe('withDimension', () => {
  it('sets the axis', () => {
    expect(withDimension(draftWith([]), 0, { field: 'method' })).toEqual({
      dimensions: [{ field: 'method', timeGrain: 'day' }],
    });
  });

  it('changes the grain without touching the field', () => {
    const draft = draftWith([{ field: 'createdAt', timeGrain: 'day' }]);
    expect(withDimension(draft, 0, { timeGrain: 'week' })).toEqual({
      dimensions: [{ field: 'createdAt', timeGrain: 'week' }],
    });
  });

  it('adds a split alongside the axis', () => {
    const draft = draftWith([{ field: 'createdAt', timeGrain: 'day' }]);
    expect(withDimension(draft, 1, { field: 'method' })).toEqual({
      dimensions: [
        { field: 'createdAt', timeGrain: 'day' },
        { field: 'method', timeGrain: 'day' },
      ],
    });
  });

  it('drops the split when it is cleared, keeping the axis', () => {
    const draft = draftWith([
      { field: 'createdAt', timeGrain: 'day' },
      { field: 'method', timeGrain: 'day' },
    ]);
    expect(withDimension(draft, 1, { field: '' })).toEqual({
      dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
    });
  });

  it('does NOT promote the split when the axis is cleared', () => {
    // The author removed the grouping, not the series. Sliding `method` into
    // index 0 would change what the block asks — "receita por forma de
    // pagamento" instead of "sem agrupamento" — without them touching that
    // control.
    const draft = draftWith([
      { field: 'createdAt', timeGrain: 'day' },
      { field: 'method', timeGrain: 'day' },
    ]);
    expect(withDimension(draft, 0, { field: '' })).toEqual({ dimensions: [] });
  });

  it('does not mutate the draft it was given', () => {
    const dimensions = [{ field: 'createdAt', timeGrain: 'day' as const }];
    withDimension(draftWith(dimensions), 1, { field: 'method' });
    expect(dimensions).toEqual([{ field: 'createdAt', timeGrain: 'day' }]);
  });
});
