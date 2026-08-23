import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { executeCompiledQuery } from '../memory';
import { renderReport } from '../render';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { orderRows, salesCatalog, splitRows } from './fixtures';

/**
 * The MIGRATION half of the ordered-axis rule (FUT-755).
 *
 * The rule itself lives in `compatibility.ts` and stops an author picking a
 * line or an area over a categorical axis. But saved reports already exist
 * with exactly that shape — the bug report was a screenshot of one, an AREA
 * chart whose x-axis was CARD → PIX.
 *
 * So the compiler deliberately still ACCEPTS the stored spec, and `renderReport`
 * degrades it to BARS. These tests pin both halves: that the stored block does
 * not error, and that what comes out is bars rather than merely "not a crash".
 * Nothing about the data changes — the degrade swaps the mark and nothing else.
 */

function modelFor(input: ReportSpecInput, rows: Array<Record<string, unknown>>) {
  const spec = reportSpecSchema.parse(input);
  const query = compileReport(spec, salesCatalog);
  return renderReport(query, spec.presentation, salesCatalog, executeCompiledQuery(rows, query, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket), PT_BR_REPORT_ENGINE_COPY.labels);
}

function chartTypeFor(input: ReportSpecInput, rows = orderRows): string {
  const model = modelFor(input, rows);
  if (model.kind !== 'chart') throw new Error(`Expected a chart model, got "${model.kind}".`);
  return model.chartSpec.type;
}

const LINE_OVER_METHOD: ReportSpecInput = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'chart', chartType: 'line' },
};

describe('stored line/area over a categorical axis — still compiles', () => {
  it('does not reject the spec the bug report screenshotted', () => {
    // If the compiler threw, every block already saved in this shape would
    // show an error where a chart used to be. That is a worse outcome than the
    // chart itself: the numbers were right, only the slope between them lied.
    expect(() =>
      compileReport(reportSpecSchema.parse(LINE_OVER_METHOD), salesCatalog),
    ).not.toThrow();
  });

  it('does not reject the AREA form either', () => {
    const area: ReportSpecInput = {
      ...LINE_OVER_METHOD,
      presentation: { kind: 'chart', chartType: 'area' },
    };

    expect(() => compileReport(reportSpecSchema.parse(area), salesCatalog)).not.toThrow();
  });
});

describe('renderReport — degrades an unordered axis to bars', () => {
  it('draws a stored LINE over payment methods as bars', () => {
    expect(chartTypeFor(LINE_OVER_METHOD)).toBe('bar');
  });

  it('draws a stored AREA over payment methods as bars', () => {
    expect(
      chartTypeFor({
        ...LINE_OVER_METHOD,
        presentation: { kind: 'chart', chartType: 'area' },
      }),
    ).toBe('bar');
  });

  it('leaves a line over a DATE axis alone', () => {
    expect(
      chartTypeFor({
        ...LINE_OVER_METHOD,
        dimensions: [{ field: 'createdAt' }],
      }),
    ).toBe('line');
  });

  it('leaves a line over an ORDERED string axis alone', () => {
    // `hourOfDay` is a string the catalog declares `ordered`. Degrading it
    // would break "pedidos por hora", the textbook line chart.
    expect(
      chartTypeFor({
        ...LINE_OVER_METHOD,
        dimensions: [{ field: 'hourOfDay' }],
      }),
    ).toBe('line');
  });

  it('never touches a bar, whatever the axis', () => {
    expect(
      chartTypeFor({
        ...LINE_OVER_METHOD,
        presentation: { kind: 'chart', chartType: 'bar' },
      }),
    ).toBe('bar');
  });

  it('leaves a pie over a categorical axis alone', () => {
    // A pie makes no claim about the space between slices, so the rule that
    // catches lines must not catch this one on its way past.
    expect(
      chartTypeFor({
        ...LINE_OVER_METHOD,
        presentation: { kind: 'chart', chartType: 'pie' },
      }),
    ).toBe('pie');
  });
});

describe('renderReport — the degrade composes with a split', () => {
  const SPLIT_LINE: ReportSpecInput = {
    entity: 'orders',
    dimensions: [{ field: 'createdAt', timeGrain: 'day' }, { field: 'method' }],
    measures: [{ field: 'totalCents' }],
    presentation: { kind: 'chart', chartType: 'line' },
  };

  it('keeps a split line over a DATE axis a line (must not regress)', () => {
    // The multi-series work landed immediately before this rule. A split over
    // time is the shape it exists to draw: the second dimension becomes one
    // series per payment method, and the x-axis is still the date.
    expect(chartTypeFor(SPLIT_LINE, splitRows)).toBe('line');
  });

  it('still draws every series of that split', () => {
    const model = modelFor(SPLIT_LINE, splitRows);
    if (model.kind !== 'chart') throw new Error('Expected a chart model.');

    expect(model.chartSpec.series.length).toBeGreaterThan(1);
  });

  it('degrades a split line whose AXIS is categorical', () => {
    // Product on x, method as series: the split is fine, the axis is not.
    expect(
      chartTypeFor(
        { ...SPLIT_LINE, dimensions: [{ field: 'product' }, { field: 'method' }] },
        splitRows,
      ),
    ).toBe('bar');
  });
});

describe('renderReport — the degrade changes the mark and nothing else', () => {
  it('keeps the same rows and axis as the bar the author should have picked', () => {
    const degraded = modelFor(LINE_OVER_METHOD, orderRows);
    const asBars = modelFor(
      { ...LINE_OVER_METHOD, presentation: { kind: 'chart', chartType: 'bar' } },
      orderRows,
    );
    if (degraded.kind !== 'chart' || asBars.kind !== 'chart') {
      throw new Error('Expected chart models.');
    }

    expect(degraded.rows).toEqual(asBars.rows);
    expect(degraded.chartSpec.xAxis).toEqual(asBars.chartSpec.xAxis);
    expect(degraded.chartSpec.series).toEqual(asBars.chartSpec.series);
  });
});
