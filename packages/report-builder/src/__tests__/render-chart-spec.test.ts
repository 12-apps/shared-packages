import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { executeCompiledQuery, OTHERS_BUCKET_LABEL } from '../memory';
import { renderReport } from '../render';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { orderRows, productSplitRows, salesCatalog, splitRows } from './fixtures';

/**
 * Two chart decisions the visual pass turned into rules (FUT-755), pinned at
 * the seam that makes them: `renderReport` is what hands `@12-apps/ui` its
 * ChartSpec, so it is where "no legend on a single series" and "integer ticks
 * for a count" are either true or not.
 *
 * Both were verified in a browser first. Neither is provable by reading the
 * chart component alone, because both are decided here and merely obeyed
 * there.
 */

function chartSpecFor(input: ReportSpecInput) {
  const spec = reportSpecSchema.parse(input);
  const query = compileReport(spec, salesCatalog);
  const model = renderReport(query, spec.presentation, salesCatalog, orderRows);
  if (model.kind !== 'chart') throw new Error(`Expected a chart model, got "${model.kind}".`);
  return model.chartSpec;
}

const BAR_BY_METHOD: ReportSpecInput = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'chart', chartType: 'bar' },
};

describe('renderReport — chart legend', () => {
  it('omits the legend for a single series', () => {
    // The one series is already named by the block title and by the spec
    // sentence directly above the chart. A third copy costs a row of height
    // to say nothing new.
    expect(chartSpecFor(BAR_BY_METHOD).legend).toBe(false);
  });

  it('keeps the legend once there is more than one series', () => {
    const chartSpec = chartSpecFor({
      ...BAR_BY_METHOD,
      measures: [{ field: 'totalCents' }, { field: 'itemCount' }],
    });

    expect(chartSpec.legend).toBe(true);
  });
});

describe('renderReport — number format drives the tick scale', () => {
  it('marks a count as integer, so the axis cannot offer half-steps', () => {
    // Recharts spaces ticks evenly across the domain. A count topping out at 2
    // gets 0/0.5/1/1.5/2, which an integer formatter then renders as
    // `0, 1, 1, 2, 2` — an axis that reads as though it repeats itself. The
    // format is what tells the chart to place whole-numbered ticks instead, so
    // formatting alone could never have fixed it.
    expect(chartSpecFor({ ...BAR_BY_METHOD, measures: [{ field: 'itemCount', aggregation: 'count' }] }).numberFormat).toBe('integer');
  });

  it('leaves a money measure on its own format', () => {
    expect(chartSpecFor(BAR_BY_METHOD).numberFormat).toBe('brl');
  });
});

/**
 * The palette a chart is drawn from is a REPORT decision, not the chart
 * library's. `@12-apps/ui` cycles its whole semantic palette when a spec names
 * no scheme, which put the theme's saturated green beside the accent on a pie
 * and left slices 1 and 2 **1.06:1** apart in luminance — invisible in
 * greyscale, on a projector, or to a red-green deficiency.
 *
 * Measured in Chromium against the shipped theme: the ordering below takes the
 * first two slices to 1.44:1, which is what six fixed tokens allow. The
 * assertions pin the two decisions that produced it — one accent when there is
 * nothing to tell apart, and `primary` never adjacent to `secondary` when
 * there is.
 */
describe('renderReport — chart colour scheme', () => {
  it('spends one accent on a single-series chart', () => {
    expect(chartSpecFor(BAR_BY_METHOD).colorScheme).toEqual(['primary']);
  });

  it('separates a pie by luminance even with one measure — its slices are the categories', () => {
    const scheme = chartSpecFor({
      ...BAR_BY_METHOD,
      presentation: { kind: 'chart', chartType: 'pie' },
    }).colorScheme;

    expect(scheme?.length).toBeGreaterThan(1);
    // The default order is `primary, secondary, …`: two saturated hues at the
    // same lightness, which is the pairing this exists to break up.
    expect(scheme?.[0]).toBe('primary');
    expect(scheme?.[1]).not.toBe('secondary');
  });

  it('separates multiple series the same way', () => {
    const scheme = chartSpecFor({
      ...BAR_BY_METHOD,
      measures: [{ field: 'totalCents' }, { field: 'itemCount' }],
    }).colorScheme;

    expect(scheme?.[0]).toBe('primary');
    expect(scheme?.[1]).not.toBe('secondary');
  });
});

/**
 * The split, charted (FUT-755) — the part that had to exist before the
 * compatibility matrix could stop refusing it.
 *
 * These run the WHOLE pipeline (compile → execute → render) rather than
 * asserting the shape of a config object, because the defect this replaces was
 * not a missing flag: a chart built its series from the MEASURES, so a spec
 * with two dimensions plotted one series and silently collapsed the other.
 * A test that only checked `series.length` or `colorScheme` would have passed
 * on that. So every case below names the figures it expects, on the dates it
 * expects them.
 */
