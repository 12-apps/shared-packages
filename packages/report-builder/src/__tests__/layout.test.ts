import { describe, expect, it } from 'vitest';

import {
  BLOCK_HEIGHT_MAX,
  BLOCK_HEIGHT_MIN,
  BLOCK_SPAN_MAX,
  blockHeightCss,
  clampBlockHeight,
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

/**
 * `Altura` (FUT-755) — the vertical half of the grid contract, and the mirror
 * of everything above it. The rule that carries the whole feature is that
 * `undefined` means "as tall as its content": every block saved before heights
 * existed has none, and every one of them must go on rendering exactly as it
 * does today.
 */
describe('clampBlockHeight', () => {
  it('leaves a block with NO height with no height — the compatibility rule', () => {
    // `undefined` in, `undefined` out. A default here would silently resize
    // every report saved before this field existed.
    expect(clampBlockHeight(undefined)).toBeUndefined();
  });

  it('keeps the three tiers and clamps anything outside them', () => {
    expect(clampBlockHeight(BLOCK_HEIGHT_MIN)).toBe(BLOCK_HEIGHT_MIN);
    expect(clampBlockHeight(2)).toBe(2);
    expect(clampBlockHeight(BLOCK_HEIGHT_MAX)).toBe(BLOCK_HEIGHT_MAX);
    expect(clampBlockHeight(0)).toBe(BLOCK_HEIGHT_MIN);
    expect(clampBlockHeight(99)).toBe(BLOCK_HEIGHT_MAX);
  });

  it('takes no presentation — every tier is tall enough for every rendering', () => {
    // Widths have a floor per presentation because a narrow block TRUNCATES.
    // A short one does not, so no tier is ever refused — a tier nobody can
    // choose makes the whole set look broken.
    expect(clampBlockHeight.length).toBe(1);
  });

  it('resolves junk to the shortest tier instead of throwing', () => {
    expect(clampBlockHeight(Number.NaN)).toBe(BLOCK_HEIGHT_MIN);
    expect(clampBlockHeight(Number.POSITIVE_INFINITY)).toBe(BLOCK_HEIGHT_MIN);
    expect(clampBlockHeight(2.4)).toBe(2);
  });
});

/**
 * The tiers are a CLAMP, not a pixel count — `clamp(min, vh, max)`. The user
 * set one block to `Média` and then to `Alta` and reported the two as "almost
 * nothing", so the assertion that matters is that consecutive tiers are far
 * enough apart to tell apart without comparing them side by side.
 */
describe('blockHeightCss', () => {
  const parse = (css: string): { min: number; vh: number; max: number } => {
    const match = /^clamp\((\d+)px, (\d+)vh, (\d+)px\)$/.exec(css);
    if (match === null) throw new Error(`not a clamp: ${css}`);
    return { min: Number(match[1]), vh: Number(match[2]), max: Number(match[3]) };
  };

  it('states every tier as a floor, a share of the window and a ceiling', () => {
    for (const tier of [1, 2, 3]) {
      const parsed = parse(blockHeightCss(tier));
      expect(parsed.min).toBeLessThan(parsed.max);
      // 200px is a chart with a plot rather than a band of axis labels.
      expect(parsed.min).toBeGreaterThanOrEqual(200);
    }
  });

  it('makes each tier at least half again the one below it, at every bound', () => {
    // The whole point of the redo: the first attempt's 300px against 440px was
    // two charts that looked alike.
    for (const tier of [1, 2]) {
      const lower = parse(blockHeightCss(tier));
      const upper = parse(blockHeightCss(tier + 1));
      expect(upper.min / lower.min).toBeGreaterThanOrEqual(1.5);
      expect(upper.vh / lower.vh).toBeGreaterThanOrEqual(1.5);
      expect(upper.max / lower.max).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('clamps out-of-range tiers rather than drawing nothing', () => {
    expect(blockHeightCss(0)).toBe(blockHeightCss(BLOCK_HEIGHT_MIN));
    expect(blockHeightCss(99)).toBe(blockHeightCss(BLOCK_HEIGHT_MAX));
  });
});

describe('the stored contract — height', () => {
  const block = {
    id: 'a',
    span: 6,
    spec: { entity: 'orders', measures: [{ field: 'revenueCents' }] },
  };

  it('stores NO height by default — a parsed block that had none still has none', () => {
    // The single most important assertion of the feature: `.default()` here
    // would make every stored document grow a height the first time it was read.
    expect(dashboardBlockSchema.parse(block).height).toBeUndefined();
    expect('height' in dashboardBlockSchema.parse(block)).toBe(false);
  });

  it('accepts the three tiers and nothing else', () => {
    expect(dashboardBlockSchema.parse({ ...block, height: 1 }).height).toBe(1);
    expect(dashboardBlockSchema.parse({ ...block, height: BLOCK_HEIGHT_MAX }).height).toBe(
      BLOCK_HEIGHT_MAX,
    );
    expect(() => dashboardBlockSchema.parse({ ...block, height: 0 })).toThrow();
    expect(() => dashboardBlockSchema.parse({ ...block, height: 4 })).toThrow();
    expect(() => dashboardBlockSchema.parse({ ...block, height: 2.5 })).toThrow();
  });
});
