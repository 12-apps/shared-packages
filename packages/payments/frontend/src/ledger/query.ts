/**
 * The URL a ledger page is bookmarkable at, and the request it becomes.
 *
 * A server-driven list keeps its search, its sort and its page in the address
 * bar so a link an operator sends to a colleague opens the same rows. Both
 * ledgers do it identically, and both got the same two things subtly wrong
 * when written twice:
 *
 * - a facet value from a stale bookmark forwarded straight into a 400, which
 *   replaces the WHOLE page — grid, selector and all — with an error whose only
 *   affordance re-requests the same bad URL;
 * - the default facet included in the query, so the react-query key differed
 *   between an operator who arrived with `?view=all` and one who arrived with
 *   nothing, and the identical list was fetched twice and cached apart.
 */

/** The params a ledger grid owns and forwards verbatim. */
const OWNED = ['q', 'page', 'sort'] as const;

/** A sort as the wire spells it, or nothing when the URL carries none. */
export interface LedgerSort {
  id: string;
  dir: 'asc' | 'desc';
}

/**
 * The query string for the current URL.
 *
 * `facet` is passed already SANITIZED — a caller resolves an unknown value to
 * its default first — and omitted when it IS the default, so the request and
 * the cache key are identical however the operator arrived.
 */
export function ledgerSearch(
  params: URLSearchParams,
  facet?: { key: string; value: string; fallback: string },
): string {
  const query = new URLSearchParams();
  for (const key of OWNED) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  if (facet && facet.value !== facet.fallback) query.set(facet.key, facet.value);
  return query.toString();
}

/** The sort the URL is carrying, if it is carrying a well-formed one. */
export function ledgerSort(params: URLSearchParams): LedgerSort[] {
  const [id, dir] = (params.get('sort') ?? '').split(':');
  if (!id || !dir) return [];
  return [{ id, dir: dir === 'desc' ? 'desc' : 'asc' }];
}

/** The search term the URL is carrying. */
export function ledgerSearchTerm(params: URLSearchParams): string {
  return params.get('q') ?? '';
}

/**
 * A grid query mapped back onto the params a ledger URL owns.
 *
 * `dir` accepts `null` as well as absent, because that is what a real grid
 * produces: a column can be in the sort list with no direction chosen yet, and
 * a data-grid library spells that `null` rather than by leaving the key out.
 * The runtime always treated the two the same — an unsorted column contributes
 * no `sort` param — so this is the TYPE catching up with the behaviour rather
 * than a change to it. Typed the other way, every adopter writes the same
 * `?? undefined` mapping at the call site, which is exactly the boilerplate
 * this module exists to delete.
 */
export function ledgerParams(query: {
  search: string;
  page: number;
  sortBy: readonly { id: string; dir?: 'asc' | 'desc' | null }[];
}): Record<string, string | undefined> {
  const sort = query.sortBy[0];
  return {
    q: query.search || undefined,
    page: query.page > 1 ? String(query.page) : undefined,
    sort: sort?.dir ? `${sort.id}:${sort.dir}` : undefined,
  };
}
