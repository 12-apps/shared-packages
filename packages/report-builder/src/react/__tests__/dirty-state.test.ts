import { describe, expect, it } from 'vitest';

import { deepEqual, isDirty } from '../lib/dirty-state';

/**
 * FUT-391's acceptance: "dragging a block and dropping it in place leaves the
 * report clean." Every case here is a no-op edit that a naive
 * `setDirty(true)`-per-callback would have marked dirty, plus the real changes
 * that must still be caught.
 */

const BASE = {
  name: 'Vendas',
  description: 'Receita diária',
  blocks: [
    { id: 'b1', span: 6, spec: { entity: 'orders', measures: [{ field: 'totalCents' }] } },
    { id: 'b2', span: 6, spec: { entity: 'payments', measures: [{ field: 'amountCents' }] } },
  ],
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('a no-op edit leaves the report clean', () => {
  it('does not flag a structurally identical rebuild', () => {
    // What every setter produces: a new object, same content.
    expect(isDirty(BASE, clone(BASE))).toBe(false);
  });

  it('does not flag a drag that drops a block where it started', () => {
    const reordered = { ...BASE, blocks: [BASE.blocks[0], BASE.blocks[1]] };
    expect(isDirty(BASE, reordered)).toBe(false);
  });

  it('does not flag a resize back to the same width', () => {
    const resized = {
      ...BASE,
      blocks: BASE.blocks.map((block) => ({ ...block, span: block.span })),
    };
    expect(isDirty(BASE, resized)).toBe(false);
  });

  it('does not flag a key-order difference', () => {
    // The trap JSON.stringify would fall into: a setter that spreads in a
    // different order rebuilds the same draft with keys in another sequence.
    const reordered = { blocks: clone(BASE.blocks), description: BASE.description, name: BASE.name };
    expect(isDirty(BASE, reordered)).toBe(false);
  });

  it('treats an explicit undefined as an absent key', () => {
    // `{title: undefined}` is the shape a cleared optional takes; it is not a
    // change from a draft that never had the key.
    expect(deepEqual({ a: 1 }, { a: 1, title: undefined })).toBe(true);
  });
});

describe('a real edit marks the report dirty', () => {
  it('catches a renamed report', () => {
    expect(isDirty(BASE, { ...BASE, name: 'Vendas 2' })).toBe(true);
  });

  it('catches a genuinely reordered block list', () => {
    const swapped = { ...BASE, blocks: [BASE.blocks[1], BASE.blocks[0]] };
    expect(isDirty(BASE, swapped)).toBe(true);
  });

  it('catches a changed width', () => {
    const wider = {
      ...BASE,
      blocks: [{ ...BASE.blocks[0], span: 12 }, BASE.blocks[1]],
    };
    expect(isDirty(BASE, wider)).toBe(true);
  });

  it('catches a removed block', () => {
    expect(isDirty(BASE, { ...BASE, blocks: [BASE.blocks[0]] })).toBe(true);
  });

  it('catches a change buried in a nested spec', () => {
    const edited = clone(BASE);
    const measure = edited.blocks[0]?.spec.measures[0];
    if (!measure) throw new Error('fixture lost its first measure');
    measure.field = 'itemCount';
    expect(isDirty(BASE, edited)).toBe(true);
  });

  it('catches a description cleared to empty', () => {
    // Empty string is a real value, unlike undefined: the author deleted the text.
    expect(isDirty(BASE, { ...BASE, description: '' })).toBe(true);
  });
});

describe('deepEqual edge cases', () => {
  it('distinguishes an array from an object with numeric keys', () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('distinguishes null from an object', () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('treats two NaNs as unchanged', () => {
    // A draft carrying NaN twice has not been edited between renders, even
    // though NaN !== NaN.
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('does not conflate a number with its string form', () => {
    expect(deepEqual({ span: 6 }, { span: '6' })).toBe(false);
  });

  it('compares arrays by position, not membership', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });
});
