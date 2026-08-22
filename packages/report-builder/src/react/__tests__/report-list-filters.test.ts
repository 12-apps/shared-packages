import { describe, expect, it } from 'vitest';

import type { SavedReportSummary } from '../custom-reports-api';
import {
  blockCountLabel,
  filterReports,
  relativeReportTime,
  visibilityLabel,
} from '../report-list-filters';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';

/** The card-footer words, from the pack a host would pass. */
const LIST = PT_BR_REPORT_SCREENS_COPY.list;

/**
 * FUT-391: archiving is a SCOPE of the list, not a display toggle floating
 * beside it, and the list is searchable. FUT-755 adds the third scope the
 * prototype has and this could not: `Meus`, which needs the server to say
 * whether the caller wrote a report — see `ownedByMe`.
 */
function report(patch: Partial<SavedReportSummary> & { id: string }): SavedReportSummary {
  return {
    name: 'Relatório',
    description: null,
    type: 'report',
    entity: 'orders',
    entities: ['orders'],
    blockCount: 1,
    status: 'published',
    visibility: 'tenant',
    ownedByMe: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...patch,
  } as SavedReportSummary;
}

function reports() {
  return [
    report({ id: 'a', name: 'Vendas por dia', updatedAt: '2026-03-01T00:00:00Z', ownedByMe: true }),
    report({ id: 'b', name: 'Relatório de cozinha', updatedAt: '2026-05-01T00:00:00Z' }),
    report({ id: 'c', name: 'Antigo', status: 'archived', updatedAt: '2026-02-01T00:00:00Z' }),
    report({
      id: 'd',
      name: 'Vendas 2',
      description: 'Somente PIX',
      updatedAt: '2026-04-01T00:00:00Z',
      ownedByMe: true,
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

  it('shows only what the caller authored in the mine scope', () => {
    const rows = filterReports(reports(), { scope: 'mine', search: '' });
    expect(rows.map((entry) => entry.id)).toEqual(['d', 'a']);
  });

  it('does not resurrect an archived report of yours under mine', () => {
    // `Meus` narrows `Todos`; it is not a third bucket that reaches past the
    // archive, which is how the prototype has it.
    const rows = filterReports([report({ id: 'z', status: 'archived', ownedByMe: true })], {
      scope: 'mine',
      search: '',
    });
    expect(rows).toEqual([]);
  });

  it('combines the mine scope with the search box', () => {
    const rows = filterReports(reports(), { scope: 'mine', search: 'vendas 2' });
    expect(rows.map((entry) => entry.id)).toEqual(['d']);
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

describe('card footer labels', () => {
  it('says bloco for one and blocos for the rest', () => {
    expect(blockCountLabel(1, LIST)).toBe('1 bloco');
    expect(blockCountLabel(2, LIST)).toBe('2 blocos');
    expect(blockCountLabel(0, LIST)).toBe('0 blocos');
  });

  it('names who can read the report', () => {
    expect(visibilityLabel('tenant', LIST)).toBe('Toda a equipe');
    expect(visibilityLabel('private', LIST)).toBe('Só você');
    expect(visibilityLabel('roles', LIST)).toBe('Cargos específicos');
  });
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The instant every relative-time case measures against, built fresh per call
 * rather than shared: a `Date` held across tests is mutable state, and the
 * flakiness gate is right that a suite whose cases can reach the same object
 * has an ordering hazard whether or not today's cases take it.
 */
const NOW_ISO = '2026-08-10T12:00:00.000Z';
const now = (): Date => new Date(NOW_ISO);
/** A timestamp `ms` before {@link NOW_ISO}; a negative reads as the future. */
const ago = (ms: number): string => new Date(Date.parse(NOW_ISO) - ms).toISOString();

/**
 * The relative time gets its own cases because it is exactly the kind of thing
 * that drifts silently: every branch below is one an off-by-one would move,
 * and none of them would fail a test that only checked "renders something".
 */
describe('relativeReportTime', () => {
  it('counts the first hour in minutes', () => {
    expect(relativeReportTime(ago(2 * MINUTE), now(), LIST.relativeTime)).toBe('há 2 min');
    expect(relativeReportTime(ago(59 * MINUTE), now(), LIST.relativeTime)).toBe('há 59 min');
  });

  it('counts the first day in hours, singular at one', () => {
    expect(relativeReportTime(ago(HOUR), now(), LIST.relativeTime)).toBe('há 1 hora');
    expect(relativeReportTime(ago(5 * HOUR), now(), LIST.relativeTime)).toBe('há 5 horas');
  });

  it('names the day before rather than counting it', () => {
    expect(relativeReportTime(ago(DAY), now(), LIST.relativeTime)).toBe('ontem');
    expect(relativeReportTime(ago(DAY + 3 * HOUR), now(), LIST.relativeTime)).toBe('ontem');
  });

  it('counts the rest of the week in days', () => {
    expect(relativeReportTime(ago(3 * DAY), now(), LIST.relativeTime)).toBe('há 3 dias');
    expect(relativeReportTime(ago(6 * DAY), now(), LIST.relativeTime)).toBe('há 6 dias');
  });

  it('switches to weeks at seven days', () => {
    expect(relativeReportTime(ago(7 * DAY), now(), LIST.relativeTime)).toBe('há 1 semana');
    expect(relativeReportTime(ago(21 * DAY), now(), LIST.relativeTime)).toBe('há 3 semanas');
  });

  it('says agora inside the first minute', () => {
    expect(relativeReportTime(ago(20_000), now(), LIST.relativeTime)).toBe('agora');
  });

  it('reads a server clock that runs ahead as now, not as a negative age', () => {
    expect(relativeReportTime(ago(-5 * MINUTE), now(), LIST.relativeTime)).toBe('agora');
  });

  it('says nothing at all for an unparseable timestamp', () => {
    // Inventing "agora" for a broken value would claim a freshness the row
    // does not have.
    expect(relativeReportTime('not a date', now(), LIST.relativeTime)).toBe('');
  });
});
