import { describe, expect, it } from 'vitest';

import {
  defaultPresentation,
  isOrderedDimension,
  PRESENTATION_OPTIONS,
  presentationCompatibility,
  stackedCompatibility,
  type SpecShape,
} from '../compatibility';
import { compileReport } from '../compile';
import { reportSpecSchema, type ReportPresentation, type ReportSpecInput } from '../spec';
import { salesCatalog } from './fixtures';

/**
 * FUT-308's core guarantee, as amended by FUT-755: everything the compatibility
 * MATRIX offers, the COMPILER accepts — so the picker can never hand an author
 * a shape that 400s. The converse no longer holds, in exactly one rule: the
 * matrix additionally refuses a line/area over an unordered axis, which the
 * compiler still accepts so saved blocks keep rendering. This suite pins both
 * directions, so a SECOND divergence cannot appear unnoticed.
 */

/** Every shape the chart rules can distinguish, with a concrete spec each. */
const SHAPES: Array<{ shape: SpecShape; dimensions: ReportSpecInput['dimensions'] }> = [
  { shape: { dimensionCount: 0, measureCount: 1, firstDimensionIsOrdered: false }, dimensions: [] },
  {
    shape: { dimensionCount: 1, measureCount: 1, firstDimensionIsOrdered: true },
    dimensions: [{ field: 'createdAt' }],
  },
  {
    shape: { dimensionCount: 1, measureCount: 1, firstDimensionIsOrdered: false },
    dimensions: [{ field: 'method' }],
  },
  {
    // An ORDERED axis that is not a date: a string dimension the catalog
    // declares `ordered`. The rule must follow the catalog, not the type.
    shape: { dimensionCount: 1, measureCount: 1, firstDimensionIsOrdered: true },
    dimensions: [{ field: 'hourOfDay' }],
  },
  {
    shape: { dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: true },
    dimensions: [{ field: 'createdAt' }, { field: 'method' }],
  },
  {
    // A split whose AXIS is categorical — the shape from the bug report, one
    // dimension deeper: product on x, method as series.
    shape: { dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: false },
    dimensions: [{ field: 'product' }, { field: 'method' }],
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
  const SPLIT: SpecShape = { dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: true };
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

/**
 * The inversion (FUT-755). `Tabela` used to be the option that was never
 * blocked, which meant an author with no grouping was offered a table of ONE
 * ROW — a header and a single line of figures, which is a worse Número. Now
 * `Número` is the only offer for that shape, and it takes as many measures as
 * the author gives it.
 *
 * The direction that must NOT regress is the other one: `Tabela` is still
 * available for every shape that HAS a grouping, which the matrix ⟺ compiler
 * suite below re-proves shape by shape.
 */
describe('presentationCompatibility — no grouping means Número, and only Número', () => {
  const ungrouped = (measureCount: number): SpecShape => ({
    dimensionCount: 0,
    measureCount,
    firstDimensionIsOrdered: false,
  });
  const reasonOf = (shape: SpecShape, option: string): string | null =>
    presentationCompatibility(shape).find((entry) => entry.option === option)?.disabledReason ??
    null;

  it.each([1, 2, 3, 10])('offers Número for %i ungrouped measure(s)', (measureCount) => {
    expect(reasonOf(ungrouped(measureCount), 'kpi')).toBeNull();
  });

  it.each(['table', 'line', 'bar', 'area', 'pie', 'donut'])(
    'blocks %s with no grouping',
    (option) => {
      expect(reasonOf(ungrouped(1), option)).not.toBeNull();
      expect(reasonOf(ungrouped(2), option)).not.toBeNull();
    },
  );

  it('tells a blocked table which control to touch, and where else to go', () => {
    const reason = reasonOf(ungrouped(2), 'table') ?? '';
    expect(reason).toContain('“agrupar por”');
    expect(reason).toContain('Número');
    // The old sentence sent every blocked chart to the table. With no grouping
    // the table is blocked too, so nothing may still be offering it.
    expect(reasonOf(ungrouped(2), 'bar')).not.toContain('Tabela');
  });

  it('keeps the table available for EVERY shape that has a grouping', () => {
    for (const dimensionCount of [1, 2]) {
      for (const measureCount of [1, 2, 3]) {
        for (const firstDimensionIsOrdered of [true, false]) {
          const shape = { dimensionCount, measureCount, firstDimensionIsOrdered };
          expect(reasonOf(shape, 'table'), JSON.stringify(shape)).toBeNull();
        }
      }
    }
  });
});

/**
 * `Empilhado` (FUT-755). Stacking one series redraws an identical chart — the
 * same defect as a line over a categorical axis, one axis over.
 */
describe('stackedCompatibility', () => {
  const shape = (dimensionCount: number, measureCount: number): SpecShape => ({
    dimensionCount,
    measureCount,
    firstDimensionIsOrdered: true,
  });

  it.each(['bar', 'area'] as const)('offers %s stacking once a SPLIT exists', (option) => {
    expect(stackedCompatibility(option, shape(2, 1))?.disabledReason).toBeNull();
  });

  it.each(['bar', 'area'] as const)(
    'offers %s stacking once there are two MEASURES',
    (option) => {
      expect(stackedCompatibility(option, shape(1, 2))?.disabledReason).toBeNull();
    },
  );

  it.each(['bar', 'area'] as const)('refuses %s stacking with one series', (option) => {
    expect(stackedCompatibility(option, shape(1, 1))?.disabledReason).not.toBeNull();
  });

  it('names the control to change, in the same register as the rest', () => {
    const reason = stackedCompatibility('bar', shape(1, 1))?.disabledReason ?? '';
    expect(reason).toContain('“separar em séries”');
    expect(reason).toContain('medida');
  });

  it.each(['table', 'kpi', 'line', 'pie', 'donut'] as const)(
    'draws no toggle at all for %s',
    (option) => {
      // `null` is "this control does not apply", which is a different answer
      // from a toggle that is on screen and refused.
      expect(stackedCompatibility(option, shape(2, 1))).toBeNull();
    },
  );
});

/**
 * `isOrderedDimension`'s DEFAULT, which is doing most of the work and is
 * invisible at every call site: the answer comes from the field TYPE unless
 * the catalog overrides it. Nothing else in the suite would catch someone
 * quietly adding `string` to the ordered set.
 */
describe('isOrderedDimension — the type rule, and the catalog override', () => {
  it.each(['date', 'number', 'money'])('treats %s as ordered with no declaration', (type) => {
    expect(isOrderedDimension({ type })).toBe(true);
  });

  it.each(['string', 'boolean'])('treats %s as UNordered with no declaration', (type) => {
    expect(isOrderedDimension({ type })).toBe(false);
  });

  it('lets the catalog declare an encoded ordinal ordered', () => {
    // The real case: `orders.hourOfDay` is "00"–"23", a string that sorts
    // chronologically. Only the catalog can know that.
    expect(isOrderedDimension({ type: 'string', ordered: true })).toBe(true);
  });

  it('treats a field it cannot resolve as unordered', () => {
    // A half-filled draft row, or a name no longer in the catalog. The safe
    // answer is the offer that is always honest: bars.
    expect(isOrderedDimension(undefined)).toBe(false);
  });

  it('never lets `ordered: false` promote a categorical field', () => {
    expect(isOrderedDimension({ type: 'string', ordered: false })).toBe(false);
  });
});

/**
 * The gap FUT-755 closes: an AREA chart whose x-axis was CARD → PIX, two
 * payment methods joined by a filled slope. A line or an area asserts the
 * space BETWEEN two points is a value; half-way between CARD and PIX is not
 * one, so the slope draws a relationship that does not exist.
 */
describe('presentationCompatibility — line and area need an ordered axis', () => {
  const reasonOf = (shape: SpecShape, option: string): string | null =>
    presentationCompatibility(shape).find((entry) => entry.option === option)?.disabledReason ??
    null;
  const ordered = (firstDimensionIsOrdered: boolean): SpecShape => ({
    dimensionCount: 1,
    measureCount: 1,
    firstDimensionIsOrdered,
  });

  it.each(['line', 'area'])('refuses %s over a categorical axis', (option) => {
    expect(reasonOf(ordered(false), option)).not.toBeNull();
  });

  it.each(['line', 'area'])('allows %s over an ordered axis', (option) => {
    expect(reasonOf(ordered(true), option)).toBeNull();
  });

  it.each(['bar', 'pie', 'donut', 'table'])('leaves %s available either way', (option) => {
    expect(reasonOf(ordered(false), option)).toBeNull();
    expect(reasonOf(ordered(true), option)).toBeNull();
  });

  it('keeps a SPLIT line legitimate over a date axis (must not regress)', () => {
    // The multi-series work landed just before this rule. A split over time is
    // the shape it exists to draw, and the axis is still the date.
    expect(
      reasonOf({ dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: true }, 'line'),
    ).toBeNull();
  });

  it('refuses a SPLIT line whose axis is categorical', () => {
    expect(
      reasonOf({ dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: false }, 'line'),
    ).not.toBeNull();
  });

  it('names the control to change and offers bars, in the reasons register', () => {
    const reason = reasonOf(ordered(false), 'line') ?? '';
    // Same register as the others: quote the control, then the way out.
    expect(reason).toContain('“agrupar por”');
    expect(reason).toContain('Barras');
    // It must say what KIND of axis qualifies — a date, an hour, a weekday —
    // or the author has no idea what would satisfy it.
    expect(reason).toContain('data');
    expect(reason).toContain('hora');
    expect(reason).toContain('dia da semana');
  });

  it('still reports the split-plus-measure reason first, not the axis one', () => {
    // Two blocking rules at once; the measure one is the closer fix.
    const reason = reasonOf(
      { dimensionCount: 2, measureCount: 2, firstDimensionIsOrdered: false },
      'line',
    );
    expect(reason).toContain('separar em séries');
  });
});

/**
 * The rules the matrix enforces and the compiler deliberately does not — and
 * there are exactly TWO, for the same reason both times: the compiler stays
 * permissive so blocks ALREADY SAVED in that shape keep rendering, while the
 * picker refuses it the next time the author opens the block.
 *
 *  1. line/area over an unordered axis (FUT-755) — `render.ts` degrades such a
 *     block to bars rather than erroring.
 *  2. a table with NO grouping (FUT-755) — `presentation` defaults to `table`,
 *     so a very large share of stored specs are exactly this shape; throwing
 *     would replace them all with an error message for their owners. It still
 *     renders as the one-row table it always did.
 *
 * A THIRD pair appearing here is a bug, which is what this function is for.
 */
function isSanctionedDivergence(option: string, shape: SpecShape): boolean {
  const unorderedAxis = (option === 'line' || option === 'area') && !shape.firstDimensionIsOrdered;
  const ungroupedTable = option === 'table' && shape.dimensionCount === 0;
  return unorderedAxis || ungroupedTable;
}

describe('presentationCompatibility ⟺ compiler', () => {
  for (const { shape, dimensions } of SHAPES) {
    for (const measureCount of [1, 2] as const) {
      const fullShape = { ...shape, measureCount };
      const axis = dimensions?.[0]?.field ?? 'no axis';
      it(`agrees on ${fullShape.dimensionCount} dim(s) × ${measureCount} measure(s) over ${axis}`, () => {
        const matrix = presentationCompatibility(fullShape);
        expect(matrix.map((entry) => entry.option)).toEqual([...PRESENTATION_OPTIONS]);
        for (const entry of matrix) {
          const accepted = compiles({
            entity: 'orders',
            dimensions,
            measures: [...MEASURES[measureCount]],
            presentation: presentationOf(entry.option),
          });
          const label = `${entry.option} for ${JSON.stringify(fullShape)}`;
          if (entry.disabledReason === null) {
            // The safety direction, unchanged: never OFFER something that 400s.
            expect(accepted, `${label} — offered but rejected by the compiler`).toBe(true);
          } else if (accepted) {
            // The matrix refuses it but the compiler takes it. Sanctioned for
            // exactly one rule — the ordered axis, kept out of the compiler so
            // stored blocks keep rendering. Any other pair here is a bug.
            expect(
              isSanctionedDivergence(entry.option, fullShape),
              `${label} — divergence the suite does not sanction`,
            ).toBe(true);
          }
          // The remaining case (matrix refuses, compiler refuses) is the
          // ordinary agreement and needs no assertion.
        }
      });
    }
  }
});

describe('defaultPresentation', () => {
  it('picks kpi ungrouped, line for a time series, bar for categories, table otherwise', () => {
    expect(
      defaultPresentation({ dimensionCount: 0, measureCount: 1, firstDimensionIsOrdered: false }),
    ).toEqual({ kind: 'kpi' });
    expect(
      defaultPresentation({ dimensionCount: 1, measureCount: 1, firstDimensionIsOrdered: true }),
    ).toEqual({ kind: 'chart', chartType: 'line' });
    expect(
      defaultPresentation({ dimensionCount: 1, measureCount: 2, firstDimensionIsOrdered: false }),
    ).toEqual({ kind: 'chart', chartType: 'bar' });
    // Several measures and NO grouping is a KPI with several figures now — it
    // used to fall back to a table, which drew a header above a single line.
    expect(
      defaultPresentation({ dimensionCount: 0, measureCount: 2, firstDimensionIsOrdered: false }),
    ).toEqual({ kind: 'kpi' });
  });

  it('charts a SPLIT rather than dropping to a table (FUT-755)', () => {
    // It used to fall back to a table for ANY second dimension, because
    // nothing pivoted one into series. Now a split draws, so an author who
    // adds one while on a pie lands on bars — not three steps back.
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: true }),
    ).toEqual({ kind: 'chart', chartType: 'line' });
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 1, firstDimensionIsOrdered: false }),
    ).toEqual({ kind: 'chart', chartType: 'bar' });
  });

  it('still falls back to a table for a split PLUS a second measure', () => {
    // Two measures and a split is a three-way breakdown; no chart draws it.
    expect(
      defaultPresentation({ dimensionCount: 2, measureCount: 2, firstDimensionIsOrdered: true }),
    ).toEqual({ kind: 'table' });
  });

  it('defaults an ORDERED non-date axis to a line too (FUT-755)', () => {
    // "Pedidos por hora" is the textbook line chart. Before the rule keyed on
    // order rather than on `type === "date"`, an hour axis opened as bars
    // purely because the catalog stores the hour as a string.
    expect(
      defaultPresentation({ dimensionCount: 1, measureCount: 1, firstDimensionIsOrdered: true }),
    ).toEqual({ kind: 'chart', chartType: 'line' });
  });

  it('always picks something the compiler accepts AND the matrix offers', () => {
    for (const { shape, dimensions } of SHAPES) {
      for (const measureCount of [1, 2] as const) {
        const fullShape = { ...shape, measureCount };
        const picked = defaultPresentation(fullShape);
        const label = JSON.stringify(fullShape);
        expect(
          compiles({
            entity: 'orders',
            dimensions,
            measures: [...MEASURES[measureCount]],
            presentation: picked,
          }),
          label,
        ).toBe(true);
        // Stronger than "compiles": the default must never be an option the
        // picker greys out, or the form would open on a disabled tile.
        const option = picked.kind === 'chart' ? picked.chartType : picked.kind;
        expect(
          presentationCompatibility(fullShape).find((entry) => entry.option === option)
            ?.disabledReason,
          label,
        ).toBeNull();
      }
    }
  });
});
