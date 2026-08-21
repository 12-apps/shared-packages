import { PT_BR_REPORT_ENGINE_COPY } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { autoTitle, specSentence } from '../describe';
import { reportSpecSchema, type ReportSpecInput } from '../spec';
import { salesCatalog } from './fixtures';

/**
 * The spec sentence is read by owners who will never open the config panel, so
 * these cases assert the WHOLE string rather than that it contains a substring
 * — a sentence that reads wrong is a defect even when every clause is present.
 */

function sentence(input: ReportSpecInput): string {
  return specSentence(reportSpecSchema.parse(input), salesCatalog, PT_BR_REPORT_ENGINE_COPY.spec);
}

describe('specSentence', () => {
  it('describes a KPI (no groupBy) without inventing a "por" clause', () => {
    expect(sentence({ entity: 'orders', measures: [{ field: 'totalCents' }] })).toBe(
      'soma de receita em pedidos',
    );
  });

  it('names the time grain when the spec buckets by one', () => {
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
        measures: [{ field: 'totalCents' }],
      }),
    ).toBe('soma de receita em pedidos por data (dia)');
  });

  it('omits the grain on a date dimension that has none', () => {
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'createdAt' }],
        measures: [{ field: 'totalCents' }],
      }),
    ).toBe('soma de receita em pedidos por data');
  });

  it('calls the second dimension a split, in the control’s own words', () => {
    // "Separar em séries" is what the panel's field is called, and one series
    // per value is what the chart now actually draws (FUT-755) — so the
    // sentence under the chart and the field that produced it agree.
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'month' }, { field: 'method' }],
        measures: [{ field: 'totalCents' }],
      }),
    ).toBe(
      'soma de receita em pedidos por data (mês), separado por forma de pagamento',
    );
  });

  it('joins multiple filters with a serial "e"', () => {
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        filters: [
          { field: 'method', operator: 'eq', value: 'PIX' },
          { field: 'itemCount', operator: 'gte', value: 2 },
          { field: 'totalCents', operator: 'between', from: 100, to: 900 },
        ],
      }),
    ).toBe(
      'soma de receita em pedidos por forma de pagamento, onde forma de pagamento é PIX, ' +
        'itens é maior ou igual a 2 e receita está entre 100 e 900',
    );
  });

  it('lists the operands of an "in" filter', () => {
    expect(
      sentence({
        entity: 'orders',
        measures: [{ field: 'totalCents' }],
        filters: [{ field: 'method', operator: 'in', values: ['PIX', 'CARD'] }],
      }),
    ).toBe('soma de receita em pedidos, onde forma de pagamento é um de PIX, CARD');
  });

  it('says top N when the spec caps rows', () => {
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'totalCents' }],
        limit: 5,
      }),
    ).toBe('soma de receita em pedidos por forma de pagamento, top 5');
  });

  it('joins multiple measures', () => {
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [
          { field: 'totalCents' },
          { field: 'itemCount', aggregation: 'avg' },
          { field: 'id', aggregation: 'count_distinct' },
        ],
      }),
    ).toBe(
      'soma de receita, média de itens e contagem distinta de pedido em pedidos ' +
        'por forma de pagamento',
    );
  });

  it('defaults a numeric measure to soma and a non-numeric one to contagem', () => {
    expect(sentence({ entity: 'orders', measures: [{ field: 'totalCents' }] })).toBe(
      'soma de receita em pedidos',
    );
    expect(sentence({ entity: 'orders', measures: [{ field: 'method' }] })).toBe(
      'contagem de forma de pagamento em pedidos',
    );
  });

  it('names the divisor of a ratio', () => {
    expect(
      sentence({
        entity: 'orders',
        measures: [{ field: 'lateItems', aggregation: 'ratio', denominator: 'itemCount' }],
      }),
    ).toBe('proporção de itens atrasados por itens em pedidos');
  });

  it('orders the clauses: measures, entity, groupBy, split, filters, limit', () => {
    expect(
      sentence({
        entity: 'orders',
        dimensions: [{ field: 'createdAt', timeGrain: 'week' }, { field: 'method' }],
        measures: [{ field: 'totalCents' }],
        filters: [{ field: 'method', operator: 'neq', value: 'PIX' }],
        limit: 10,
      }),
    ).toBe(
      'soma de receita em pedidos por data (semana), separado por forma de pagamento, ' +
        'onde forma de pagamento não é PIX, top 10',
    );
  });

  it('falls back to raw ids rather than throwing on a spec the catalog does not carry', () => {
    // A stale block is exactly when a reader most needs to see what it asks
    // for; rejecting it is compileReport's job, not the subtitle's.
    const stale = reportSpecSchema.parse({
      entity: 'orders',
      dimensions: [{ field: 'ghostField' }],
      measures: [{ field: 'goneField' }],
    });
    expect(specSentence(stale, salesCatalog, PT_BR_REPORT_ENGINE_COPY.spec)).toBe(
      'contagem de gonefield em pedidos por ghostfield',
    );
  });

  it('describes an entity the catalog does not carry at all', () => {
    const orphan = reportSpecSchema.parse({
      entity: 'ghosts',
      measures: [{ field: 'whatever' }],
    });
    expect(specSentence(orphan, salesCatalog, PT_BR_REPORT_ENGINE_COPY.spec)).toBe('contagem de whatever em ghosts');
  });
});

describe('autoTitle', () => {
  it('capitalises the sentence so an unnamed block reads as a title', () => {
    expect(
      autoTitle(
        reportSpecSchema.parse({
          entity: 'orders',
          dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
          measures: [{ field: 'totalCents' }],
        }),
        salesCatalog,
      PT_BR_REPORT_ENGINE_COPY.spec,
),
    ).toBe('Soma de receita em pedidos por data (dia)');
  });

  it('tracks the spec, so changing the measure renames the block', () => {
    const before = autoTitle(
      reportSpecSchema.parse({ entity: 'orders', measures: [{ field: 'totalCents' }] }),
      salesCatalog,
    PT_BR_REPORT_ENGINE_COPY.spec,
);
    const after = autoTitle(
      reportSpecSchema.parse({
        entity: 'orders',
        measures: [{ field: 'itemCount', aggregation: 'avg' }],
      }),
      salesCatalog,
    PT_BR_REPORT_ENGINE_COPY.spec,
);
    expect(before).toBe('Soma de receita em pedidos');
    expect(after).toBe('Média de itens em pedidos');
  });
});
