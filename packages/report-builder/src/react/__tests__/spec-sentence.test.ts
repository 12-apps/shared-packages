import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { describe, expect, it } from 'vitest';

import { defineCatalog, listCatalogFields } from '../../catalog';
import { specSentence } from '../../describe';
import { operatorsFor } from '../../filters';
import { reportSpecSchema } from '../../spec';
import type { FieldCatalog, FieldDef } from '../../types';
import { salesCatalog } from '../../__tests__/fixtures';
import type { ReportEntityFields, ReportSpecWire } from '../custom-reports-api';
import {
  blockAutoTitle,
  blockSentence,
  catalogFromEntities,
  sentenceParts,
} from '../lib/spec-sentence';

/**
 * The client-side catalog adapter, and the thing it exists to prevent.
 *
 * The config panel has to say what a block asks for, live, on every keystroke.
 * That sentence already exists — `specSentence`, in the engine — and the ONLY
 * reason the panel could not call it is that it takes a `FieldCatalog` while
 * the browser holds the wire projection of one. So the risk this file covers is
 * not "does the adapter compile": it is that someone writes a second sentence
 * builder on the client and the two drift apart silently, the panel saying one
 * thing while the card beside it says another.
 *
 * The cases below therefore pin the adapter against the REAL projection — the
 * server's own `listCatalogFields`, through an actual JSON round trip — and pin
 * the sentence against `specSentence` called directly. A drifting copy fails
 * both.
 */

/**
 * Every member of {@link FieldDef} on some field, so the round trip below is a
 * claim about the whole type and not about the four members a toy catalog
 * happens to use.
 */
const FULL_CATALOG: FieldCatalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      description: 'Pedidos pagos e cancelados',
      fields: {
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        status: {
          label: 'Status',
          type: 'string',
          role: 'dimension',
          description: 'Situação do pedido',
          values: [
            { value: 'PAID', label: 'Pago' },
            { value: 'CANCELLED', label: 'Cancelado' },
          ],
          // Narrowed on purpose: `operatorsFor` would otherwise resolve the
          // closed-set default, and then the round trip could not tell a
          // declared `ops` from a derived one.
          ops: ['eq'],
        },
        waiter: {
          label: 'Garçom',
          type: 'string',
          role: 'dimension',
          minGroupSample: 20,
        },
        totalCents: {
          label: 'Receita',
          type: 'money',
          role: 'measure',
          aggregations: ['sum', 'avg'],
          format: 'brl',
        },
        prepSeconds: {
          label: 'Tempo de preparo',
          type: 'number',
          role: 'measure',
          format: 'duration',
          identityMinSample: 30,
        },
      },
    },
  },
});

/**
 * The catalog as the browser actually receives it: projected by the server and
 * put through JSON, which is what widens every union to `string` and drops the
 * `undefined`s. Modelling the hop rather than hand-writing the wire shape is
 * the point — a wire type that stopped carrying a member would show up here.
 */
function wireEntities(catalog: FieldCatalog): ReportEntityFields[] {
  const listing = listCatalogFields(catalog);
  return (JSON.parse(JSON.stringify(listing)) as { entities: ReportEntityFields[] }).entities;
}

/** The source catalog plus the `ops` the server resolves for every field. */
function withResolvedOps(catalog: FieldCatalog): FieldCatalog {
  return {
    entities: Object.fromEntries(
      Object.entries(catalog.entities).map(([entity, def]) => [
        entity,
        {
          ...def,
          fields: Object.fromEntries(
            Object.entries(def.fields).map(([name, field]): [string, FieldDef] => [
              name,
              { ...field, ops: operatorsFor(field) },
            ]),
          ),
        },
      ]),
    ),
  };
}

