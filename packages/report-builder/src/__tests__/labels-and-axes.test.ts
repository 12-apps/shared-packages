/**
 * FUT-4063, round-1 review: a host names its own headings, a closed set's
 * labels reach the columns, a dimension can ask the host to format its values,
 * and an hour axis without declared values sorts as numbers.
 */
import { describe, expect, it } from 'vitest';

import { defineCatalog } from '../catalog';
import { createMemoryDataSource } from '../memory';
import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { heatmapAxis } from '../render-heatmap';
import { runReport } from '../run';

const catalog = defineCatalog({
  entities: {
    labour: {
      label: 'Horas',
      fields: {
        day: { label: 'Data', type: 'date', role: 'dimension' },
        area: {
          label: 'Área',
          type: 'string',
          role: 'dimension',
          values: [
            { value: 'k', label: 'Cozinha' },
            { value: 's', label: 'Salão' },
          ],
        },
        costCents: { label: 'Custo', type: 'money', role: 'measure', aggregations: ['sum', 'ratio'] },
        salesCents: { label: 'Vendas', type: 'money', role: 'measure' },
      },
    },
  },
});

const options = {
  catalog,
  adapter: createMemoryDataSource(
    { labour: [{ day: '2026-11-09T15:00:00Z', area: 'k', costCents: 100, salesCents: 400 }] },
    PT_BR_REPORT_ENGINE_COPY.labels.othersBucket,
  ),
  copy: PT_BR_REPORT_ENGINE_COPY,
};

describe('column headings and value labels', () => {
  it("uses the spec's own headings instead of 'Data (dia)' and 'Custo (proporção)'", async () => {
    const { render } = await runReport(
      {
        entity: 'labour',
        dimensions: [{ field: 'day', timeGrain: 'day', label: 'Dia', bucketFormat: 'weekday-day' }],
        measures: [
          { field: 'costCents', aggregation: 'ratio', denominator: 'salesCents', alias: 'ratio', format: 'percent', label: 'Custo / vendas' },
        ],
      },
      options,
    );
    if (render.kind !== 'table') throw new Error('expected a table');
    expect(render.columns.map((column) => column.label)).toEqual(['Dia', 'Custo / vendas']);
    expect(render.columns[0]).toMatchObject({ bucketFormat: 'weekday-day', grain: 'day' });
  });

  it("carries a closed set's labels on its column, and nothing on an open one", async () => {
    const { render } = await runReport(
      { entity: 'labour', dimensions: [{ field: 'area' }, { field: 'day', timeGrain: 'day' }], measures: [{ field: 'costCents' }] },
      options,
    );
    if (render.kind !== 'table') throw new Error('expected a table');
    expect(render.columns[0]?.valueLabels).toEqual({ k: 'Cozinha', s: 'Salão' });
    expect(render.columns[1]).not.toHaveProperty('valueLabels');
    expect(render.columns[1]).not.toHaveProperty('bucketFormat');
  });
});

describe('heatmapAxis without declared values', () => {
  it('sorts hour keys as numbers: 9 before 10', () => {
    expect(heatmapAxis(undefined, new Set(['10', '9', '23'])).map((item) => item.key)).toEqual(['9', '10', '23']);
  });
});
