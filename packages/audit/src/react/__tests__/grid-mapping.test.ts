/**
 * The two mappings between the grid's query and the endpoint's filters, and the
 * export's page walk.
 *
 * These are the joints where the trail meets the shared grid, and they are the
 * kind of code a rendering test covers only by accident: a case that clicks a
 * pill proves ONE key crosses, and the failure mode here is a key that quietly
 * stops crossing — a filter the operator sets and the database never hears
 * about. So each direction is asserted as a whole, including the properties
 * that have no visible symptom: an absent key rather than a present-and-
 * undefined one (they serialize identically and are different cache keys), and
 * the default sort staying out of the request.
 */
import { describe, expect, it } from 'vitest';

import type { AuditLogFilters, AuditLogPageWire, AuditLogWire } from '../../core/types';
import type { AuditApiClient } from '../api';
import { collectAuditEntries } from '../export';
import {
  AUDIT_FIELD,
  AUDIT_RANGE_PERIOD,
  AUDIT_SORT_COLUMN,
  filtersFromQuery,
  stateFromFilters,
} from '../grid-config';
import { formatDiff } from '../grid-rows';

/** A grid query with everything at its default. */
const emptyQuery = () => ({
  search: '',
  pills: {} as Record<string, string[]>,
  ranges: {} as Record<string, { min?: number | string; max?: number | string }>,
  sortBy: [] as { id: string; dir: 'asc' | 'desc' | null }[],
  page: 1,
  pageSize: 20,
});

describe('the grid query, as the endpoint filters', () => {
  it('carries every filter the bar can set', () => {
    const filters = filtersFromQuery({
      ...emptyQuery(),
      search: 'order-1',
      pills: {
        [AUDIT_FIELD.action]: ['payment.over'],
        [AUDIT_FIELD.resource]: ['order', 'comanda'],
        [AUDIT_FIELD.actor]: ['u-1'],
      },
      ranges: { [AUDIT_RANGE_PERIOD]: { min: '2026-07-01', max: '2026-07-31' } },
      sortBy: [{ id: AUDIT_SORT_COLUMN, dir: 'asc' }],
      page: 3,
    });

    expect(filters).toEqual({
      q: 'order-1',
      actionIn: ['payment.over'],
      resourceTypeIn: ['order', 'comanda'],
      actorUserId: 'u-1',
      from: '2026-07-01',
      to: '2026-07-31',
      sort: 'createdAt:asc',
      page: 3,
    });
  });

  it('OMITS what is not set, rather than sending it as undefined', () => {
    // `{ from: undefined }` and `{}` serialize identically and are different
    // cache keys to the screen's `JSON.stringify` dependency — so the empty
    // query has to produce the empty object, not an object of holes.
    expect(filtersFromQuery(emptyQuery())).toEqual({});
    expect(Object.keys(filtersFromQuery(emptyQuery()))).toHaveLength(0);
  });

  it('leaves the default order out of the request', () => {
    // `?sort=createdAt:desc` would be a parameter that says what the absence of
    // one already says.
    const descending = filtersFromQuery({
      ...emptyQuery(),
      sortBy: [{ id: AUDIT_SORT_COLUMN, dir: 'desc' }],
    });

    expect(descending).not.toHaveProperty('sort');
  });

  it('narrows a multi-actor selection to one, because the endpoint matches one', () => {
    // The pill is a multiselect like its neighbours; the endpoint takes a single
    // actor. Answering with one of the chosen is closer to the ask than
    // dropping the filter and answering with everybody.
    const filters = filtersFromQuery({
      ...emptyQuery(),
      pills: { [AUDIT_FIELD.actor]: ['u-1', 'u-2'] },
    });

    expect(filters.actorUserId).toBe('u-1');
  });

  it('drops a half-open period bound rather than sending an empty one', () => {
    const filters = filtersFromQuery({
      ...emptyQuery(),
      ranges: { [AUDIT_RANGE_PERIOD]: { min: '2026-07-01' } },
    });

    expect(filters).toEqual({ from: '2026-07-01' });
  });
});