describe('catalogFromEntities', () => {
  it('is the inverse of the server’s own field listing', () => {
    // The whole claim in one assertion: what comes back is what went out,
    // plus the operator set `listCatalogFields` resolves on the way. Add a
    // member to `FieldDef` and stop carrying it, and this fails.
    expect(catalogFromEntities(wireEntities(FULL_CATALOG))).toEqual(
      withResolvedOps(FULL_CATALOG),
    );
  });

  it('re-keys entities and fields by id, which is how a spec names them', () => {
    const rebuilt = catalogFromEntities(wireEntities(FULL_CATALOG));

    // The wire sends arrays; a catalog is keyed. That re-keying IS the
    // conversion, so it is asserted on its own rather than only inside the
    // deep-equality case above.
    expect(Object.keys(rebuilt.entities)).toEqual(['orders']);
    expect(Object.keys(rebuilt.entities.orders?.fields ?? {})).toEqual([
      'createdAt',
      'status',
      'waiter',
      'totalCents',
      'prepSeconds',
    ]);
  });

  it('keeps the members the sentence reads: entity label, field label and type', () => {
    const rebuilt = catalogFromEntities(wireEntities(FULL_CATALOG));

    expect(rebuilt.entities.orders?.label).toBe('Pedidos');
    expect(rebuilt.entities.orders?.fields.totalCents?.label).toBe('Receita');
    // The type is what defaults a measure with no aggregation to `soma` rather
    // than to `contagem`, so losing it changes the sentence's first two words.
    expect(rebuilt.entities.orders?.fields.totalCents?.type).toBe('money');
  });

  it('keeps the members the sentence does NOT read, so the catalog stays reusable', () => {
    const fields = catalogFromEntities(wireEntities(FULL_CATALOG)).entities.orders?.fields;

    expect(fields?.totalCents?.aggregations).toEqual(['sum', 'avg']);
    expect(fields?.totalCents?.format).toBe('brl');
    expect(fields?.status?.description).toBe('Situação do pedido');
    expect(fields?.status?.values).toEqual([
      { value: 'PAID', label: 'Pago' },
      { value: 'CANCELLED', label: 'Cancelado' },
    ]);
    expect(fields?.status?.ops).toEqual(['eq']);
    expect(fields?.waiter?.minGroupSample).toBe(20);
    expect(fields?.prepSeconds?.identityMinSample).toBe(30);
  });

  it('answers with an empty catalog for an empty listing', () => {
    // The catalog the panel holds before `GET /reports/fields` resolves. The
    // sentence falls back to raw ids rather than throwing, which is
    // `specSentence`'s documented display behaviour.
    expect(catalogFromEntities([])).toEqual({ entities: {} });
  });
});

const SPEC: ReportSpecWire = {
  entity: 'orders',
  dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
  measures: [{ field: 'totalCents', aggregation: 'sum' }],
  // `method` is a real field of `salesCatalog`, so the clause reads with the
  // catalog's own label. The VALUE stays verbatim — `describe.ts` says why: the
  // catalog carries no enum value labels, so `PIX` cannot become anything else
  // without inventing a mapping the sentence has no business owning.
  filters: [{ field: 'method', operator: 'eq', value: 'PIX' }],
  sort: [],
  presentation: { kind: 'chart', chartType: 'bar' },
};

describe('blockSentence', () => {
  it('says exactly what the engine says for the same spec', () => {
    // The anti-drift case. Not "contains the right words" — the identical
    // string, produced the two ways the two surfaces produce it.
    const wire = wireEntities(salesCatalog);
    const engine = specSentence(reportSpecSchema.parse(SPEC), salesCatalog, PT_BR_REPORT_ENGINE_COPY.spec);

    expect(blockSentence(SPEC, catalogFromEntities(wire), PT_BR_REPORT_ENGINE_COPY.spec)).toBe(engine);
    expect(blockSentence(SPEC, catalogFromEntities(wire), PT_BR_REPORT_ENGINE_COPY.spec)).toBe(
      'soma de receita em pedidos por data (dia), onde forma de pagamento é PIX',
    );
  });

  it('tracks an edit to the spec', () => {
    const catalog = catalogFromEntities(wireEntities(salesCatalog));
    const before = blockSentence(SPEC, catalog, PT_BR_REPORT_ENGINE_COPY.spec);
    const after = blockSentence(
      { ...SPEC, measures: [{ field: 'totalCents', aggregation: 'avg' }] },
      catalog,
    PT_BR_REPORT_ENGINE_COPY.spec,
);

    expect(before).toBe(
      'soma de receita em pedidos por data (dia), onde forma de pagamento é PIX',
    );
    expect(after).toBe(
      'média de receita em pedidos por data (dia), onde forma de pagamento é PIX',
    );
  });

  it('describes a spec that is still being written rather than throwing', () => {
    // `reportSpecSchema` rejects a measure-less spec, and the builder produces
    // one every time an author opens a blank measure row. The sentence is
    // watched at exactly those moments, so it must survive them.
    const halfWritten: ReportSpecWire = { ...SPEC, measures: [], filters: [] };

    expect(() =>
      blockSentence(halfWritten, catalogFromEntities(wireEntities(salesCatalog)), PT_BR_REPORT_ENGINE_COPY.spec),
    ).not.toThrow();
  });

  it('falls back to raw ids for a field the catalog no longer carries', () => {
    // A saved block whose field was withdrawn from the catalog. Showing the id
    // is how a reader finds out what the block was asking for.
    const orphan: ReportSpecWire = {
      entity: 'ghosts',
      dimensions: [],
      measures: [{ field: 'whatever' }],
      filters: [],
      sort: [],
      presentation: { kind: 'table' },
    };

    expect(blockSentence(orphan, catalogFromEntities(wireEntities(salesCatalog)), PT_BR_REPORT_ENGINE_COPY.spec)).toBe(
      'contagem de whatever em ghosts',
    );
  });
});

