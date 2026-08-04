import { describe, expect, it } from 'vitest';

import { editMeasureRow } from '../builder-measures';
import {
  chartOptions,
  draftFromSpec,
  specFromDraft,
  starterDraft,
  withValidChart,
  type BuilderDraft,
} from '../builder-model';
import type { ReportEntityFields, ReportField } from '../custom-reports-api';

/**
 * FUT-308 in the form model: the picker disables what the compiler rejects,
 * edits that invalidate the chart fall back to the smart default, and a new
 * report opens on the entity's starter spec.
 */
const FIELDS: ReportField[] = [
  { field: 'createdAt', label: 'Data', type: 'date', role: 'dimension' },
  { field: 'method', label: 'Forma', type: 'string', role: 'dimension' },
  { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  { field: 'quantity', label: 'Qtd', type: 'number', role: 'measure' },
];
const byName = new Map(FIELDS.map((field) => [field.field, field]));

function draft(patch: Partial<BuilderDraft>): BuilderDraft {
  return {
    name: '',
    description: '',
    entity: 'orders',
    dimensions: [{ field: 'method', timeGrain: 'day' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum' }],
    filters: [],
    sort: [],
    chartType: 'pie',
    stacked: false,
    ...patch,
  };
}

describe('chartOptions', () => {
  it('disables charts for a two-dimension breakdown, keeping table', () => {
    const options = chartOptions(
      draft({
        dimensions: [
          { field: 'method', timeGrain: 'day' },
          { field: 'createdAt', timeGrain: 'day' },
        ],
      }),
      byName,
    );
    expect(options.find((option) => option.value === 'table')?.disabledReason).toBeNull();
    expect(options.find((option) => option.value === 'line')?.disabledReason).toContain(
      'exatamente 1 agrupamento',
    );
  });

  it('disables only pie/donut when a second measure appears', () => {
    const options = chartOptions(
      draft({
        measures: [
          { field: 'revenueCents', aggregation: 'sum' },
          { field: 'quantity', aggregation: 'sum' },
        ],
      }),
      byName,
    );
    expect(options.find((option) => option.value === 'bar')?.disabledReason).toBeNull();
    expect(options.find((option) => option.value === 'pie')?.disabledReason).toContain('1 medida');
  });
});

describe('withValidChart', () => {
  it('keeps a still-valid selection untouched', () => {
    const current = draft({});
    expect(withValidChart(current, byName)).toBe(current);
  });

  it('falls back to the KPI tile when the last grouping is removed (FUT-309)', () => {
    const next = withValidChart(draft({ dimensions: [], chartType: 'pie' }), byName);
    expect(next.chartType).toBe('kpi');
  });

  it('falls back from pie to bar when a second measure lands', () => {
    const next = withValidChart(
      draft({
        measures: [
          { field: 'revenueCents', aggregation: 'sum' },
          { field: 'quantity', aggregation: 'sum' },
        ],
      }),
      byName,
    );
    expect(next.chartType).toBe('bar');
  });

  it('falls back to line for a time series and table for two groupings', () => {
    expect(
      withValidChart(
        draft({ dimensions: [{ field: 'createdAt', timeGrain: 'day' }], chartType: 'pie', measures: [
          { field: 'revenueCents', aggregation: 'sum' },
          { field: 'quantity', aggregation: 'sum' },
        ] }),
        byName,
      ).chartType,
    ).toBe('line');
    expect(
      withValidChart(
        draft({
          dimensions: [
            { field: 'method', timeGrain: 'day' },
            { field: 'createdAt', timeGrain: 'day' },
          ],
        }),
        byName,
      ).chartType,
    ).toBe('table');
  });
});

describe('starterDraft', () => {
  const entity: ReportEntityFields = {
    entity: 'orders',
    label: 'Pedidos',
    fields: FIELDS,
    starter: {
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
      measures: [{ field: 'revenueCents', aggregation: 'sum' }],
      filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
      sort: [],
      presentation: { kind: 'chart', chartType: 'line' },
    },
  };

  it('prefills the form from the entity starter', () => {
    const prefilled = starterDraft(entity, 'orders');
    expect(prefilled.dimensions).toEqual([{ field: 'createdAt', timeGrain: 'day' }]);
    expect(prefilled.measures).toEqual([{ field: 'revenueCents', aggregation: 'sum' }]);
    expect(prefilled.filters).toEqual([{ field: 'status', operator: 'eq', value: 'PAID' }]);
    expect(prefilled.chartType).toBe('line');
    expect(prefilled.name).toBe('');
  });

  it('falls back to an empty form without a starter', () => {
    const prefilled = starterDraft({ ...entity, starter: undefined }, 'orders');
    expect(prefilled.dimensions).toEqual([]);
    expect(prefilled.chartType).toBe('table');
  });
});

describe('sort/limit pass-through', () => {
  const topN = {
    entity: 'orders',
    dimensions: [{ field: 'method' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
    filters: [],
    sort: [{ by: 'receita', direction: 'desc' as const }],
    limit: 10,
    presentation: { kind: 'chart' as const, chartType: 'bar' as const },
  };

  it('round-trips a top-N spec through the form without losing ordering', () => {
    const roundTripped = specFromDraft(draftFromSpec('Top', null, topN), byName);
    expect(roundTripped.sort).toEqual([{ by: 'receita', direction: 'desc' }]);
    expect(roundTripped.limit).toBe(10);
    expect(roundTripped.measures).toEqual([
      { field: 'revenueCents', aggregation: 'sum', alias: 'receita' },
    ]);
  });

  it('drops a sort entry whose measure alias no longer resolves', () => {
    const edited = draftFromSpec('Top', null, topN);
    // The form's measure editor rebuilds the row without the alias.
    edited.measures = [{ field: 'quantity', aggregation: 'sum' }];
    const spec = specFromDraft(edited, byName);
    expect(spec.sort).toEqual([]);
    expect(spec.limit).toBe(10);
  });

  it('keeps the alias (and its sort) through an aggregation-only edit', () => {
    const edited = editMeasureRow(
      draftFromSpec('Top', null, topN),
      0,
      'revenueCents',
      'avg',
      byName.get('revenueCents'),
    );
    const spec = specFromDraft(edited, byName);
    expect(spec.measures).toEqual([{ field: 'revenueCents', aggregation: 'avg', alias: 'receita' }]);
    expect(spec.sort).toEqual([{ by: 'receita', direction: 'desc' }]);
  });

  it('retargets the sort to the new measure when the field changes', () => {
    const edited = editMeasureRow(
      draftFromSpec('Top', null, topN),
      0,
      'quantity',
      'sum',
      byName.get('quantity'),
    );
    const spec = specFromDraft(edited, byName);
    expect(spec.measures).toEqual([{ field: 'quantity', aggregation: 'sum' }]);
    // Still a top-10 report — now ranked by the swapped-in measure.
    expect(spec.sort).toEqual([{ by: 'sum_quantity', direction: 'desc' }]);
    expect(spec.limit).toBe(10);
  });

  /**
   * FUT-454. The form cannot AUTHOR `minSample`, so a user who picks an
   * identity dimension would otherwise build a spec `compileReport` refuses
   * with no way to satisfy it from the form. The floor is applied from the
   * catalog instead, which is the same answer the server would give.
   */
  describe('identity dimensions carry the catalog suppression floor', () => {
    const chef: ReportField = {
      field: 'chefName',
      label: 'Cozinheiro',
      type: 'string',
      role: 'dimension',
      minGroupSample: 20,
    };
    const kitchenFields = new Map([...byName, ['chefName', chef]]);

    it('floors every measure when the form groups by an identity field', () => {
      const spec = specFromDraft(
        draft({
          dimensions: [{ field: 'chefName', timeGrain: 'day' }],
          measures: [
            { field: 'revenueCents', aggregation: 'sum' },
            { field: 'quantity', aggregation: 'sum' },
          ],
          chartType: 'table',
        }),
        kitchenFields,
      );
      expect(spec.measures.map((measure) => measure.minSample)).toEqual([20, 20]);
    });

    it('floors them when the form only FILTERS to one individual', () => {
      const spec = specFromDraft(
        draft({
          dimensions: [],
          filters: [{ field: 'chefName', operator: 'eq', value: 'Ana' }],
          measures: [{ field: 'revenueCents', aggregation: 'sum' }],
          chartType: 'table',
        }),
        kitchenFields,
      );
      expect(spec.measures[0]?.minSample).toBe(20);
    });

    it('never lowers a stricter floor a preset already declared', () => {
      const spec = specFromDraft(
        draft({
          dimensions: [{ field: 'chefName', timeGrain: 'day' }],
          measures: [{ field: 'revenueCents', aggregation: 'sum', minSample: 50 }],
          chartType: 'table',
        }),
        kitchenFields,
      );
      expect(spec.measures[0]?.minSample).toBe(50);
    });

    it('leaves an ordinary report unfloored', () => {
      const spec = specFromDraft(
        draft({ measures: [{ field: 'revenueCents', aggregation: 'sum' }], chartType: 'table' }),
        kitchenFields,
      );
      expect(spec.measures[0]?.minSample).toBeUndefined();
    });
  });

  it('retargets a derived-alias sort through an aggregation change', () => {
    const edited = editMeasureRow(
      draft({
        dimensions: [{ field: 'method', timeGrain: 'day' }],
        measures: [{ field: 'revenueCents', aggregation: 'sum' }],
        sort: [{ by: 'sum_revenueCents', direction: 'desc' }],
        chartType: 'bar',
      }),
      0,
      'revenueCents',
      'avg',
      byName.get('revenueCents'),
    );
    const spec = specFromDraft(edited, byName);
    expect(spec.sort).toEqual([{ by: 'avg_revenueCents', direction: 'desc' }]);
  });

  it('round-trips KPI label/format overrides the form cannot edit (FUT-309)', () => {
    const kpiSpec = {
      entity: 'orders',
      dimensions: [],
      measures: [{ field: 'revenueCents', aggregation: 'sum' }],
      filters: [],
      sort: [],
      presentation: { kind: 'kpi' as const, label: 'Receita', numberFormat: 'compact' },
    };
    const spec = specFromDraft(draftFromSpec('KPI', null, kpiSpec), byName);
    expect(spec.presentation).toEqual({ kind: 'kpi', label: 'Receita', numberFormat: 'compact' });
  });

  it('keeps a sort keyed on a compiler-derived default alias', () => {
    const spec = specFromDraft(
      draft({
        measures: [{ field: 'revenueCents', aggregation: 'sum' }],
        sort: [{ by: 'sum_revenueCents', direction: 'asc' }],
      }),
      byName,
    );
    expect(spec.sort).toEqual([{ by: 'sum_revenueCents', direction: 'asc' }]);
  });
});
