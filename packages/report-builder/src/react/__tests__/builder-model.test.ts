import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { describe, expect, it } from 'vitest';

import { reportSpecSchema } from '../../spec';
import { operatorOptionsFor } from '../builder-filters';
import { editMeasureRow } from '../builder-measures';
import {
  chartOptions,
  draftFromSpec,
  specFromDraft,
  stackedOption,
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
/**
 * `ordered` rides the `/reports/fields` wire (FUT-755) but `ReportField` does
 * not declare it yet, so it is intersected in here. That is deliberate and it
 * is what the runtime does: `listCatalogFields` sends the key and the
 * transport is a plain `json()` cast, so the value arrives whether or not the
 * interface names it — and `isOrderedDimension` reads it structurally.
 */
type WireField = ReportField & { ordered?: boolean };

const FIELDS: WireField[] = [
  { field: 'createdAt', label: 'Data', type: 'date', role: 'dimension' },
  { field: 'method', label: 'Forma', type: 'string', role: 'dimension' },
  // A string the catalog declares ordered — the `orders.hourOfDay` case.
  { field: 'hourOfDay', label: 'Hora', type: 'string', role: 'dimension', ordered: true },
  { field: 'closed', label: 'Encerrado', type: 'boolean', role: 'dimension' },
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
    //
    // The AXIS is the date: the FIRST dimension is what a line's slope runs
    // along, and it is the one the ordered-axis rule judges. Splitting a date
    // axis by payment method is exactly the shape the pivot exists to draw.
    const options = chartOptions(
      draft({
        dimensions: [
          { field: 'createdAt', timeGrain: 'day' },
          { field: 'method', timeGrain: 'day' },
        ],
      }),
      byName,
    PT_BR_REPORT_ENGINE_COPY.presentation,
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
    PT_BR_REPORT_ENGINE_COPY.presentation,
);
    expect(options.find((option) => option.value === 'bar')?.disabledReason).toContain('medida');
    expect(options.find((option) => option.value === 'table')?.disabledReason).toBeNull();
  });

  it('refuses line and area over a categorical axis, offering bars (FUT-755)', () => {
    // The bug report: an AREA chart whose x-axis was CARD → PIX. A line or an
    // area asserts the space BETWEEN two points is a value; half-way between
    // two payment methods is not one.
    const options = chartOptions(draft({ dimensions: [{ field: 'method', timeGrain: 'day' }] }), byName, PT_BR_REPORT_ENGINE_COPY.presentation);
    const reasonOf = (value: string): string | null | undefined =>
      options.find((option) => option.value === value)?.disabledReason;

    expect(reasonOf('line')).toContain('Barras');
    expect(reasonOf('area')).toContain('Barras');
    // The same data as bars makes no claim about the gap, so it stays offered.
    expect(reasonOf('bar')).toBeNull();
    expect(reasonOf('table')).toBeNull();
  });

  it('allows line and area over an ORDERED string axis the catalog declares', () => {
    // `hourOfDay` is a string, so only the catalog's `ordered` flag separates
    // it from `method`. "Pedidos por hora" is the textbook line chart.
    const options = chartOptions(
      draft({ dimensions: [{ field: 'hourOfDay', timeGrain: 'day' }] }),
      byName,
    PT_BR_REPORT_ENGINE_COPY.presentation,
);

    expect(options.find((option) => option.value === 'line')?.disabledReason).toBeNull();
    expect(options.find((option) => option.value === 'area')?.disabledReason).toBeNull();
  });

  it('refuses line and area over a BOOLEAN axis', () => {
    const options = chartOptions(draft({ dimensions: [{ field: 'closed', timeGrain: 'day' }] }), byName, PT_BR_REPORT_ENGINE_COPY.presentation);

    expect(options.find((option) => option.value === 'line')?.disabledReason).not.toBeNull();
    expect(options.find((option) => option.value === 'bar')?.disabledReason).toBeNull();
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
    PT_BR_REPORT_ENGINE_COPY.presentation,
);
    expect(options.find((option) => option.value === 'bar')?.disabledReason).toBeNull();
    expect(options.find((option) => option.value === 'pie')?.disabledReason).toContain(
      'uma medida só',
    );
  });
});

/**
 * With NO grouping, `Número` is the only offer (FUT-755): "on this case we
 * should not allow table, only number. There is no point in show table if we
 * will only have 1 line for columns" — and "only numero should be allowed with
 * multiple boxes".
 *
 * This inverts the old fallback, where `Tabela` was the option that was never
 * blocked. The direction that must not regress is the other one, so the last
 * case here re-proves the table is still offered the moment a grouping exists.
 */
