import {
  autoTitle,
  compileReport,
  createMemoryDataSource,
  defaultValueFor,
  defineCatalog,
  isDirty,
  isClosedSet,
  listCatalogFields,
  operatorsFor,
  reportSpecSchema,
  runDashboard,
  runReport,
  specSentence,
} from '@12-apps/report-builder';
import { BLANK_BLOCK_TEMPLATE, blockTemplateGroups } from '@12-apps/report-builder/server';
import { describe, expect, it } from 'vitest';

/**
 * The server half of what the frontend harness shows in a browser.
 *
 * Everything under test is the PUBLISHED package: the catalog builder, the
 * in-memory adapter the package itself ships, the run pipeline and the spec
 * sentence all come from the installed tarball, not from `packages/`. A host
 * integrating report-builder writes exactly this — a catalog, an adapter, a
 * spec — so a break in that three-part contract fails here rather than in a
 * consumer's e2e suite.
 */
const catalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        id: { label: 'Pedido', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        // A closed set, so a filter on it is picked rather than typed.
        method: {
          label: 'Forma de pagamento',
          type: 'string',
          role: 'dimension',
          values: [
            { value: 'PIX', label: 'PIX' },
            { value: 'CARD', label: 'Cartão' },
          ],
        },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

const adapter = createMemoryDataSource({
  orders: [
    { id: 'o1', createdAt: '2026-07-01T10:00:00Z', method: 'PIX', totalCents: 1000 },
    { id: 'o2', createdAt: '2026-07-01T22:30:00Z', method: 'CARD', totalCents: 2000 },
    // 02:00Z is 23:00 the PREVIOUS day in America/Sao_Paulo — the late-night
    // sale that moves between days if buckets are computed in UTC.
    { id: 'o3', createdAt: '2026-07-02T02:00:00Z', method: 'PIX', totalCents: 3000 },
  ],
});

const options = { catalog, adapter, timeZone: 'America/Sao_Paulo' };

describe('the published report-builder runs a spec end to end', () => {
  it('compiles, executes and renders a grouped report', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
      },
      options,
    );

    expect(result.render.kind).toBe('table');
    // PIX 1000 + 3000, CARD 2000 — the adapter aggregates, so this also proves
    // the compiled query reached it with the grouping intact.
    const byMethod = Object.fromEntries(
      result.rows.map((row) => [row.method, row.sum_totalCents]),
    );
    expect(byMethod).toEqual({ PIX: 4000, CARD: 2000 });
  });

  it('buckets dates on the tenant clock, not UTC', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'totalCents' }],
      },
      options,
    );

    // A grained dimension is aliased `<field>_<grain>`, so this also pins the
    // alias the published package emits — a consumer reads rows by that key.
    const byDay = Object.fromEntries(
      result.rows.map((row) => [row.createdAt_day, row.sum_totalCents]),
    );

    // All three sales are 2026-07-01 in São Paulo. Bucketing in UTC would put
    // o3 (02:00Z) on 07-02 and leave this at 3000.
    expect(byDay).toEqual({ '2026-07-01': 6000 });
  });
});

describe('the block templates the picker offers', () => {
  /**
   * The templates are the HOST's now, so what is under test is the composition
   * rather than a shipped list. This used to call `blockTemplateGroups()` with
   * no arguments and assert "more than four runnable templates" — the four
   * being future-pay's, compiled against future-pay's catalog, both of which
   * the package shipped. A consumer with its own catalog inherited a picker of
   * blocks it could not run.
   */
  it('keeps a host group whose templates compile against the host catalog', () => {
    const groups = blockTemplateGroups([
      {
        id: 'vendas',
        title: 'Vendas',
        templates: [
          {
            id: 'receita-por-dia',
            title: 'Receita por dia',
            description: 'Quanto a loja faturou a cada dia do período',
            spec: reportSpecSchema.parse({
              entity: 'orders',
              dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
              measures: [{ field: 'totalCents' }],
              presentation: { kind: 'chart', chartType: 'line' },
            }),
          },
        ],
      },
    ]);

    const runnable = groups.flatMap((group) => group.templates).filter((one) => one.spec !== null);
    expect(runnable).toHaveLength(1);
    for (const template of runnable) {
      expect(() => compileReport(template.spec, catalog)).not.toThrow();
    }
  });

  it('always offers the blank escape hatch, last, even with no host groups', () => {
    const last = blockTemplateGroups([]).at(-1);
    expect(last?.templates).toEqual([BLANK_BLOCK_TEMPLATE]);
    expect(BLANK_BLOCK_TEMPLATE.spec).toBeNull();
  });
});