function runSplit(input: ReportSpecInput, rows: Array<Record<string, unknown>> = splitRows) {
  const spec = reportSpecSchema.parse(input);
  const query = compileReport(spec, salesCatalog);
  const executed = executeCompiledQuery(rows, query);
  const model = renderReport(query, spec.presentation, salesCatalog, executed);
  return { executed, model };
}

function splitChart(input: ReportSpecInput, rows?: Array<Record<string, unknown>>) {
  const { model, executed } = runSplit(input, rows);
  if (model.kind !== 'chart') throw new Error(`Expected a chart model, got "${model.kind}".`);
  return { chartSpec: model.chartSpec, rows: model.rows, tableColumns: model.tableColumns, executed };
}

const BAR_BY_DAY_SPLIT_METHOD: ReportSpecInput = {
  entity: 'orders',
  timeZone: 'America/Sao_Paulo',
  dimensions: [{ field: 'createdAt', timeGrain: 'day' }, { field: 'method' }],
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'chart', chartType: 'bar' },
};

describe('the row shape a split actually produces', () => {
  it('executes to LONG rows — one per (axis, split) pair', () => {
    // Pinned because the pivot is written against it. If the executor ever
    // emits something else, this fails before the pivot silently misreads it.
    const { executed } = runSplit(BAR_BY_DAY_SPLIT_METHOD);

    expect(executed).toEqual([
      { createdAt_day: '2026-07-01', method: 'CARD', sum_totalCents: 200 },
      { createdAt_day: '2026-07-01', method: 'PIX', sum_totalCents: 100 },
      { createdAt_day: '2026-07-02', method: 'PIX', sum_totalCents: 300 },
      { createdAt_day: '2026-07-03', method: 'CARD', sum_totalCents: 500 },
      { createdAt_day: '2026-07-03', method: 'PIX', sum_totalCents: 400 },
    ]);
  });
});

