/**
 * The export's rows: the whole FILTERED set, walked page by page.
 *
 * Exporting what is on screen is the single most common bug in an admin table —
 * the operator filters 214 entries, sees 20, exports, and gets 20 with nothing
 * anywhere saying so. On an audit trail it is worse than misleading: a download
 * that silently answered a different question than the filter did is evidence
 * of nothing, and it is produced precisely when somebody is reconstructing what
 * happened.
 *
 * So this re-queries. The grid's export control hands over the live query
 * unpaginated (`@12-apps/ui`'s own division: the component emits, the host
 * fetches), and the walk below turns it into rows at the endpoint's own maximum
 * page size.
 *
 * It is BOUNDED, and the bound is config rather than a constant. The listing
 * clamps `pageSize` (100 by default) and `page` (10 000), so "all of it" is
 * already a bounded quantity server-side; what this adds is a ceiling a browser
 * can hold and a host can state. A walk that hit the ceiling stops there — the
 * caller is told how many rows it got, and `truncated` is what the surface
 * needs to say so rather than imply completeness.
 */
import type { AuditLogFilters, AuditLogWire } from '../core/types';

import type { AuditApiClient } from './api';

export interface AuditExportLimits {
  /** Rows per request. Clamped by the endpoint's own `maxPageSize`. */
  pageSize: number;
  /** The most rows one export may collect. */
  maxRows: number;
}

/** One deployment's numbers, as the defaults. */
export const DEFAULT_EXPORT_LIMITS: AuditExportLimits = { pageSize: 100, maxRows: 5_000 };

export interface AuditExportResult {
  entries: AuditLogWire[];
  /** True when the walk stopped at {@link AuditExportLimits.maxRows}. */
  truncated: boolean;
}

/**
 * Walk the filtered trail into one list.
 *
 * `page` and `pageSize` from the caller's filters are DROPPED rather than
 * honoured: the request is "everything this filter selects", and forwarding the
 * page the operator happens to be on is the bug at the top of this file wearing
 * a different hat.
 */
export async function collectAuditEntries(
  api: AuditApiClient,
  filters: AuditLogFilters,
  limits: AuditExportLimits = DEFAULT_EXPORT_LIMITS,
): Promise<AuditExportResult> {
  // The selection ALONE: `page`/`pageSize` are stripped by rebuilding the
  // object rather than by destructuring them into unused bindings, so nothing
  // here reads as a value somebody forgot to use.
  const selection: AuditLogFilters = { ...filters };
  delete selection.page;
  delete selection.pageSize;
  const entries: AuditLogWire[] = [];
  let page = 1;
  for (;;) {
    const body = await api.listEntries({ ...selection, page, pageSize: limits.pageSize });
    entries.push(...body.data);
    if (entries.length >= limits.maxRows) {
      return { entries: entries.slice(0, limits.maxRows), truncated: true };
    }
    if (!body.pagination.hasNextPage) return { entries, truncated: false };
    // The server clamps `page`, so a trail longer than `maxPage × pageSize`
    // would otherwise re-serve its last page forever. Trusting the cursor the
    // response itself moved is what makes the loop terminate on the server's
    // terms rather than on an assumption about its limits.
    if (body.pagination.page !== page) return { entries, truncated: true };
    page += 1;
  }
}
