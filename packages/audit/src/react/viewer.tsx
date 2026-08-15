import { useCallback, useEffect, useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import {
  DEFAULT_AUDIT_SORT,
  type AuditActorOptionWire,
  type AuditLogFilters,
  type AuditLogPageWire,
  type AuditSort,
} from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import type { AuditApiClient } from './api';
import type { DayFormat } from './day-bound';
import { AuditEntriesTable } from './entries-table';
import { AuditFilterBar } from './filter-bar';
import { formatLabel, type AuditLabels } from './labels';

/**
 * The audit-log viewer.
 *
 * Server-driven, like the page it came from: every filter, the ordering and the
 * pagination run in the database. The screen holds the filter state and turns it
 * into ONE query string — it deliberately does NOT read or write the URL, because
 * a package cannot know the host's router (a host that wants bookmarkable filters
 * lifts the state; see `filters`/`onFiltersChange`).
 */

export interface AuditViewerProps {
  api: AuditApiClient;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
  /** How the locale writes a numeric date — the day bounds' mask. */
  dayFormat: DayFormat;
  /** Controlled filter state, for a host that mirrors it into its URL. */
  filters?: AuditLogFilters;
  onFiltersChange?: (filters: AuditLogFilters) => void;
  /** Filters the host pins and the operator cannot change (e.g. one resource). */
  fixedFilters?: AuditLogFilters;
}

/** The screen's async state — one value, so no impossible combination exists. */
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; page: AuditLogPageWire };

function PageFooter({
  labels,
  page,
  onPage,
}: {
  labels: AuditLabels;
  page: AuditLogPageWire;
  onPage: (next: number) => void;
}): JSX.Element {
  const { pagination } = page;
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button
        variant="text"
        disabled={pagination.page <= 1}
        dataTestId="audit-log-prev"
        onClick={() => onPage(pagination.page - 1)}
      >
        {labels.previousPage}
      </Button>
      <Text variant="caption" as="span" data-testid="audit-log-page-status">
        {formatLabel(labels.pageStatus, {
          page: String(pagination.page),
          pageCount: String(pagination.pageCount),
          total: String(pagination.total),
        })}
      </Text>
      <Button
        variant="text"
        disabled={!pagination.hasNextPage}
        dataTestId="audit-log-next"
        onClick={() => onPage(pagination.page + 1)}
      >
        {labels.nextPage}
      </Button>
    </Stack>
  );
}

/** The list body: loading, the error with its retry, the empty state, or rows. */
function ViewerBody({
  state,
  labels,
  vocabulary,
  formatDate,
  sort,
  onSortChange,
  onRetry,
  onPage,
}: {
  state: LoadState;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
  sort: AuditSort;
  onSortChange: (next: AuditSort) => void;
  onRetry: () => void;
  onPage: (next: number) => void;
}): JSX.Element {
  if (state.status === 'loading') {
    return (
      <Text variant="body" as="p" data-testid="audit-log-loading">
        {labels.loading}
      </Text>
    );
  }
  if (state.status === 'error') {
    return (
      <Stack spacing={1} data-testid="audit-log-error">
        <Text variant="body" as="p">
          {labels.errorTitle}
        </Text>
        <Text variant="caption" as="p">
          {state.message}
        </Text>
        <Button variant="outline" dataTestId="audit-log-retry" onClick={onRetry}>
          {labels.retry}
        </Button>
      </Stack>
    );
  }
  if (state.page.data.length === 0) {
    return (
      <Text variant="body" as="p" data-testid="audit-log-empty">
        {labels.empty}
      </Text>
    );
  }
  return (
    <Stack spacing={1}>
      <AuditEntriesTable
        entries={state.page.data}
        labels={labels}
        vocabulary={vocabulary}
        formatDate={formatDate}
        sort={sort}
        onSortChange={onSortChange}
      />
      <PageFooter labels={labels} page={state.page} onPage={onPage} />
    </Stack>
  );
}

/**
 * The page for one filter set.
 *
 * The dependency is the SERIALIZED filter set, deliberately, and not
 * `filters`/`fixedFilters` themselves: the fetch must re-run when a filter VALUE
 * changes, not when a controlled host hands over a new object literal carrying
 * the same values — which it does on every one of its own renders, and which
 * would refetch the page each time.
 */
function useAuditPage(
  api: AuditApiClient,
  filters: AuditLogFilters,
  errorTitle: string,
  reloadToken: number,
): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const query = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      // Read back out of the serialized form the dependency is keyed on, so the
      // request and the cache key can never describe different filters.
      // `AuditLogFilters` is JSON-safe by construction (strings, numbers, string
      // arrays — the day bounds are `YYYY-MM-DD`, not Dates), so the round trip
      // is lossless.
      .listEntries(JSON.parse(query) as AuditLogFilters)
      .then((page) => {
        if (!cancelled) setState({ status: 'ready', page });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : errorTitle,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, query, reloadToken, errorTitle]);

  return state;
}

/**
 * The actor-filter options, fetched once per client.
 *
 * A failure is swallowed into an empty list: the options are an affordance, not
 * the data — a host with no directory answers empty, and a failure here must not
 * take the trail down with it. The picker then falls back to a free-text id.
 */
function useActorOptions(api: AuditApiClient): readonly AuditActorOptionWire[] {
  const [actors, setActors] = useState<readonly AuditActorOptionWire[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .listActors()
      .then((options) => {
        if (!cancelled) setActors(options);
      })
      .catch(() => {
        if (!cancelled) setActors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return actors;
}

export function AuditViewer(props: AuditViewerProps): JSX.Element {
  const { api, labels, vocabulary, formatDate, dayFormat, fixedFilters } = props;
  const [ownFilters, setOwnFilters] = useState<AuditLogFilters>({});
  const filters = props.filters ?? ownFilters;
  const [reloadToken, setReloadToken] = useState(0);
  const state = useAuditPage(
    api,
    { ...filters, ...fixedFilters },
    labels.errorTitle,
    reloadToken,
  );
  const actors = useActorOptions(api);

  const applyFilters = useCallback(
    (next: AuditLogFilters): void => {
      // A filter change always returns to page 1: keeping page 5 while narrowing
      // to three results shows an empty list that looks like a broken filter.
      const withFirstPage = { ...next, page: 1 };
      props.onFiltersChange?.(withFirstPage);
      if (!props.filters) setOwnFilters(withFirstPage);
    },
    [props],
  );

  return (
    <Stack spacing={2} data-testid="audit-log">
      <Text variant="heading" as="h1">
        {labels.title}
      </Text>
      <Text variant="caption" as="p">
        {labels.about}
      </Text>
      <AuditFilterBar
        filters={filters}
        labels={labels}
        vocabulary={vocabulary}
        actors={actors}
        dayFormat={dayFormat}
        onChange={applyFilters}
      />
      <ViewerBody
        state={state}
        labels={labels}
        vocabulary={vocabulary}
        formatDate={formatDate}
        sort={filters.sort ?? DEFAULT_AUDIT_SORT}
        // A re-ordering returns to page 1 for the reason a filter change does:
        // page 5 of "newest first" is not page 5 of "oldest first".
        onSortChange={(sort) => applyFilters({ ...filters, sort })}
        onRetry={() => setReloadToken((token) => token + 1)}
        onPage={(page) => {
          const next = { ...filters, page };
          props.onFiltersChange?.(next);
          if (!props.filters) setOwnFilters(next);
        }}
      />
    </Stack>
  );
}
