import { describe, expect, it } from 'vitest';

import { compileReport } from '../compile';
import { executeCompiledQuery } from '../memory';
import { renderReport } from '../render';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { orderRows, salesCatalog } from './fixtures';

/**
 * `Número` takes ONE OR MORE measures (FUT-755): "numero should allow us to
 * add more series, so we can have multiple measures on that block".
 *
 * A block with no grouping returns exactly one row, so every measure already
 * HAS its figure in that row — the change is that the renderer looks past the
 * first. Before it did, adding a second measure fell back to a table, which
 * drew a header row above a single line: a worse Número, not a table.
 *
 * The other half of every case here is COMPATIBILITY. `label` / `value` /
 * `suppressed` / `format` are what a KPI render has carried since FUT-309, and
 * a single-measure payload has to stay byte-for-byte what it always was.
 */
function kpiModelFor(input: ReportSpecInput) {
  const spec = reportSpecSchema.parse(input);
  const query = compileReport(spec, salesCatalog);
  const rows = executeCompiledQuery(orderRows, query);
  const model = renderReport(query, spec.presentation, salesCatalog, rows);
  if (model.kind !== 'kpi') throw new Error(`Expected a kpi model, got "${model.kind}".`);
  return model;
}

const REVENUE: ReportSpecInput = {
  entity: 'orders',
  measures: [{ field: 'totalCents' }],
  presentation: { kind: 'kpi' },
};

const THREE_MEASURES: ReportSpecInput = {
  entity: 'orders',
  measures: [
    { field: 'totalCents' },
    { field: 'itemCount' },
    { field: 'id', aggregation: 'count_distinct', alias: 'pedidos' },
  ],
  presentation: { kind: 'kpi' },
};

describe('renderReport — a KPI with one measure is unchanged', () => {
  it('carries the caption, the figure and the format it always did', () => {
    const model = kpiModelFor(REVENUE);
    expect(model.label).toBe('Receita');
    expect(model.value).toBe(15000);
    expect(model.suppressed).toBe(false);
    expect(model.format).toBe('brl');
  });

  it('still lets the presentation override the caption and the number format', () => {
    const model = kpiModelFor({
      ...REVENUE,
      presentation: { kind: 'kpi', label: 'Faturamento', numberFormat: 'compact' },
    });
    expect(model.label).toBe('Faturamento');
    expect(model.format).toBe('compact');
    expect(model.figures).toEqual([
      { label: 'Faturamento', value: 15000, suppressed: false, format: 'compact' },
    ]);
  });

  it('states its single figure in `figures` as well, so one path draws both', () => {
    const model = kpiModelFor(REVENUE);
    expect(model.figures).toHaveLength(1);
    expect(model.figures[0]).toEqual({
      label: model.label,
      value: model.value,
      suppressed: model.suppressed,
      format: model.format,
    });
  });
});

describe('renderReport — a KPI with several measures', () => {
  it('renders one labelled figure per measure, in the order they were asked for', () => {
    const model = kpiModelFor(THREE_MEASURES);
    expect(model.figures.map((figure) => figure.label)).toEqual([
      'Receita',
      'Itens',
      'Pedido (contagem)',
    ]);
    expect(model.figures.map((figure) => figure.value)).toEqual([15000, 9, 5]);
  });

  it('gives every figure its OWN format — money beside a count', () => {
    // One number format imposed on all of them would misprint the count as
    // currency, which is why the presentation's override reaches only the first.
    expect(kpiModelFor(THREE_MEASURES).figures.map((figure) => figure.format)).toEqual([
      'brl',
      'decimal',
      'integer',
    ]);
  });

  it('leaves the presentation label on the FIRST figure only', () => {
    // A caption written for one figure cannot name three, so the rest fall back
    // to their own catalog labels rather than all reading "Resumo".
    const model = kpiModelFor({
      ...THREE_MEASURES,
      presentation: { kind: 'kpi', label: 'Resumo', numberFormat: 'compact' },
    });
    expect(model.figures.map((figure) => figure.label)).toEqual([
      'Resumo',
      'Itens',
      'Pedido (contagem)',
    ]);
    expect(model.figures.map((figure) => figure.format)).toEqual([
      'compact',
      'decimal',
      'integer',
    ]);
  });

  it('keeps the legacy scalar fields pointing at the first figure', () => {
    const model = kpiModelFor(THREE_MEASURES);
    const [first] = model.figures;
    expect({
      label: model.label,
      value: model.value,
      suppressed: model.suppressed,
      format: model.format,
    }).toEqual(first);
  });

  it('shows an empty period as a figure each with no value, never as an empty block', () => {
    // In a dashboard grid the metric's ABSENCE should still say which metric.
    const spec = reportSpecSchema.parse(THREE_MEASURES);
    const query = compileReport(spec, salesCatalog);
    const model = renderReport(query, spec.presentation, salesCatalog, []);
    if (model.kind !== 'kpi') throw new Error(`Expected a kpi model, got "${model.kind}".`);
    expect(model.figures).toHaveLength(3);
    expect(model.figures.map((figure) => figure.value)).toEqual([null, null, null]);
    expect(model.figures.map((figure) => figure.label)).toEqual([
      'Receita',
      'Itens',
      'Pedido (contagem)',
    ]);
  });
});
