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
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 1, firstDimensionIsDate: true }),
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
