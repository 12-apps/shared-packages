import { describe, expect, it } from 'vitest';

import { ledgerParams, ledgerSearch, ledgerSearchTerm, ledgerSort } from '../query';

/**
 * The URL a ledger page is bookmarkable at.
 *
 * Both failures pinned here are ones a second hand-written copy reproduced:
 * a stale facet forwarded into a 400 that replaces the whole page, and a
 * default facet in the query that splits one list across two cache keys.
 */

const params = (search: string) => new URLSearchParams(search);

describe('the query a ledger URL becomes', () => {
  it('forwards only the params the grid owns', () => {
    const out = ledgerSearch(params('q=ord_1&page=3&sort=createdAt:desc&rogue=1'));
    expect(out).toBe('q=ord_1&page=3&sort=createdAt%3Adesc');
  });

  it('drops empty params rather than sending them blank', () => {
    expect(ledgerSearch(params('q=&page='))).toBe('');
  });

  /**
   * Identical request, identical cache key, whether the operator arrived with
   * the default facet spelled out or with nothing at all.
   */
  it('omits the facet when it is the default', () => {
    const out = ledgerSearch(params(''), { key: 'view', value: 'all', fallback: 'all' });
    expect(out).toBe('');
  });

  it('sends the facet when it is not', () => {
    const out = ledgerSearch(params(''), { key: 'view', value: 'short', fallback: 'all' });
    expect(out).toBe('view=short');
  });
});

describe('the sort the URL is carrying', () => {
  it('reads a well-formed one', () => {
    expect(ledgerSort(params('sort=createdAt:desc'))).toEqual([{ id: 'createdAt', dir: 'desc' }]);
  });

  it('defaults an unknown direction to ascending rather than passing it on', () => {
    expect(ledgerSort(params('sort=createdAt:sideways'))).toEqual([
      { id: 'createdAt', dir: 'asc' },
    ]);
  });

  it('is empty for a half-written sort, so the grid seeds unsorted', () => {
    expect(ledgerSort(params('sort=createdAt'))).toEqual([]);
    expect(ledgerSort(params(''))).toEqual([]);
  });

  it('reads the search term, or an empty string', () => {
    expect(ledgerSearchTerm(params('q=ord_1'))).toBe('ord_1');
    expect(ledgerSearchTerm(params(''))).toBe('');
  });
});

describe('a grid query mapped back onto the URL', () => {
  it('omits page 1, so the first page has no param of its own', () => {
    expect(ledgerParams({ search: '', page: 1, sortBy: [] })).toEqual({
      q: undefined,
      page: undefined,
      sort: undefined,
    });
  });

  it('carries a real page, search and sort', () => {
    expect(ledgerParams({ search: 'ord_1', page: 2, sortBy: [{ id: 'createdAt', dir: 'asc' }] })).toEqual({
      q: 'ord_1',
      page: '2',
      sort: 'createdAt:asc',
    });
  });

  it('omits a sort with no direction, which the wire cannot express', () => {
    expect(ledgerParams({ search: '', page: 1, sortBy: [{ id: 'createdAt' }] }).sort).toBeUndefined();
  });

  /**
   * What a real grid actually produces for a column that is in the sort list
   * with no direction chosen. Absent and `null` mean the same thing here, and
   * typing only the first made every adopter write `?? undefined` at the call
   * site — the boilerplate this module exists to delete.
   */
  it('treats a null direction exactly as an absent one', () => {
    expect(
      ledgerParams({ search: '', page: 1, sortBy: [{ id: 'createdAt', dir: null }] }).sort,
    ).toBeUndefined();
  });
});
