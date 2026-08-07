import { describe, expect, it } from 'vitest';

import type { SavedReportSummary } from '../custom-reports-api';
import { filterReports, scopeCounts } from '../report-list-filters';

/**
 * FUT-391: archiving is a SCOPE of the list, not a display toggle floating
 * beside it, and the list is searchable.
 */
function report(patch: Partial<SavedReportSummary> & { id: string }): SavedReportSummary {
  return {
    name: 'Relatório',
    description: null,
    type: 'report',
    entity: 'orders',
    entities: ['orders'],
    status: 'published',
    visibility: 'tenant',
    updatedAt: '2026-01-01T00:00:00Z',
    ...patch,
  } as SavedReportSummary;
}

function reports() {
  return [
    report({ id: 'a', name: 'Vendas por dia', updatedAt: '2026-03-01T00:00:00Z' }),
    report({ id: 'b', name: 'Relatório de cozinha', updatedAt: '2026-05-01T00:00:00Z' }),
    report({ id: 'c', name: 'Antigo', status: 'archived', updatedAt: '2026-02-01T00:00:00Z' }),
    report({
      id: 'd',
      name: 'Vendas 2',
      description: 'Somente PIX',
      updatedAt: '2026-04-01T00:00:00Z',
    }),
  ];
}

describe('filterReports', () => {
  it('shows the un-archived reports, newest edit first', () => {
    const rows = filterReports(reports(), { scope: 'active', search: '' });
    expect(rows.map((entry) => entry.id)).toEqual(['b', 'd', 'a']);
  });

  it('shows only the archived ones in the archived scope', () => {
    const rows = filterReports(reports(), { scope: 'archived', search: '' });
    expect(rows.map((entry) => entry.id)).toEqual(['c']);
  });

  it('searches names ignoring case and accents', () => {
    // The names are Portuguese: typing "relatorio" must find "Relatório".
    const rows = filterReports(reports(), { scope: 'active', search: 'relatorio' });
    expect(rows.map((entry) => entry.id)).toEqual(['b']);
  });

  it('searches descriptions too', () => {
    // "Vendas" and "Vendas 2" are told apart by their descriptions, so
    // searching names alone would hide the difference.
    const rows = filterReports(reports(), { scope: 'active', search: 'pix' });
    expect(rows.map((entry) => entry.id)).toEqual(['d']);
  });

  it('keeps a deep-linked report even when it fails both filters', () => {
    // The URL is a stronger statement of intent than the filter row: a report
    // reached by link must not vanish for being archived.
    const rows = filterReports(reports(), { scope: 'active', search: 'zzz', keepId: 'c' });
    expect(rows.map((entry) => entry.id)).toEqual(['c']);
  });

  it('returns nothing when the search matches nothing', () => {
    expect(filterReports(reports(), { scope: 'active', search: 'zzz' })).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    // It sorts, and sort is in-place on the receiver.
    const input = reports();
    const order = input.map((entry) => entry.id);
    filterReports(input, { scope: 'active', search: '' });
    expect(input.map((entry) => entry.id)).toEqual(order);
  });
});

describe('scopeCounts', () => {
  it('counts each scope for the pill labels', () => {
    expect(scopeCounts(reports())).toEqual({ active: 3, archived: 1 });
  });

  it('counts an empty list as zeroes rather than omitting a scope', () => {
    expect(scopeCounts([])).toEqual({ active: 0, archived: 0 });
  });
});