describe('blockAutoTitle', () => {
  it('is the sentence, capitalised', () => {
    const catalog = catalogFromEntities(wireEntities(salesCatalog));

    expect(blockAutoTitle(SPEC, catalog, PT_BR_REPORT_ENGINE_COPY.spec)).toBe(
      'Soma de receita em pedidos por data (dia), onde forma de pagamento é PIX',
    );
  });
});

describe('sentenceParts', () => {
  const catalog = catalogFromEntities(wireEntities(salesCatalog));

  /** Every case's real input: the string the engine actually produced. */
  const TOP_N: ReportSpecWire = {
    entity: 'orders',
    dimensions: [{ field: 'product' }],
    measures: [{ field: 'totalCents' }],
    filters: [],
    sort: [],
    limit: 6,
    presentation: { kind: 'chart', chartType: 'bar' },
  };

  it('loses and invents nothing — the parts are the sentence', () => {
    // The invariant that makes this a presentation pass rather than a second
    // sentence builder. Anything else it gets wrong costs a bold run; break
    // this and it is rewriting the text.
    const sentence = blockSentence(SPEC, catalog, PT_BR_REPORT_ENGINE_COPY.spec);

    expect(sentenceParts(sentence, PT_BR_REPORT_ENGINE_COPY.spec).map((part) => part.text).join('')).toBe(sentence);
  });

  it('emphasises the author’s terms and not the words joining them', () => {
    const parts = sentenceParts(blockSentence(SPEC, catalog, PT_BR_REPORT_ENGINE_COPY.spec), PT_BR_REPORT_ENGINE_COPY.spec);

    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'soma de receita',
      'pedidos',
      'data (dia)',
      'forma de pagamento é PIX',
    ]);
    expect(parts.filter((part) => !part.strong).map((part) => part.text)).toEqual([
      ' em ',
      ' por ',
      ', onde ',
    ]);
  });

  it('emphasises the top-N count, which is a choice the author made', () => {
    const parts = sentenceParts(blockSentence(TOP_N, catalog, PT_BR_REPORT_ENGINE_COPY.spec), PT_BR_REPORT_ENGINE_COPY.spec);

    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'soma de receita',
      'pedidos',
      'produto',
      '6',
    ]);
  });

  it('separates the split clause, whose wording `describe.ts` owns', () => {
    // `, separado por ` was `, dividido por ` until FUT-755. Both are listed as
    // connectives, so the clause stays separated either way — and this case is
    // what tells us if a third wording arrives and the emphasis stops.
    const split: ReportSpecWire = {
      ...SPEC,
      dimensions: [{ field: 'createdAt', timeGrain: 'day' }, { field: 'method' }],
      filters: [],
    };
    const parts = sentenceParts(blockSentence(split, catalog, PT_BR_REPORT_ENGINE_COPY.spec), PT_BR_REPORT_ENGINE_COPY.spec);

    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'soma de receita',
      'pedidos',
      'data (dia)',
      'forma de pagamento',
    ]);
  });

  it('splits a serial list so each clause carries its own emphasis', () => {
    const twoFilters: ReportSpecWire = {
      ...SPEC,
      filters: [
        { field: 'method', operator: 'eq', value: 'PIX' },
        { field: 'product', operator: 'eq', value: 'Café' },
      ],
    };
    const parts = sentenceParts(blockSentence(twoFilters, catalog, PT_BR_REPORT_ENGINE_COPY.spec), PT_BR_REPORT_ENGINE_COPY.spec);

    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'soma de receita',
      'pedidos',
      'data (dia)',
      'forma de pagamento é PIX',
      'produto é Café',
    ]);
  });

  it('emphasises nothing in an empty sentence', () => {
    expect(sentenceParts('', PT_BR_REPORT_ENGINE_COPY.spec)).toEqual([]);
  });
});
