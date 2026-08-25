/**
 * The audit-log viewer — the trail's BODY: the shared filter bar, the grid, the
 * saved-view chrome and the server-mode pager, over one filter set.
 *
 * Server-driven, like the page it came from: every filter, the ordering and the
 * pagination run in the database. What changed in this release is only WHAT
 * renders them — `@12-apps/ui`'s `DataViews` grid, the same one every other
 * list in an adopting host uses, instead of a bar this package drew itself.
 * The reasoning is in `grid-config.tsx`.
 *
 * It still deliberately does NOT read or write the URL, because a package
 * cannot know the host's router. A host that wants bookmarkable filters lifts
 * the state (`filters` / `onFiltersChange`); one that does not gets the same
 * screen holding its own.
 */
import { useCallback, useMemo, useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import type {
  DataViewExport,
  DataViewQuery,
  DataViewServer,
  SavedViewSummary,
} from '@12-apps/ui/data-display/DataViews';

import type {
  AuditActorOptionWire,
  AuditLogFilters,
  AuditLogPageWire,
} from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import type { AuditApiClient } from './api';
import {
  auditColumns,
  auditFields,
  auditRangeFields,
  auditSortFields,
  filtersFromQuery,
  stateFromFilters,
} from './grid-config';
import { toAuditRows } from './grid-rows';
import { StandaloneAuditTable, type AuditTableComponent } from './grid-table';
import { useActorOptions, useAuditPage } from './use-audit-data';
import type { AuditLabels } from './labels';

/** The endpoint's own default, for the frame before the first page lands. */
const FALLBACK_PAGE_SIZE = 20;

export interface AuditViewerProps {
  api: AuditApiClient;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
  /** The reader's tag, for the vocabulary's labels. See `AuditWebConfig.locale`. */
  locale?: string;
  /**
   * The host's wired `DataViews` table — the one it already gives every other
   * list, carrying its saved-view persistence and its `?view=` sync. Omitted,
   * the trail renders on {@link StandaloneAuditTable}: the same grid with no
   * saved views behind it.
   */
  table?: AuditTableComponent;
  /** The saved views for this table, from the host's own store. */
  views?: SavedViewSummary[];
  /** Controlled filter state, for a host that mirrors it into its URL. */
  filters?: AuditLogFilters;
  onFiltersChange?: (filters: AuditLogFilters) => void;
  /** Filters the host pins and the operator cannot change (e.g. one resource). */
  fixedFilters?: AuditLogFilters;
  /** Opt-in "Exportar" control — the whole filtered set, re-queried. */
  exportConfig?: DataViewExport;
}

/** The error panel, above a trail that may still be showing its last page. */
function LoadError({
  labels,
  message,
  onRetry,
}: {
  labels: AuditLabels;
  message: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <Stack spacing={1} data-testid="audit-log-error">
      <Text variant="body" as="p">
        {labels.errorTitle}
      </Text>
      <Text variant="caption" as="p">
        {message}
      </Text>
      <Button variant="outline" dataTestId="audit-log-retry" onClick={onRetry}>
        {labels.retry}
      </Button>
    </Stack>
  );
}

/**
 * Why the grid has no rows.
 *
 * A read that FAILED is not an empty trail, and neither is one still in flight.
 * The grid has no rows in any of the three cases, so this sentence is the only
 * thing that separates "nothing happened here" from "we do not know yet" — and
 * stating the first over the second is a claim nobody made.
 */
function emptyReason(labels: AuditLabels, error: string | null, loading: boolean): string {
  if (error) return labels.errorTitle;
  if (loading) return labels.loading;
  return labels.empty;
}

/**
 * The grid's declarations, rebuilt only when what they are made of changes.
 *
 * `initialState` is keyed on the filter VALUES: the base merges it back over
 * live grid state whenever its reference changes (that is how browser
 * back/forward re-applies the controls), so a fresh object per render would
 * re-sync on every one.
 */
function useGridConfig(
  labels: AuditLabels,
  vocabulary: AuditVocabulary,
  actors: readonly AuditActorOptionWire[],
  filterKey: string,
  locale?: string,
) {
  return {
    columns: useMemo(() => auditColumns(labels), [labels]),
    fields: useMemo(
      () => auditFields(labels, vocabulary, actors, locale),
      [labels, vocabulary, actors, locale],
    ),
    rangeFields: useMemo(() => auditRangeFields(labels), [labels]),
    sortFields: useMemo(() => auditSortFields(labels), [labels]),
    initialState: useMemo(
      () => stateFromFilters(JSON.parse(filterKey) as AuditLogFilters),
      [filterKey],
    ),
  };
}

/**
 * The filter state in force, and the one way to change it.
 *
 * CONTROLLED when the host passed `filters` — it mirrors them into its URL and
 * hands them back — and uncontrolled otherwise, holding its own. Both are the
 * same call site, so nothing downstream has to know which mode it is in.
 */
function useFilterState(
  props: Pick<AuditViewerProps, 'filters' | 'onFiltersChange'>,
): [AuditLogFilters, (next: AuditLogFilters) => void] {
  const [ownFilters, setOwnFilters] = useState<AuditLogFilters>({});
  const controlled = props.filters;
  const { onFiltersChange } = props;
  const apply = useCallback(
    (next: AuditLogFilters): void => {
      onFiltersChange?.(next);
      if (!controlled) setOwnFilters(next);
    },
    [controlled, onFiltersChange],
  );
  return [controlled ?? ownFilters, apply];
}

/**
 * The server-mode wiring, from the page that actually loaded.
 *
 * Every number comes from the RESPONSE rather than from a local counter, so the
 * pager states where the database put the reader and not where the browser
 * asked to be. The fallbacks cover exactly one frame — before the first page
 * lands there is no answer to read.
 */
function serverFor(
  page: AuditLogPageWire | null,
  filters: AuditLogFilters,
  onQueryChange: (query: DataViewQuery) => void,
): DataViewServer {
  const pagination = page?.pagination;
  return {
    totalCount: pagination?.total ?? 0,
    page: pagination?.page ?? filters.page ?? 1,
    pageSize: pagination?.pageSize ?? FALLBACK_PAGE_SIZE,
    onQueryChange,
  };
}

export function AuditViewer(props: AuditViewerProps): JSX.Element {
  const { api, labels, vocabulary, formatDate, locale, fixedFilters } = props;
  const [filters, applyFilters] = useFilterState(props);
  const [reloadToken, setReloadToken] = useState(0);
  const { page, error, loading } = useAuditPage(
    api,
    useMemo(() => ({ ...filters, ...fixedFilters }), [filters, fixedFilters]),
    labels.errorTitle,
    reloadToken,
  );
  const actors = useActorOptions(api);
  const rows = useMemo(
    () => toAuditRows(page?.data ?? [], { labels, vocabulary, formatDate, locale }),
    [page, labels, vocabulary, formatDate, locale],
  );
  const config = useGridConfig(labels, vocabulary, actors, JSON.stringify(filters), locale);

  // The grid owns the page-reset rule — it emits page 1 on any effective-query
  // change and the requested page on a pager click — so nothing here re-decides
  // it. That rule used to live in this file, and stating it in both places is
  // how the two come to disagree.
  const onQueryChange = useCallback(
    (query: DataViewQuery): void => applyFilters(filtersFromQuery(query)),
    [applyFilters],
  );

  const Table = props.table;
  const tableProps = {
    ...config,
    inlineFilters: true,
    rows,
    server: serverFor(page, filters, onQueryChange),
    views: props.views ?? [],
    getRowId: (row: { id: string }) => row.id,
    dataTestId: 'audit-log-grid',
    testIdPrefix: 'audit-log',
    ...(props.exportConfig ? { exportConfig: props.exportConfig } : {}),
    emptyState: (
      // The grid's own wrapper already carries `audit-log-empty` (and
      // `-filtered` when something is narrowing the list, which is a different
      // sentence it writes itself). This id names the REASON inside it.
      <Text variant="body" as="p" data-testid="audit-log-empty-reason">
        {emptyReason(labels, error, loading)}
      </Text>
    ),
  };

  return (
    <Stack spacing={2} data-testid="audit-log">
      {error ? (
        <LoadError
          labels={labels}
          message={error}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}
      {Table ? (
        <Table {...tableProps} />
      ) : (
        <StandaloneAuditTable {...tableProps} viewsUnavailable={labels.viewsUnavailable} />
      )}
    </Stack>
  );
}
