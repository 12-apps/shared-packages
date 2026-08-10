import { describe, expect, it } from 'vitest';

import {
  defaultPresentation,
  PRESENTATION_OPTIONS,
  presentationCompatibility,
  type SpecShape,
} from '../compatibility';
import { compileReport } from '../compile';
import { reportSpecSchema, type ReportPresentation, type ReportSpecInput } from '../spec';
import { salesCatalog } from './fixtures';

/**
 * FUT-308's core guarantee: the compatibility MATRIX and the COMPILER agree
 * on every spec shape × presentation. If a chart rule changes in one place,
 * this suite fails until the other follows.
 */

/** Every shape the chart rules can distinguish, with a concrete spec each. */
const SHAPES: Array<{ shape: SpecShape; dimensions: ReportSpecInput['dimensions'] }> = [
  { shape: { dimensionCount: 0, measureCount: 1, firstDimensionIsDate: false }, dimensions: [] },
  {
    shape: { dimensionCount: 1, measureCount: 1, firstDimensionIsDate: true },
    dimensions: [{ field: 'createdAt' }],
  },
  {
    shape: { dimensionCount: 1, measureCount: 1, firstDimensionIsDate: false },
    dimensions: [{ field: 'method' }],
  },
  {
    shape: { dimensionCount: 2, measureCount: 1, firstDimensionIsDate: true },
    dimensions: [{ field: 'createdAt' }, { field: 'method' }],
  },
];

const MEASURES = {
  1: [{ field: 'totalCents' }],
  2: [{ field: 'totalCents' }, { field: 'itemCount' }],
} as const;

function presentationOf(option: string): ReportPresentation {
  if (option === 'table') return { kind: 'table' };
  if (option === 'kpi') return { kind: 'kpi' };
  return {
    kind: 'chart',
    chartType: option as Extract<ReportPresentation, { kind: 'chart' }>['chartType'],
  };
}

function compiles(input: ReportSpecInput): boolean {
  try {
    compileReport(reportSpecSchema.parse(input), salesCatalog);
    return true;
  } catch {
    return false;
  }
}

/**
 * The split's own rules (FUT-755), stated as the SENTENCES an author reads.
 * The matrix ⟺ compiler suite above proves the boolean agrees; these prove the
 * blocked ones say WHY, and say it about the control the author must touch —
 * "use Tabela" was the same generic line under five options at once.
 */
describe('presentationCompatibility — what a split blocks, and what it says', () => {
  const SPLIT: SpecShape = { dimensionCount: 2, measureCount: 1, firstDimensionIsDate: true };
  const reasonOf = (shape: SpecShape, option: string): string | null =>
    presentationCompatibility(shape).find((entry) => entry.option === option)?.disabledReason ??
    null;

  it.each(['line', 'area', 'bar'])('lets %s chart a split', (option) => {
    expect(reasonOf(SPLIT, option)).toBeNull();
  });

  it.each(['pie', 'donut'])('keeps %s blocked, naming the split and not "1 agrupamento"', (option) => {
    const reason = reasonOf(SPLIT, option);
    expect(reason).toContain('separar em séries');
    expect(reason).not.toContain('1 agrupamento');
  });

  it('keeps KPI blocked whatever the dimensions are', () => {
    expect(reasonOf(SPLIT, 'kpi')).toContain('agrupamento');
    expect(reasonOf({ ...SPLIT, dimensionCount: 1 }, 'kpi')).toContain('agrupamento');
  });

  it('blocks a split plus a second measure with its OWN reason', () => {
    const reason = reasonOf({ ...SPLIT, measureCount: 2 }, 'bar');
    expect(reason).toContain('separar em séries');
    expect(reason).toContain('medida');
  });

  it('leaves the table always available', () => {
    expect(reasonOf({ ...SPLIT, measureCount: 3 }, 'table')).toBeNull();
  });
});

describe('presentationCompatibility ⟺ compiler', () => {
  for (const { shape, dimensions } of SHAPES) {
    for (const measureCount of [1, 2] as const) {
      const fullShape = { ...shape, measureCount };
      it(`agrees on ${fullShape.dimensionCount} dim(s) × ${measureCount} measure(s)${fullShape.firstDimensionIsDate ? ' (date)' : ''}`, () => {
        const matrix = presentationCompatibility(fullShape);
        expect(matrix.map((entry) => entry.option)).toEqual([...PRESENTATION_OPTIONS]);
        for (const entry of matrix) {
          const accepted = compiles({
            entity: 'orders',
            dimensions,
            measures: [...MEASURES[measureCount]],
            presentation: presentationOf(entry.option),
          });
          expect(accepted, `${entry.option} for ${JSON.stringify(fullShape)}`).toBe(
            entry.disabledReason === null,
          );
        }
      });
    }
  }
});

describe('defaultPresentation', () => {
  it('picks kpi ungrouped, line for a time series, bar for categories, table otherwise', () => {
    expect(
      defaultPresentation({ dimensionCount: 0, measureCount: 1, firstDimensionIsDate: false }),
    ).toEqual({ kind: 'kpi' });
    expect(
      defaultPresentation({ dimensionCount: 1, measureCount: 1, firstDimensionIsDate: true }),
    ).toEqual({ kind: 'chart', chartType: 'line' });
    expect(
      defaultPresentation({ dimensionCount: 1, measureCount: 2, firstDimensionIsDate: false }),
    ).toEqual({ kind: 'chart', chartType: 'bar' });
    expect(
      defaultPresentation({ dimensionCount: 0, measureCount: 2, firstDimensionIsDate: false }),
    ).toEqual({ kind: 'table' });
  });

  it('charts a SPLIT rather than dropping to a table (FUT-755)', () => {
    // It used to fall back to a table for ANY second dimension, because
    // nothing pivoted one into series. Now a split draws, so an author who
    // adds one while on a pie lands on bars — not three steps back.
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 1, firstDimensionIsDate: true }),
    ).toEqual({ kind: 'chart', chartType: 'line' });
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 1, firstDimensionIsDate: false }),
    ).toEqual({ kind: 'chart', chartType: 'bar' });
  });

  it('still falls back to a table for a split PLUS a second measure', () => {
    // Two measures and a split is a three-way breakdown; no chart draws it.
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 2, firstDimensionIsDate: true }),
    ).toEqual({ kind: 'table' });
  });

  it('always picks something the compiler accepts', () => {
    for (const { shape, dimensions } of SHAPES) {
      for (const measureCount of [1, 2] as const) {
        const picked = defaultPresentation({ ...shape, measureCount });
        expect(
          compiles({
            entity: 'orders',
            dimensions,
            measures: [...MEASURES[measureCount]],
            presentation: picked,
          }),
          JSON.stringify({ ...shape, measureCount }),
        ).toBe(true);
      }
    }
  });
});
