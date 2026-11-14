/**
 * FUT-4063: what report-builder gained to draw "staff cost against sales" as a
 * built-in — the heatmap presentation, a table's row flag, and their compile
 * rules — run end to end through the memory adapter.
 */
import { describe, expect, it } from 'vitest';

import { defineCatalog } from '../catalog';
import { ReportBuilderError } from '../errors';
import { createMemoryDataSource } from '../memory';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { isRowFlagged } from '../render-flag';
import { heatmapAxis } from '../render-heatmap';
import { runReport } from '../run';

const WEEKDAYS = ['1-seg', '2-ter', '3-qua', '4-qui', '5-sex', '6-sab', '7-dom'];
const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const labourCatalog = defineCatalog({
  entities: {
    labour: {
      label: 'Horas de equipe',
      fields: {
        day: { label: 'Dia', type: 'date', role: 'dimension' },
        weekday: {
          label: 'Dia da semana',
          type: 'string',
          role: 'dimension',
          ordered: true,
          values: WEEKDAYS.map((value, index) => ({ value, label: WEEKDAY_LABELS[index] ?? value })),
        },
        hour: {
          label: 'Hora',
          type: 'string',
          role: 'dimension',
          ordered: true,
          values: Array.from({ length: 24 }, (_, hour) => ({
            value: String(hour).padStart(2, '0'),
            label: `${hour}h`,
          })),
        },
        costCents: { label: 'Custo', type: 'money', role: 'measure', aggregations: ['sum', 'ratio'] },
        salesCents: { label: 'Vendas', type: 'money', role: 'measure' },
      },
    },
  },
});

/** Monday 10h and 12h over target, Tuesday 10h with staff and no sale; no row at 11h. */
const labourRows = [
  { day: '2026-11-09', weekday: '1-seg', hour: '10', costCents: 5800, salesCents: 10000 },
  { day: '2026-11-09', weekday: '1-seg', hour: '12', costCents: 1000, salesCents: 10000 },
  { day: '2026-11-10', weekday: '2-ter', hour: '10', costCents: 3000, salesCents: 0 },
  { day: '2026-11-10', weekday: '2-ter', hour: '12', costCents: 2000, salesCents: 10000 },
];

