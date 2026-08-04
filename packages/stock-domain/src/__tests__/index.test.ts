import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOSS_CATEGORY,
  DEFAULT_STOCK_REASON_KIND,
  isLossCategory,
  isStockReasonKind,
  LOSS_CATEGORIES,
  STOCK_REASON_KINDS,
} from '../index';

/**
 * These assertions are the point of the package, not decoration.
 *
 * The vocabulary is mirrored by things a unit test cannot reach — a Prisma
 * `String` column's default, seeded tenants, and the JSON Schema the MCP
 * manifest advertises to agents. Pinning the values here means widening the
 * vocabulary is a deliberate act that updates a test, rather than a one-line
 * edit whose blast radius nobody re-derives.
 */
describe('stock reason vocabulary', () => {
  it('is the exact pair the taxonomy is built on', () => {
    expect(STOCK_REASON_KINDS).toEqual(['LOSS', 'GAIN']);
  });

  it('is the exact loss sub-classification set', () => {
    expect(LOSS_CATEGORIES).toEqual(['WASTE', 'LOSS', 'SPOILAGE']);
  });

  it('defaults to LOSS on both axes, matching the database column defaults', () => {
    expect(DEFAULT_STOCK_REASON_KIND).toBe('LOSS');
    expect(DEFAULT_LOSS_CATEGORY).toBe('LOSS');
  });

  it('keeps the defaults inside their own vocabulary', () => {
    expect(isStockReasonKind(DEFAULT_STOCK_REASON_KIND)).toBe(true);
    expect(isLossCategory(DEFAULT_LOSS_CATEGORY)).toBe(true);
  });
});

describe('narrowing untrusted strings', () => {
  it('accepts every value in the vocabulary', () => {
    for (const kind of STOCK_REASON_KINDS) expect(isStockReasonKind(kind)).toBe(true);
    for (const category of LOSS_CATEGORIES) expect(isLossCategory(category)).toBe(true);
  });

  it('rejects anything else, including near-misses and the wrong axis', () => {
    for (const value of ['', 'loss', 'Loss', 'GAINS', 'THEFT', ' LOSS']) {
      expect(isStockReasonKind(value)).toBe(false);
    }
    // GAIN is a KIND, never a category — the two sets are not interchangeable.
    expect(isLossCategory('GAIN')).toBe(false);
    // ...while LOSS is deliberately in both, which is exactly why a caller
    // reading `category` learns nothing about the axis.
    expect(isStockReasonKind('LOSS')).toBe(true);
    expect(isLossCategory('LOSS')).toBe(true);
  });

  it('does not treat inherited Array members as vocabulary', () => {
    for (const value of ['length', 'constructor', 'toString']) {
      expect(isStockReasonKind(value)).toBe(false);
      expect(isLossCategory(value)).toBe(false);
    }
  });
});
