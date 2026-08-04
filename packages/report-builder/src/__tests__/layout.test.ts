import { describe, expect, it } from 'vitest';

import {
  BLOCK_SPAN_MAX,
  clampBlockSpan,
  minSpanForPresentation,
  responsiveSpan,
  spanOptionsFor,
} from '../layout';
import { dashboardBlockSchema } from '../spec';

/**
 * FUT-391: the 12-column canvas. Readability floors are an AUTHORING rule, so
 * the two halves are tested together — what the schema stores (any 1..12) and
 * what the authoring surface may offer (the presentation's floor upward).
 */
const TABLE = { kind: 'table' } as const;
const KPI = { kind: 'kpi' } as const;
const BARS = { kind: 'chart', chartType: 'bar' } as const;
const PIE = { kind: 'chart', chartType: 'pie' } as const;

describe('minSpanForPresentation', () => {
  it('gives every presentation the width it needs to stay readable', () => {
    expect(minSpanForPresentation(KPI)).toBe(2);
    expect(minSpanForPresentation(PIE)).toBe(3);
    expect(minSpanForPresentation(BARS)).toBe(4);
    // A table below half the canvas truncates its headers — the widest floor.
    expect(minSpanForPresentation(TABLE)).toBe(6);
  });
});

describe('clampBlockSpan', () => {
  it('raises a too-narrow span to the presentation floor', () => {
    expect(clampBlockSpan(2, TABLE)).toBe(6);
    expect(clampBlockSpan(1, BARS)).toBe(4);
  });

  it('keeps a valid span and caps at the full canvas', () => {
    expect(clampBlockSpan(8, TABLE)).toBe(8);
    expect(clampBlockSpan(99, KPI)).toBe(BLOCK_SPAN_MAX);
  });

  it('resolves junk to the floor instead of throwing', () => {
    expect(clampBlockSpan(Number.NaN, KPI)).toBe(2);
    expect(clampBlockSpan(7.4, KPI)).toBe(7);
  });
});

describe('spanOptionsFor', () => {
  it('offers the floor upward, never a width that would not render', () => {
    expect(spanOptionsFor(TABLE)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(spanOptionsFor(KPI)[0]).toBe(2);
    expect(spanOptionsFor(KPI).at(-1)).toBe(12);
  });
});

describe('responsiveSpan', () => {
  it('keeps the authored layout on a desktop canvas', () => {
    expect(responsiveSpan(1, 'desktop')).toBe(1);
    expect(responsiveSpan(7, 'desktop')).toBe(7);
  });

  it('widens by tier: one column becomes three on a phone', () => {
    expect(responsiveSpan(1, 'phone')).toBe(3);
    expect(responsiveSpan(3, 'phone')).toBe(6);
  });

  it('gives a phone a full row to anything a third of the canvas or wider', () => {
    expect(responsiveSpan(4, 'phone')).toBe(12);
    expect(responsiveSpan(12, 'phone')).toBe(12);
  });

  it('lands the tablet between the two, never narrower than the phone', () => {
    for (let span = 1; span <= 12; span += 1) {
      const phone = responsiveSpan(span, 'phone');
      const tablet = responsiveSpan(span, 'tablet');
      expect(tablet).toBeGreaterThanOrEqual(span);
      expect(phone).toBeGreaterThanOrEqual(tablet);
    }
  });

  it('never emits a span the grid cannot place', () => {
    for (const tier of ['phone', 'tablet', 'desktop'] as const) {
      for (const span of [Number.NaN, 0, 1, 6, 12, 99]) {
        const placed = responsiveSpan(span, tier);
        expect(placed).toBeGreaterThanOrEqual(1);
        expect(placed).toBeLessThanOrEqual(BLOCK_SPAN_MAX);
      }
    }
  });
});

describe('the stored contract', () => {
  it('accepts the full 1..12 range — floors are an authoring rule, not storage', () => {
    const block = {
      id: 'a',
      span: 2,
      spec: { entity: 'orders', measures: [{ field: 'revenueCents' }] },
    };
    expect(dashboardBlockSchema.parse(block).span).toBe(2);
    expect(() => dashboardBlockSchema.parse({ ...block, span: 0 })).toThrow();
    expect(() => dashboardBlockSchema.parse({ ...block, span: 13 })).toThrow();
  });
});
