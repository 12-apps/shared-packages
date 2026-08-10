import { describe, expect, it } from 'vitest';

import { reportSpecSchema } from '../../spec';
import { operatorOptionsFor } from '../builder-filters';
import { editMeasureRow } from '../builder-measures';
import {
  chartOptions,
  draftFromSpec,
  specFromDraft,
  starterDraft,
  withValidChart,
  type BuilderDraft,
} from '../builder-model';
import type { ReportEntityFields, ReportField, ReportSpecWire } from '../custom-reports-api';

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
  it('lets line/area/bar chart a split, and keeps pie/donut out of it', () => {
    // FUT-755: the second dimension is pivoted into one series per value, so
    // the cartesian types draw it. A pie cannot — it shows ONE series'
    // composition — and its reason must name the split rather than repeat the
    // blanket "gráficos exigem exatamente 1 agrupamento" five times over.
    const options = chartOptions(
      draft({
        dimensions: [
          { field: 'method', timeGrain: 'day' },
          { field: 'createdAt', timeGrain: 'day' },
        ],
      }),
      byName,
    );
    const reasonOf = (value: string): string | null | undefined =>
      options.find((option) => option.value === value)?.disabledReason;

    expect(reasonOf('table')).toBeNull();
    expect([reasonOf('line'), reasonOf('area'), reasonOf('bar')]).toEqual([null, null, null]);
    expect(reasonOf('pie')).toContain('separar em séries');
    expect(reasonOf('donut')).toContain('separar em séries');
  });

  it('blocks a split PLUS a second measure — no chart draws three ways', () => {
    const options = chartOptions(
      draft({
        dimensions: [
          { field: 'method', timeGrain: 'day' },
          { field: 'createdAt', timeGrain: 'day' },
        ],
        measures: [
          { field: 'revenueCents', aggregation: 'sum' },
          { field: 'quantity', aggregation: 'sum' },
        ],
      }),
      byName,
    );
    expect(options.find((option) => option.value === 'bar')?.disabledReason).toContain('medida');
    expect(options.find((option) => option.value === 'table')?.disabledReason).toBeNull();
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
    expect(options.find((option) => option.value === 'pie')?.disabledReason).toContain(
      'uma medida só',
    );
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

  it('falls back to line for a time series, and to bars for a split', () => {
    expect(
      withValidChart(
        draft({ dimensions: [{ field: 'createdAt', timeGrain: 'day' }], chartType: 'pie', measures: [
          { field: 'revenueCents', aggregation: 'sum' },
          { field: 'quantity', aggregation: 'sum' },
        ] }),
        byName,
      ).chartType,
    ).toBe('line');
    // Adding a split while on a pie used to drop the author all the way to a
    // table. The axis here is a plain category, so bars are the smart default.
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
    ).toBe('bar');
  });

  it('still falls back to a table for a split alongside two measures', () => {
    expect(
      withValidChart(
        draft({
          dimensions: [
            { field: 'method', timeGrain: 'day' },
            { field: 'createdAt', timeGrain: 'day' },
          ],
          measures: [
            { field: 'revenueCents', aggregation: 'sum' },
            { field: 'quantity', aggregation: 'sum' },
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

/**
 * Plan entry 11, the half that was outstanding: `in` and `between` expressible
 * without hand-editing a spec.
 *
 * The old `SINGLE_VALUE_OPERATORS` comment named the exact risk of widening the
 * offer — "offering them would trade a typo for a 400" — so every case here
 * ends at `reportSpecSchema`, the thing that would have returned that 400. A
 * round trip that merely agrees with itself would pass with both halves wrong.
 */
describe('typed filter values and the full operator set (entry 11)', () => {
  const STATUS: ReportField = {
    field: 'status',
    label: 'Status',
    type: 'string',
    role: 'dimension',
    values: [
      { value: 'PAID', label: 'Pago' },
      { value: 'FAILED', label: 'Falhou' },
    ],
    ops: ['eq', 'neq', 'in'],
  };
  /** The same money field as above, with the `ops` the catalog resolves for it. */
  const REVENUE: ReportField = {
    field: 'revenueCents',
    label: 'Receita',
    type: 'money',
    role: 'measure',
    ops: ['eq', 'neq', 'gte', 'lte', 'between'],
  };
  const filterFields = new Map([
    ...byName,
    ['status', STATUS],
    ['revenueCents', REVENUE],
  ]);

  const specWith = (filters: ReportSpecWire['filters']): ReportSpecWire => ({
    entity: 'orders',
    dimensions: [{ field: 'method' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum' }],
    filters,
    sort: [],
    presentation: { kind: 'table' },
  });

  /** The spec a stored one becomes after a trip through the form and back. */
  const roundTrip = (filters: ReportSpecWire['filters']): ReportSpecWire['filters'] =>
    specFromDraft(draftFromSpec('R', null, specWith(filters)), filterFields).filters;

  it.each([
    ['in', [{ field: 'status', operator: 'in', values: ['PAID', 'FAILED'] }]],
    ['between', [{ field: 'revenueCents', operator: 'between', from: 100, to: 5000 }]],
    ['eq', [{ field: 'status', operator: 'eq', value: 'PAID' }]],
  ])('round-trips a stored `%s` filter losslessly', (_operator, filters) => {
    // Lossless in the direction that matters: a report opened in the builder
    // and saved back unchanged must be the same document. Before this, a spec
    // whose filter carried no `value` was DROPPED on the way in — so opening an
    // MCP-authored `in` report and pressing save published it unfiltered.
    expect(roundTrip(filters)).toEqual(filters);
  });

  it('accepts every round-tripped filter at `reportSpecSchema`', () => {
    const filters: ReportSpecWire['filters'] = [
      { field: 'status', operator: 'in', values: ['PAID', 'FAILED'] },
      { field: 'revenueCents', operator: 'between', from: 100, to: 5000 },
    ];
    const parsed = reportSpecSchema.safeParse(specWith(roundTrip(filters)));
    expect(parsed.success).toBe(true);
  });

  it('produces a schema-valid spec for a filter row built through the form', () => {
    // The offer and the serialization, joined: pick the operator the UI offers,
    // fill the row the way its control does, and the spec must parse.
    const rows = [
      { field: 'status', operator: 'in', value: '', values: ['PAID'] },
      { field: 'revenueCents', operator: 'between', value: '', from: '10', to: '20' },
    ];
    for (const row of rows) {
      expect(operatorOptionsFor(filterFields.get(row.field))).toContain(row.operator);
      const spec = specFromDraft(draft({ filters: [row] }), filterFields);
      const parsed = reportSpecSchema.safeParse({ ...spec, presentation: { kind: 'table' } });
      expect(parsed.success).toBe(true);
    }
  });

  it('never emits a half-filled row, which is the 400 the old narrowing avoided', () => {
    const spec = specFromDraft(
      draft({
        filters: [
          { field: 'revenueCents', operator: 'between', value: '', from: '10', to: '' },
          { field: 'status', operator: 'in', value: '', values: [] },
        ],
      }),
      filterFields,
    );
    expect(spec.filters).toEqual([]);
    expect(reportSpecSchema.safeParse({ ...spec, presentation: { kind: 'table' } }).success).toBe(
      true,
    );
  });
});