describe('the endpoint filters, as the grid seed state', () => {
  it('round-trips a full filter set', () => {
    // The seed state is what a bookmarked URL puts back on the controls, so the
    // two mappings have to be each other's inverse — a filter the URL carries
    // and the bar cannot show is a filter the operator cannot see or clear.
    const filters: AuditLogFilters = {
      q: 'order-1',
      actionIn: ['payment.over'],
      resourceTypeIn: ['order'],
      actorUserId: 'u-1',
      from: '2026-07-01',
      to: '2026-07-31',
      sort: 'createdAt:asc',
      page: 4,
    };

    const state = stateFromFilters(filters);
    expect(state.search).toBe('order-1');
    expect(state.pills).toEqual({
      [AUDIT_FIELD.action]: ['payment.over'],
      [AUDIT_FIELD.resource]: ['order'],
      [AUDIT_FIELD.actor]: ['u-1'],
    });
    expect(state.ranges).toEqual({
      [AUDIT_RANGE_PERIOD]: { min: '2026-07-01', max: '2026-07-31' },
    });

    // The page is the grid's own, not part of the seeded controls.
    expect(filtersFromQuery({ ...emptyQuery(), ...state, page: 4, pageSize: 20 })).toEqual(
      filters,
    );
  });

  it('seeds the default order for a filter set that names none', () => {
    expect(stateFromFilters({}).sortBy).toEqual([{ id: AUDIT_SORT_COLUMN, dir: 'desc' }]);
    expect(stateFromFilters({})).toMatchObject({ search: '', pills: {}, ranges: {} });
  });
});

const wire = (id: string): AuditLogWire => ({
  id,
  createdAt: '2026-08-01T15:04:00.000Z',
  actorUserId: null,
  actorName: null,
  actorRole: null,
  scope: null,
  onBehalfOfUserId: null,
  onBehalfOfName: null,
  action: 'payment.over',
  resourceType: 'order',
  resourceId: `o-${id}`,
  before: {},
  after: {},
  requestId: null,
});

/** An api client answering `pages` in order, recording what it was asked. */
function fakeApi(pages: AuditLogPageWire[]): {
  api: AuditApiClient;
  asked: AuditLogFilters[];
} {
  const asked: AuditLogFilters[] = [];
  const api: AuditApiClient = {
    listEntries(filters) {
      asked.push(filters);
      return Promise.resolve(pages[asked.length - 1] ?? pages[pages.length - 1]!);
    },
    listActors: () => Promise.resolve([]),
  };
  return { api, asked };
}

const page = (
  ids: string[],
  meta: { page: number; hasNextPage: boolean },
): AuditLogPageWire => ({
  data: ids.map(wire),
  pagination: {
    total: 999,
    page: meta.page,
    pageSize: 2,
    pageCount: 9,
    hasNextPage: meta.hasNextPage,
  },
});

describe('the export walk', () => {
  it('follows the filter, not the page the operator is looking at', async () => {
    const filtered = fakeApi([page(['a'], { page: 1, hasNextPage: false })]);

    await collectAuditEntries(
      filtered.api,
      { q: 'order-1', page: 7, pageSize: 20 },
      { pageSize: 100, maxRows: 5_000 },
    );

    // The caller's paging is dropped: the request is "everything this filter
    // selects", and forwarding page 7 is the exported-what-was-on-screen bug
    // wearing a different hat.
    expect(filtered.asked).toEqual([{ q: 'order-1', page: 1, pageSize: 100 }]);
  });

  it('walks until the server says there is no next page', async () => {
    const walk = fakeApi([
      page(['a', 'b'], { page: 1, hasNextPage: true }),
      page(['c'], { page: 2, hasNextPage: false }),
    ]);

    const result = await collectAuditEntries(walk.api, {}, { pageSize: 2, maxRows: 5_000 });

    expect(result.entries.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(result.truncated).toBe(false);
    expect(walk.asked.map((filters) => filters.page)).toEqual([1, 2]);
  });

  it('stops at the ceiling and SAYS so', async () => {
    const capped = fakeApi([
      page(['a', 'b'], { page: 1, hasNextPage: true }),
      page(['c', 'd'], { page: 2, hasNextPage: true }),
    ]);

    const result = await collectAuditEntries(capped.api, {}, { pageSize: 2, maxRows: 3 });

    // A download that quietly stopped at a ceiling is evidence of nothing, and
    // it is produced exactly when somebody is reconstructing what happened.
    expect(result.entries).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('terminates when the server clamps the page it was asked for', async () => {
    // `maxPage` is a real server-side clamp. Without trusting the cursor the
    // RESPONSE moved, a trail past it would re-serve its last page forever.
    const clamped = fakeApi([
      page(['a'], { page: 1, hasNextPage: true }),
      page(['a'], { page: 1, hasNextPage: true }),
    ]);

    const result = await collectAuditEntries(clamped.api, {}, { pageSize: 1, maxRows: 5_000 });

    expect(result.truncated).toBe(true);
    expect(clamped.asked).toHaveLength(2);
  });
});

describe('the diff summary', () => {
  it('writes an added field, a removed one and a changed one', () => {
    expect(
      formatDiff({ total: 100, note: 'x' }, { total: 120, tip: 5 }),
    ).toBe('total: 100 → 120 · note: x · tip: 5');
  });

  it('is empty for a redaction that left nothing', () => {
    expect(formatDiff({}, {})).toBe('');
  });
});
