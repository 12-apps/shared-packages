import { describe, expect, it } from 'vitest';

import type { ChartDataPoint, ChartProps } from '../Chart.types';
import {
  categoryValues,
  resolveAxisConfig,
  resolveBarGeometry,
  selectCategoryTicks,
  truncateTickLabel,
} from '../chart-axis';
import { getSizeStyles } from '../chart-internals';

const days = (count: number): ChartDataPoint[] =>
  Array.from({ length: count }, (_, index) => ({ day: `d${index}`, total: index }));

describe('selectCategoryTicks', () => {
  it('leaves Recharts in charge while every category fits', () => {
    expect(selectCategoryTicks(['a', 'b', 'c'], 8)).toBeUndefined();
    expect(selectCategoryTicks([], 8)).toBeUndefined();
  });

  it('thins to at most maxTicks labels', () => {
    const values = Array.from({ length: 31 }, (_, index) => `d${index}`);
    const ticks = selectCategoryTicks(values, 8);
    expect(ticks).toBeDefined();
    expect(ticks?.length).toBeLessThanOrEqual(8);
  });

  it('always keeps the last category', () => {
    for (const count of [9, 10, 17, 31, 90]) {
      const values = Array.from({ length: count }, (_, index) => index);
      const ticks = selectCategoryTicks(values, 8);
      expect(ticks?.at(-1)).toBe(count - 1);
    }
  });

  it('keeps every nth, in ascending order, anchored on the end', () => {
    const values = Array.from({ length: 12 }, (_, index) => index);
    // 12 values into 8 slots → step 2, walked back from 11.
    expect(selectCategoryTicks(values, 8)).toEqual([1, 3, 5, 7, 9, 11]);
  });

  it('treats a nonsensical cap as no thinning', () => {
    expect(selectCategoryTicks(['a', 'b'], 0)).toBeUndefined();
  });

  it('backs off when a category repeats — a value tick cannot address it', () => {
    const values = Array.from({ length: 12 }, (_, index) => `d${index % 6}`);
    expect(selectCategoryTicks(values, 8)).toBeUndefined();
  });
});

describe('categoryValues', () => {
  it('reads the axis key in row order', () => {
    expect(categoryValues(days(3), 'day')).toEqual(['d0', 'd1', 'd2']);
  });

  it('skips rows with no value on the axis key', () => {
    const rows: ChartDataPoint[] = [{ day: 'a' }, { day: null }, { other: 1 }, { day: 2 }];
    expect(categoryValues(rows, 'day')).toEqual(['a', 2]);
  });
});

describe('truncateTickLabel', () => {
  it('passes short labels through untouched', () => {
    expect(truncateTickLabel('2026-07-01', 12)).toBe('2026-07-01');
  });

  it('truncates to exactly maxChars, ellipsis included', () => {
    const label = truncateTickLabel('Monster Absolut Zero', 12);
    expect(label).toBe('Monster Abs…');
    expect(label).toHaveLength(12);
  });

  it('renders empty for a missing value and stringifies numbers', () => {
    expect(truncateTickLabel(null, 12)).toBe('');
    expect(truncateTickLabel(undefined, 12)).toBe('');
    expect(truncateTickLabel(42, 12)).toBe('42');
  });
});

describe('resolveAxisConfig', () => {
  const base = (overrides: Partial<ChartProps> = {}): ChartProps => ({
    data: days(3),
    xAxisKey: 'day',
    ...overrides,
  });

  it('carries the size-derived tick margin through', () => {
    expect(resolveAxisConfig(base(), 12).tickMargin).toBe(12);
  });

  it('does not thin a small axis', () => {
    expect(resolveAxisConfig(base(), 12).categoryTicks).toBeUndefined();
  });

  it('thins once the caller lowers the cap', () => {
    expect(resolveAxisConfig(base({ maxCategoryTicks: 2 }), 12).categoryTicks).toEqual(['d0', 'd2']);
  });

  it('truncates category labels at the caller-supplied width', () => {
    const { tickFormatter } = resolveAxisConfig(base({ tickLabelMaxChars: 5 }), 12);
    expect(tickFormatter('Monster Absolut')).toBe('Mons…');
  });

  it('defaults the category axis key to "name"', () => {
    const props: ChartProps = { data: [{ name: 'a' }, { name: 'b' }], maxCategoryTicks: 1 };
    expect(resolveAxisConfig(props, 12).categoryTicks).toEqual(['b']);
  });
});

describe('resolveBarGeometry', () => {
  it('rounds the top corners and caps the width by default', () => {
    expect(resolveBarGeometry({ data: [] })).toEqual({ radius: [3, 3, 0, 0], maxBarSize: 38 });
  });

  it('keeps stacked segments square', () => {
    expect(resolveBarGeometry({ data: [], stacked: true }).radius).toBe(0);
  });

  it('honours caller overrides', () => {
    expect(resolveBarGeometry({ data: [], barRadius: 8, maxBarWidth: 64 })).toEqual({
      radius: [8, 8, 0, 0],
      maxBarSize: 64,
    });
  });
});

describe('axis tick margin', () => {
  // The bottom value tick is centred ON the x-axis line and its box reaches
  // ~0.79em below it; the category labels start `tickMargin` under the 6px
  // tick mark. Anything under ~0.8em of the axis font puts the two on top of
  // each other at the corner — the collision the visual pass is about.
  it('clears the value label descender at every size', () => {
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      const { fontSize, tickMargin } = getSizeStyles(size);
      const fontPx = Number.parseFloat(fontSize) * 16;
      expect(tickMargin).toBeGreaterThanOrEqual(fontPx * 0.79);
    }
  });

  it('keeps an explicit height from disturbing the margin', () => {
    expect(getSizeStyles('sm', 220)).toEqual({ height: 220, fontSize: '0.875rem', tickMargin: 12 });
  });
});