describe('renderReport — a split becomes one series per value', () => {
  it('draws one series per payment method, named from the catalog', () => {
    const { chartSpec } = splitChart(BAR_BY_DAY_SPLIT_METHOD);

    // Biggest first (PIX 800 vs CARD 700), and "Cartão" rather than `CARD` —
    // the legend is the only thing naming a series, so it uses the catalog's
    // own label for the value.
    expect(chartSpec.series.map((series) => series.label)).toEqual(['PIX', 'Cartão']);
    expect(chartSpec.xAxis.key).toBe('createdAt_day');
  });

  it('puts the right figures on the right dates', () => {
    const { chartSpec, rows } = splitChart(BAR_BY_DAY_SPLIT_METHOD);
    const [pix, card] = chartSpec.series;

    expect(rows).toEqual([
      { createdAt_day: '2026-07-01', [pix!.key]: 100, [card!.key]: 200 },
      // Nobody paid by card on the 2nd. For a SUM that is a measured zero —
      // "no card sales" is R$ 0,00 of card revenue — and drawing it as a gap
      // is what broke a split line chart into unconnected dots.
      { createdAt_day: '2026-07-02', [pix!.key]: 300, [card!.key]: 0 },
      { createdAt_day: '2026-07-03', [pix!.key]: 400, [card!.key]: 500 },
    ]);
  });

  it('leaves a GAP for a measure that has no zero', () => {
    // An average over no orders is not 0; it is unknown. Same fixture, same
    // hole on the 2nd, different answer — and the rule is the one that decides
    // whether "Outros" may be folded at all.
    const { chartSpec, rows } = splitChart({
      ...BAR_BY_DAY_SPLIT_METHOD,
      measures: [{ field: 'totalCents', aggregation: 'avg' }],
    });
    const card = chartSpec.series.find((series) => series.label === 'Cartão');

    expect(rows[1]?.[card!.key]).toBeNull();
    expect(rows[0]?.[card!.key]).toBe(200);
  });

  it('keeps series keys free of characters a chart would read as a PATH', () => {
    // Recharts resolves a `dataKey` with lodash `get`, so a series keyed by a
    // raw value ("Coca-Cola 2.5L") would be read as a path into the row and
    // plot nothing. The value's text lives in the label instead.
    const { chartSpec } = splitChart(BAR_BY_DAY_SPLIT_METHOD);

    for (const series of chartSpec.series) {
      expect(series.key).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it('totals exactly what the same spec renders as a TABLE', () => {
    const { chartSpec, rows } = splitChart(BAR_BY_DAY_SPLIT_METHOD);
    const asTable = runSplit({ ...BAR_BY_DAY_SPLIT_METHOD, presentation: { kind: 'table' } });

    const charted = rows.flatMap((row) =>
      chartSpec.series.map((series) => Number(row[series.key] ?? 0)),
    );
    const tabled = asTable.model.rows.map((row) => Number(row['sum_totalCents'] ?? 0));

    expect(charted.reduce((sum, value) => sum + value, 0)).toBe(
      tabled.reduce((sum, value) => sum + value, 0),
    );
    expect(charted.reduce((sum, value) => sum + value, 0)).toBe(1500);
  });

  it('always legends a split — colour alone cannot name a category', () => {
    const { chartSpec } = splitChart(BAR_BY_DAY_SPLIT_METHOD);

    expect(chartSpec.legend).toBe(true);
    expect(chartSpec.colorScheme?.[0]).toBe('primary');
    expect(chartSpec.colorScheme?.[1]).not.toBe('secondary');
    expect(chartSpec.numberFormat).toBe('brl');
    expect(chartSpec.curved).toBe(false);
  });
});

describe('renderReport — stacked vs side by side', () => {
  it('groups the series side by side by default', () => {
    expect(splitChart(BAR_BY_DAY_SPLIT_METHOD).chartSpec.stacked).toBeUndefined();
  });

  it('stacks them when the panel’s "Empilhado" toggle is on', () => {
    const { chartSpec } = splitChart({
      ...BAR_BY_DAY_SPLIT_METHOD,
      presentation: { kind: 'chart', chartType: 'bar', stacked: true },
    });

    // The toggle reaches a SPLIT bar, not only a multi-measure one: the series
    // it stacks are now the split's values.
    expect(chartSpec.stacked).toBe(true);
    expect(chartSpec.series).toHaveLength(2);
  });
});

describe('renderReport — the table fallback reads the same chart', () => {
  it('describes the PIVOTED rows, so "Ver como tabela" is not a grid of blanks', () => {
    const { chartSpec, rows, tableColumns } = splitChart(BAR_BY_DAY_SPLIT_METHOD);

    // One row array feeds both the chart and the fallback, so the columns must
    // describe THESE rows — the axis, then one column per drawn series.
    expect(tableColumns.map((column) => column.key)).toEqual([
      'createdAt_day',
      ...chartSpec.series.map((series) => series.key),
    ]);
    expect(tableColumns.map((column) => column.label)).toEqual(['Data (dia)', 'PIX', 'Cartão']);
    expect(tableColumns.map((column) => column.format)).toEqual(['text', 'brl', 'brl']);

    // Every column resolves against every row — that is what the CSV exports.
    for (const column of tableColumns) {
      expect(rows.every((row) => column.key in row)).toBe(true);
    }
  });
});

describe('renderReport — a split caps its series', () => {
  const SPLIT_BY_PRODUCT: ReportSpecInput = {
    entity: 'orders',
    timeZone: 'America/Sao_Paulo',
    dimensions: [{ field: 'createdAt', timeGrain: 'day' }, { field: 'product' }],
    measures: [{ field: 'totalCents' }],
    presentation: { kind: 'chart', chartType: 'bar' },
  };

  it('leaves a split inside the palette alone', () => {
    const { chartSpec } = splitChart(SPLIT_BY_PRODUCT, productSplitRows(6));

    expect(chartSpec.series).toHaveLength(6);
    expect(chartSpec.series.map((series) => series.label)).not.toContain(OTHERS_BUCKET_LABEL);
  });

  it('folds the tail into a VISIBLE "Outros" series past it', () => {
    // 10 products at 1000, 900, … 100. The top five draw; the remaining five
    // (500+400+300+200+100) become one named series in the legend, so the
    // chart still adds up to the report's own total.
    const { chartSpec, rows } = splitChart(SPLIT_BY_PRODUCT, productSplitRows(10));
    const labels = chartSpec.series.map((series) => series.label);

    expect(labels).toHaveLength(6);
    expect(labels.slice(0, 5)).toEqual([
      'Produto 00',
      'Produto 01',
      'Produto 02',
      'Produto 03',
      'Produto 04',
    ]);
    expect(labels[5]).toBe(OTHERS_BUCKET_LABEL);

    const drawn = rows[0]!;
    expect(drawn[chartSpec.series[5]!.key]).toBe(500 + 400 + 300 + 200 + 100);
    const total = chartSpec.series.reduce((sum, series) => sum + Number(drawn[series.key] ?? 0), 0);
    expect(total).toBe(5500);
  });

  it('never invents an "Outros" for a measure that cannot be added', () => {
    // An average of averages is not an average. Rather than fold something
    // nobody computed — or silently drop the tail — every series is kept.
    const { chartSpec } = splitChart(
      { ...SPLIT_BY_PRODUCT, measures: [{ field: 'totalCents', aggregation: 'avg' }] },
      productSplitRows(10),
    );

    expect(chartSpec.series).toHaveLength(10);
    expect(chartSpec.series.map((series) => series.label)).not.toContain(OTHERS_BUCKET_LABEL);
  });
});

describe('renderReport — a single dimension is untouched by any of this', () => {
  it('still builds its series from the MEASURES', () => {
    const { model } = runSplit(
      {
        ...BAR_BY_METHOD,
        measures: [{ field: 'totalCents' }, { field: 'itemCount' }],
      },
      orderRows,
    );
    if (model.kind !== 'chart') throw new Error('Expected a chart model.');

    expect(model.chartSpec.series.map((series) => series.key)).toEqual([
      'sum_totalCents',
      'sum_itemCount',
    ]);
    expect(model.chartSpec.xAxis.key).toBe('method');
  });
});