const options = {
  catalog: labourCatalog,
  adapter: createMemoryDataSource({ labour: labourRows }, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
  copy: PT_BR_REPORT_ENGINE_COPY,
  timeZone: 'America/Sao_Paulo',
};

const ratio = { field: 'costCents', aggregation: 'ratio' as const, denominator: 'salesCents', alias: 'ratio', format: 'percent' as const };
const LABELS = { above: 'acima da meta', below: 'abaixo da meta', empty: 'sem venda na hora' };

describe('heatmap presentation', () => {
  it('folds weekday × hour into ordered, labelled axes and one cell per pair', async () => {
    const { render } = await runReport(
      {
        entity: 'labour',
        dimensions: [{ field: 'weekday' }, { field: 'hour' }],
        measures: [ratio],
        presentation: { kind: 'heatmap', target: 0.3, strongAbove: 0.45, strongBelow: 0.18, labels: LABELS },
      },
      options,
    );
    expect(render.kind).toBe('heatmap');
    if (render.kind !== 'heatmap') return;
    expect(render.rowAxis).toEqual([
      { key: '1-seg', label: 'Seg' },
      { key: '2-ter', label: 'Ter' },
    ]);
    // 11h had no row at all, and is still a column: the range is contiguous.
    expect(render.columnAxis).toEqual([
      { key: '10', label: '10h' },
      { key: '11', label: '11h' },
      { key: '12', label: '12h' },
    ]);
    expect(render.cells).toContainEqual({ row: '1-seg', column: '10', value: 0.58 });
    // Staff and no sale: an occurrence with no figure.
    expect(render.cells).toContainEqual({ row: '2-ter', column: '10', value: null });
    expect(render.cells.some((cell) => cell.column === '11')).toBe(false);
    expect(render.scale).toEqual({ target: 0.3, strongAbove: 0.45, strongBelow: 0.18 });
    expect(render.labels).toEqual(LABELS);
    expect(render.valueFormat).toBe('percent');
    // The long form survives for the CSV.
    expect(render.tableColumns.map((column) => column.key)).toEqual(['weekday', 'hour', 'ratio']);
  });

  it('refuses a heat map without exactly two dimensions and one measure', async () => {
    const heatmap = { kind: 'heatmap' as const, target: 0.3, labels: LABELS };
    await expect(
      runReport({ entity: 'labour', dimensions: [{ field: 'weekday' }], measures: [ratio], presentation: heatmap }, options),
    ).rejects.toThrow(/exactly 2 dimensions/);
    await expect(
      runReport(
        {
          entity: 'labour',
          dimensions: [{ field: 'weekday' }, { field: 'hour' }],
          measures: [ratio, { field: 'salesCents' }],
          presentation: heatmap,
        },
        options,
      ),
    ).rejects.toThrow(/exactly 1 measure/);
  });
});

describe('heatmapAxis', () => {
  it('draws a field without declared values in sorted order', () => {
    expect(heatmapAxis(undefined, new Set(['b', 'a']))).toEqual([
      { key: 'a', label: 'a' },
      { key: 'b', label: 'b' },
    ]);
  });

  it('puts a value the field does not declare after the declared range', () => {
    const field = { label: 'x', type: 'string' as const, role: 'dimension' as const, values: [{ value: 'a', label: 'A' }] };
    expect(heatmapAxis(field, new Set(['zz', 'a']))).toEqual([
      { key: 'a', label: 'A' },
      { key: 'zz', label: 'zz' },
    ]);
  });
});

describe('table row flag', () => {
  const flag = { measure: 'ratio', above: 0.3, label: 'acima da meta', whenEmpty: { measure: 'cost' } };

  it('marks the rows above the threshold, and a cost with no sales', async () => {
    const { render } = await runReport(
      {
        entity: 'labour',
        dimensions: [{ field: 'day', timeGrain: 'day' }],
        measures: [{ field: 'costCents', alias: 'cost' }, { field: 'salesCents', alias: 'sales' }, ratio],
        sort: [{ by: 'day_day', direction: 'asc' }],
        presentation: { kind: 'table', flag },
      },
      options,
    );
    expect(render.kind).toBe('table');
    if (render.kind !== 'table') return;
    // Monday: 6800 / 20000 = 34% → over. Tuesday: 5000 / 10000 = 50% → over.
    expect(render.flag).toEqual({ column: 'ratio', label: 'acima da meta', rows: [0, 1] });
  });

  it('decides one row: over, at, empty with cost, empty without cost', () => {
    expect(isRowFlagged({ ratio: 0.31, cost: 1 }, flag)).toBe(true);
    expect(isRowFlagged({ ratio: 0.3, cost: 1 }, flag)).toBe(false);
    expect(isRowFlagged({ ratio: null, cost: 3000 }, flag)).toBe(true);
    expect(isRowFlagged({ ratio: null, cost: 0 }, flag)).toBe(false);
    expect(isRowFlagged({ ratio: null, cost: 3000 }, { ...flag, whenEmpty: undefined })).toBe(false);
  });

  it('carries no flag when the presentation asks for none', async () => {
    const { render } = await runReport(
      { entity: 'labour', dimensions: [{ field: 'weekday' }], measures: [ratio] },
      options,
    );
    expect(render.kind).toBe('table');
    expect('flag' in render).toBe(false);
  });

  it('refuses a flag naming a measure the spec does not select', async () => {
    const run = runReport(
      {
        entity: 'labour',
        dimensions: [{ field: 'weekday' }],
        measures: [ratio],
        presentation: { kind: 'table', flag: { ...flag, whenEmpty: { measure: 'nope' } } },
      },
      options,
    );
    await expect(run).rejects.toBeInstanceOf(ReportBuilderError);
    await expect(run).rejects.toThrow(/"nope"/);
  });
});
