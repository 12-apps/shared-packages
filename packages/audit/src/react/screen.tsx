/**
 * The trail as a PAGE: the dashboard chrome an adopting host's other lists all
 * wear — breadcrumb, title, the `[i]` that explains the page, the export — over
 * the viewer.
 *
 * The chrome is here rather than in the host for the reason the filter bar is:
 * it is the same four decisions in every adopter, and a package that ships a
 * screen and leaves its frame to each host ships a screen that looks different
 * in each. What a host still names is what only it knows — where its
 * breadcrumb's earlier crumbs point, and how its router renders a link.
 *
 * The EXPORT is the one control here that is not a re-render of something the
 * viewer already had. It downloads the whole filtered set rather than the
 * loaded page (`export.ts` argues why), which is why it lives beside the filter
 * state rather than beside the rows.
 */
import { useCallback, useState, type ElementType, type JSX, type ReactNode } from 'react';

import { Dashboard } from '@12-apps/ui/layout/Dashboard';
import { Text } from '@12-apps/ui/typography/Text';
import { exportRows } from '@12-apps/ui/utils';
import type { SavedViewSummary } from '@12-apps/ui/data-display/DataViews';

import type { AuditLogFilters } from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import type { AuditApiClient } from './api';
import { collectAuditEntries, type AuditExportLimits } from './export';
import { auditExportColumns } from './grid-config';
import { toAuditRows } from './grid-rows';
import type { AuditTableComponent } from './grid-table';
import { formatLabel, type AuditLabels } from './labels';
import { AuditViewer } from './viewer';

/** One breadcrumb entry, in the host's own words and pointing at its own URLs. */
export interface AuditCrumb {
  label: string;
  href?: string;
}

export interface AuditScreenProps {
  /**
   * The trail's ancestors. The LAST crumb — the page itself — is appended from
   * `labels.title`, so a host names the path it owns and never restates the
   * page's own name in a second place.
   */
  breadcrumb?: AuditCrumb[];
  /** Render a crumb's link through the host's router. Defaults to `<a>`. */
  renderLink?: (item: AuditCrumb, children: ReactNode) => ReactNode;
  /** Element type for the `[i]`-adjacent chrome a host routes (unused today). */
  linkComponent?: ElementType;
  /** Controlled filter state, for a host that mirrors it into its URL. */
  filters?: AuditLogFilters;
  onFiltersChange?: (filters: AuditLogFilters) => void;
  /** The saved views for this table, from the host's own store. */
  views?: SavedViewSummary[];
  /** The host's wired `DataViews` table (saved-view persistence + `?view=`). */
  table?: AuditTableComponent;
}

/** What the screen needs from the resolved surface config. */
interface AuditScreenParts {
  api: AuditApiClient;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
  exportLimits: AuditExportLimits;
  fixedFilters?: AuditLogFilters;
}

/** The export's two formats, in menu order. */
function exportFormats(labels: AuditLabels): { id: string; label: string }[] {
  return [
    { id: 'csv', label: labels.exportCsv },
    { id: 'json', label: labels.exportJson },
  ];
}

/**
 * Run one export: re-query the filter set, render the rows the grid would have
 * rendered, hand them to the browser.
 *
 * Returns the notice to show, or `null`. A truncated walk SAYS SO — an audit
 * download that quietly stopped at a ceiling is the "exported what was on
 * screen" bug wearing a bigger number.
 */
async function runExport(
  parts: AuditScreenParts,
  filters: AuditLogFilters,
  format: string,
): Promise<string | null> {
  const { labels, vocabulary, formatDate } = parts;
  try {
    const { entries, truncated } = await collectAuditEntries(
      parts.api,
      { ...filters, ...parts.fixedFilters },
      parts.exportLimits,
    );
    exportRows(
      format === 'json' ? 'json' : 'csv',
      toAuditRows(entries, { labels, vocabulary, formatDate }),
      auditExportColumns(labels),
      labels.exportFileName,
    );
    return truncated
      ? formatLabel(labels.exportTruncated, { count: String(entries.length) })
      : null;
  } catch {
    // The same sentence a failed read gets: an export is a read, and the
    // operator's next move (retry, or narrow the filter) is the same one.
    return labels.requestFailed;
  }
}

export function AuditScreen(props: AuditScreenProps & { parts: AuditScreenParts }): JSX.Element {
  const { parts } = props;
  const { labels } = parts;
  const [ownFilters, setOwnFilters] = useState<AuditLogFilters>({});
  const filters = props.filters ?? ownFilters;
  const [notice, setNotice] = useState<string | null>(null);

  const applyFilters = useCallback(
    (next: AuditLogFilters): void => {
      props.onFiltersChange?.(next);
      if (!props.filters) setOwnFilters(next);
    },
    [props],
  );

  const onExport = (format: string): void => {
    setNotice(null);
    void runExport(parts, filters, format).then(setNotice);
  };

  return (
    <Dashboard testIdPrefix="audit-log-dashboard">
      <Dashboard.Breadcrumb
        items={[...(props.breadcrumb ?? []), { label: labels.title }]}
        {...(props.renderLink ? { renderLink: props.renderLink } : {})}
      />
      <Dashboard.Header title={labels.title}>
        <Dashboard.Info title={labels.aboutTitle}>{labels.about}</Dashboard.Info>
        <Dashboard.Spacer />
        <Dashboard.Export
          label={labels.exportAction}
          formats={exportFormats(labels)}
          onExport={onExport}
        />
      </Dashboard.Header>
      <Dashboard.Body>
        {notice ? (
          <Text variant="caption" as="p" data-testid="audit-log-export-notice">
            {notice}
          </Text>
        ) : null}
        <AuditViewer
          api={parts.api}
          labels={labels}
          vocabulary={parts.vocabulary}
          formatDate={parts.formatDate}
          filters={filters}
          onFiltersChange={applyFilters}
          {...(parts.fixedFilters ? { fixedFilters: parts.fixedFilters } : {})}
          {...(props.table ? { table: props.table } : {})}
          {...(props.views ? { views: props.views } : {})}
        />
      </Dashboard.Body>
    </Dashboard>
  );
}
