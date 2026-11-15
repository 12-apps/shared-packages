/**
 * FUT-4063, round three in the engine: a ratio whose every numerator is null
 * reads null ("—", never 0%) in a table, a KPI and a heat map; and a heat map
 * may drop its empty edges, so a shift auto-closed across the night no longer
 * stretches the hours to 0h–23h.
 */
import { describe, expect, it } from 'vitest';

import { mergeAccumulator, newAccumulator, type MeasureAccumulator } from '../aggregates';
import { defineCatalog } from '../catalog';
import { createMemoryDataSource } from '../memory';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { trimAxisEdges } from '../render-heatmap';
import { runReport } from '../run';

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour).padStart(2, '0'), label: `${hour}h` }));

const catalog = defineCatalog({
  entities: {
    labour: {
      label: 'Horas de equipe',
      fields: {
        area: { label: 'Área', type: 'string', role: 'dimension' },
        weekday: {
          label: 'Dia da semana',
          type: 'string',
          role: 'dimension',
          ordered: true,
          values: [
            { value: '1-seg', label: 'Seg' },
            { value: '2-ter', label: 'Ter' },
          ],
        },
        hour: { label: 'Hora', type: 'string', role: 'dimension', ordered: true, values: HOURS },
        costCents: { label: 'Custo', type: 'money', role: 'measure', aggregations: ['sum', 'ratio'] },
        salesCents: { label: 'Vendas', type: 'money', role: 'measure' },
      },
    },
  },
});

const ratio = { field: 'costCents', aggregation: 'ratio' as const, denominator: 'salesCents', alias: 'ratio', format: 'percent' as const };
const LABELS = { above: 'acima', below: 'abaixo', empty: 'sem figura' };

function optionsFor(rows: Array<Record<string, unknown>>) {
  return {
    catalog,
    adapter: createMemoryDataSource({ labour: rows }, PT_BR_REPORT_ENGINE_COPY.labels.othersBucket),
    copy: PT_BR_REPORT_ENGINE_COPY,
    timeZone: 'America/Sao_Paulo',
  };
}

describe('a ratio with no numerator', () => {
  // Entregas: nobody's hour is priced, so cost is null on every row.
  const areaRows = () => [
    { area: 'Cozinha', costCents: 3000, salesCents: 10000 },
    { area: 'Entregas', costCents: null, salesCents: 10000 },
    { area: 'Entregas', costCents: null, salesCents: 5000 },
    { area: 'Salão', costCents: null, salesCents: 10000 },
    { area: 'Salão', costCents: 1000, salesCents: 10000 },
  ];

  it('is null in a table when every numerator in the bucket is null, and a sum of the rest otherwise', async () => {
    const { rows: out } = await runReport(
      { entity: 'labour', dimensions: [{ field: 'area' }], measures: [ratio], presentation: { kind: 'table' } },
      optionsFor(areaRows()),
    );
    const byArea = Object.fromEntries(out.map((row) => [row.area, row.ratio]));
    expect(byArea).toEqual({ Cozinha: 0.3, Entregas: null, Salão: 0.05 });
  });

  it('is null in a KPI over a period with no priced hour', async () => {
    const { render } = await runReport(
      { entity: 'labour', measures: [ratio], presentation: { kind: 'kpi' } },
      optionsFor(areaRows().filter((row) => row.area === 'Entregas')),
    );
    expect(render.kind).toBe('kpi');
    if (render.kind !== 'kpi') return;
    expect(render.value).toBeNull();
  });

  it('merges counts exactly, and an accumulator built by hand keeps the old rule', () => {
    const into = newAccumulator();
    mergeAccumulator(into, { ...newAccumulator(), numeratorCount: 0, denominatorSum: 10 });
    expect(into.numeratorCount).toBe(0);
    const legacy: MeasureAccumulator = { ...newAccumulator() };
    delete legacy.numeratorCount;
    mergeAccumulator(into, legacy);
    expect(into.numeratorCount).toBeUndefined();
  });
});

describe('heat map trimEdges', () => {
  // Store open 11h–14h on Monday; an auto-closed shift spread cost over the
  // night (0h–2h, 22h–23h) with no sale, so those cells have no figure.
  const nightRows = () => [
    ...['00', '01', '02', '22', '23'].map((hour) => ({ weekday: '1-seg', hour, costCents: 2000, salesCents: 0 })),
    { weekday: '1-seg', hour: '11', costCents: 3000, salesCents: 10000 },
    { weekday: '1-seg', hour: '14', costCents: 3000, salesCents: 10000 },
    { weekday: '2-ter', hour: '12', costCents: 3000, salesCents: 10000 },
  ];
  const spec = (trimEdges?: 'rows' | 'columns' | 'both') => ({
    entity: 'labour',
    dimensions: [{ field: 'weekday' }, { field: 'hour' }],
    measures: [ratio],
    presentation: { kind: 'heatmap' as const, target: 0.3, labels: LABELS, ...(trimEdges ? { trimEdges } : {}) },
  });

  it('draws only the hours from the first to the last with a figure, contiguous between', async () => {
    const { render } = await runReport(spec('columns'), optionsFor(nightRows()));
    if (render.kind !== 'heatmap') throw new Error('expected a heat map');
    expect(render.columnAxis.map((item) => item.label)).toEqual(['11h', '12h', '13h', '14h']);
    expect(render.cells.every((cell) => ['11', '12', '13', '14'].includes(cell.column))).toBe(true);
    // The long form keeps every row, so the CSV still carries the night's cost.
    expect(render.rows).toHaveLength(nightRows().length);
  });

  it('draws every present hour without it, as always', async () => {
    const { render } = await runReport(spec(), optionsFor(nightRows()));
    if (render.kind !== 'heatmap') throw new Error('expected a heat map');
    expect(render.columnAxis).toHaveLength(24);
  });

  it('trims rows only when asked', () => {
    const axis = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
      { key: 'd', label: 'D' },
    ];
    expect(trimAxisEdges(axis, new Set(['b', 'c']))).toEqual(axis.slice(1, 3));
    expect(trimAxisEdges(axis, new Set(['b', 'd']))).toEqual(axis.slice(1));
    // No figure anywhere: the axis is left as it is, and the grid reads its empty cells.
    expect(trimAxisEdges(axis, new Set())).toEqual(axis);
  });
});