describe('the spec sentence', () => {
  it('describes a spec in Portuguese, from the spec alone', () => {
    expect(
      specSentence(
        {
          version: 1,
          entity: 'orders',
          dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
          measures: [{ field: 'totalCents' }],
          filters: [{ field: 'method', operator: 'eq', value: 'PIX' }],
          sort: [],
          presentation: { kind: 'table' },
        },
        catalog,
      ),
    ).toBe(
      'soma de receita em pedidos por data (dia), onde forma de pagamento é PIX',
    );
  });

  it('names an untitled block after its spec', () => {
    expect(
      autoTitle(
        {
          version: 1,
          entity: 'orders',
          dimensions: [],
          measures: [{ field: 'totalCents' }],
          filters: [],
          sort: [],
          presentation: { kind: 'kpi' },
        },
        catalog,
      ),
    ).toBe('Soma de receita em pedidos');
  });
});

describe('top-N folds the remainder rather than dropping it', () => {
  it('returns the leaders plus "Outros", and the total still balances', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        sort: [{ by: 'sum_totalCents', direction: 'desc' }],
        limit: 1,
      },
      options,
    );

    // PIX 4000 leads; CARD 2000 folds into the bucket.
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]?.method).toBe('Outros');

    const shown = result.rows.reduce((total, row) => total + Number(row.sum_totalCents), 0);
    expect(shown).toBe(6000);
  });

  it('leaves a spec with no limit untouched', async () => {
    // The host row cap is a safety bound, not a top-N — folding its remainder
    // would claim a total the report never computed.
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
      },
      options,
    );

    expect(result.rows.map((row) => row.method)).not.toContain('Outros');
  });
});

describe('the chart spec the published package emits', () => {
  it('carries no axis title and never smooths the line', async () => {
    const result = await runReport(
      {
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'totalCents' }],
        presentation: { kind: 'chart', chartType: 'line' },
      },
      options,
    );

    if (result.render.kind !== 'chart') throw new Error('expected a chart render');

    // The title rendered on top of the tick labels; the spec sentence says
    // what the axis is instead.
    expect(result.render.chartSpec.xAxis.label).toBeUndefined();
    // A curve between two points draws through values nobody measured.
    expect(result.render.chartSpec.curved).toBe(false);
    // The SERIES keeps its name — a legend of unnamed series is unreadable.
    expect(result.render.chartSpec.series[0]?.label).toBe('Receita');
  });

});

describe('the catalog tells a builder how a field may be filtered', () => {
  it('ships labelled values and resolved operators to the client', () => {
    const fields = listCatalogFields(catalog).entities[0]?.fields ?? [];
    const method = fields.find((entry) => entry.field === 'method');
    const total = fields.find((entry) => entry.field === 'totalCents');

    // A closed set is PICKED: the builder shows "Cartão", the spec stores CARD.
    expect(method?.values).toEqual([
      { value: 'PIX', label: 'PIX' },
      { value: 'CARD', label: 'Cartão' },
    ]);
    // Ordering enum codes is meaningless, so no gte/lte on a closed set.
    expect(method?.ops).toEqual(['eq', 'neq', 'in']);

    // Resolved for EVERY field, not only the ones that declare it — that is
    // what stops a client keeping its own copy of the defaults and drifting.
    expect(total?.values).toBeUndefined();
    expect(total?.ops).toEqual(['eq', 'neq', 'gte', 'lte', 'between']);
  });

  it('picks a legal first value for a closed set, and blank for a typed field', () => {
    const method = catalog.entities.orders.fields.method;
    const total = catalog.entities.orders.fields.totalCents;

    expect(isClosedSet(method)).toBe(true);
    expect(defaultValueFor(method)).toBe('PIX');
    expect(operatorsFor(method)).toEqual(['eq', 'neq', 'in']);

    expect(isClosedSet(total)).toBe(false);
    expect(defaultValueFor(total)).toBe('');
  });

  it('runs a spec built from a picked value', async () => {
    // The end the picker exists for: the value came off the catalog, so it
    // cannot be a typo, and the block is not silently empty.
    const result = await runReport(
      {
        entity: 'orders',
        measures: [{ field: 'totalCents' }],
        filters: [
          { field: 'method', operator: 'eq', value: defaultValueFor(catalog.entities.orders.fields.method) },
        ],
      },
      options,
    );

    expect(result.rows[0]?.sum_totalCents).toBe(4000);
  });
});