describe('chartOptions — no grouping', () => {
  const reasonsFor = (measures: BuilderDraft['measures']): Map<string, string | null> =>
    new Map(
      chartOptions(draft({ dimensions: [], measures }), byName, PT_BR_REPORT_ENGINE_COPY.presentation).map((option) => [
        option.value,
        option.disabledReason,
      ]),
    );
  const ONE = [{ field: 'revenueCents', aggregation: 'sum' }];
  const THREE = [
    { field: 'revenueCents', aggregation: 'sum' },
    { field: 'quantity', aggregation: 'sum' },
    { field: 'quantity', aggregation: 'avg' },
  ];

  it('offers Número for one measure and for several', () => {
    expect(reasonsFor(ONE).get('kpi')).toBeNull();
    expect(reasonsFor(THREE).get('kpi')).toBeNull();
  });

  it('blocks the table, which would be a header above a single line', () => {
    const reason = reasonsFor(THREE).get('table') ?? '';
    expect(reason).toContain('uma linha só');
    expect(reason).toContain('Número');
  });

  it('blocks every chart too, and sends the author to the grouping', () => {
    for (const option of ['line', 'bar', 'area', 'pie', 'donut']) {
      expect(reasonsFor(THREE).get(option), option).not.toBeNull();
    }
  });

  it('offers the table again the moment a grouping exists', () => {
    const options = chartOptions(draft({ measures: THREE }), byName, PT_BR_REPORT_ENGINE_COPY.presentation);
    expect(options.find((option) => option.value === 'table')?.disabledReason).toBeNull();
  });
});

/**
 * `Empilhado` (FUT-755): "stacked or not, does not make difference", "probably
 * stacked is the same case of line and area". Stacking is a statement about
 * SERIES — with one series the toggle redraws an identical chart.
 */
describe('stackedOption', () => {
  const TWO_MEASURES = [
    { field: 'revenueCents', aggregation: 'sum' },
    { field: 'quantity', aggregation: 'sum' },
  ];

  it.each(['bar', 'area'] as const)('offers %s stacking once a split exists', (chartType) => {
    const current = draft({
      chartType,
      dimensions: [
        { field: 'createdAt', timeGrain: 'day' },
        { field: 'method', timeGrain: 'day' },
      ],
    });
    expect(stackedOption(current, byName, PT_BR_REPORT_ENGINE_COPY.presentation)?.disabledReason).toBeNull();
  });

  it.each(['bar', 'area'] as const)('offers %s stacking with two measures', (chartType) => {
    expect(
      stackedOption(draft({ chartType, measures: TWO_MEASURES }), byName, PT_BR_REPORT_ENGINE_COPY.presentation)?.disabledReason,
    ).toBeNull();
  });

  it.each(['bar', 'area'] as const)('refuses %s stacking with one series', (chartType) => {
    const reason = stackedOption(draft({ chartType }), byName, PT_BR_REPORT_ENGINE_COPY.presentation)?.disabledReason ?? '';
    // Names the control to change, in the register the other reasons use.
    expect(reason).toContain('“separar em séries”');
    expect(reason).toContain('medida');
  });

  it.each(['table', 'kpi', 'line', 'pie', 'donut'] as const)(
    'draws no toggle at all for %s',
    (chartType) => {
      // `null` is "this control does not apply here", which is a different
      // answer from a toggle that is on screen and refused.
      expect(stackedOption(draft({ chartType, measures: TWO_MEASURES }), byName, PT_BR_REPORT_ENGINE_COPY.presentation)).toBeNull();
    },
  );
});

describe('withValidChart', () => {
  it('keeps a still-valid selection untouched', () => {
    const current = draft({});
    expect(withValidChart(current, byName, PT_BR_REPORT_ENGINE_COPY.presentation)).toBe(current);
  });

  it('falls back to the KPI tile when the last grouping is removed (FUT-309)', () => {
    const next = withValidChart(draft({ dimensions: [], chartType: 'pie' }), byName, PT_BR_REPORT_ENGINE_COPY.presentation);
    expect(next.chartType).toBe('kpi');
  });

  it('rewrites a line to bars when the author picks a categorical grouping', () => {
    // The author is on a line over the date, then switches the grouping to
    // payment method. The draft self-corrects as they edit, so the shape the
    // rule refuses is never what gets saved (FUT-755).
    const next = withValidChart(
      draft({ dimensions: [{ field: 'method', timeGrain: 'day' }], chartType: 'line' }),
      byName,
    PT_BR_REPORT_ENGINE_COPY.presentation,
);

    expect(next.chartType).toBe('bar');
  });

  it('rewrites an area the same way', () => {
    const next = withValidChart(
      draft({ dimensions: [{ field: 'method', timeGrain: 'day' }], chartType: 'area' }),
      byName,
    PT_BR_REPORT_ENGINE_COPY.presentation,
);

    expect(next.chartType).toBe('bar');
  });

  it('leaves a line alone when the grouping is an ORDERED string', () => {
    const current = draft({
      dimensions: [{ field: 'hourOfDay', timeGrain: 'day' }],
      chartType: 'line',
    });

    expect(withValidChart(current, byName, PT_BR_REPORT_ENGINE_COPY.presentation)).toBe(current);
  });

  it('opens an hour-of-day grouping ON a line rather than bars', () => {
    // The smart default follows the same rule, so an author who groups by hour
    // while on a pie lands on the chart the data actually wants.
    const next = withValidChart(
      draft({ dimensions: [{ field: 'hourOfDay', timeGrain: 'day' }], chartType: 'pie', measures: [
        { field: 'revenueCents', aggregation: 'sum' },
        { field: 'quantity', aggregation: 'sum' },
      ] }),
      byName,
    PT_BR_REPORT_ENGINE_COPY.presentation,
);

    expect(next.chartType).toBe('line');
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
    PT_BR_REPORT_ENGINE_COPY.presentation,
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
      PT_BR_REPORT_ENGINE_COPY.presentation,
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
      PT_BR_REPORT_ENGINE_COPY.presentation,
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
      PT_BR_REPORT_ENGINE_COPY.presentation,
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