describe('a dashboard isolates its blocks and describes every one', () => {
  it('renders the good blocks and reports the bad one inline', async () => {
    const result = await runDashboard(
      {
        kind: 'dashboard',
        blocks: [
          {
            id: 'revenue',
            span: 6,
            spec: {
              entity: 'orders',
              dimensions: [{ field: 'method' }],
              measures: [{ field: 'totalCents' }],
            },
          },
          {
            id: 'broken',
            span: 6,
            // A field the catalog does not carry — the drift a stored
            // dashboard suffers when a host renames one.
            spec: { entity: 'orders', measures: [{ field: 'ghostField' }] },
          },
        ],
      },
      options,
    );

    const [revenue, broken] = result.blocks;

    expect(revenue.status).toBe('ok');
    expect(broken.status).toBe('error');
    // One bad block must not take the dashboard down with it.
    expect(revenue.status === 'ok' && revenue.rows.length).toBe(2);

    // Every block carries its sentence — INCLUDING the failed one, which is
    // exactly when a reader needs to know what it was asking for.
    expect(revenue.sentence).toBe(
      'soma de receita em pedidos por forma de pagamento',
    );
    expect(broken.sentence).toBe('contagem de ghostfield em pedidos');
  });
});

/**
 * FUT-391 unsaved-changes: the comparison half, from the PUBLISHED core.
 *
 * The browser harness proves ⌘S and the beforeunload guard are wired. This
 * proves the rule they are built on survives publication — and it belongs here
 * rather than only in the browser because `isDirty` is pure structural
 * equality, reachable by a host validating a draft server-side.
 */
describe('a draft knows whether it has unsaved changes', () => {
  const saved = {
    name: 'Vendas',
    blocks: [
      { id: 'b1', span: 6, spec: { entity: 'orders', measures: [{ field: 'totalCents' }] } },
      { id: 'b2', span: 6, spec: { entity: 'payments', measures: [{ field: 'amountCents' }] } },
    ],
  };

  it('is clean after a rebuild that changed nothing', () => {
    // Every setter produces a new object with the same content — the case a
    // setDirty(true)-per-edit implementation gets wrong.
    expect(isDirty(saved, JSON.parse(JSON.stringify(saved)))).toBe(false);
  });

  it('is clean when a block is dropped back where it started', () => {
    expect(isDirty(saved, { ...saved, blocks: [saved.blocks[0], saved.blocks[1]] })).toBe(false);
  });

  it('is clean when the keys arrive in a different order', () => {
    // The trap JSON.stringify comparison falls into.
    expect(isDirty(saved, { blocks: saved.blocks, name: saved.name })).toBe(false);
  });

  it('is dirty when a block genuinely moves', () => {
    expect(isDirty(saved, { ...saved, blocks: [saved.blocks[1], saved.blocks[0]] })).toBe(true);
  });

  it('is dirty when a nested spec changes', () => {
    const edited = JSON.parse(JSON.stringify(saved));
    edited.blocks[0].spec.measures[0].field = 'itemCount';
    expect(isDirty(saved, edited)).toBe(true);
  });
});
