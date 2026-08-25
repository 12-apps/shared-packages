import type { ComponentType, JSX } from 'react';

import type { AuditLogFilters } from '../core/types';
import { assertAuditVocabulary, type AuditVocabulary } from '../core/vocabulary';

import { createAuditApiClient, type AuditApiClient } from './api';
import { DEFAULT_EXPORT_LIMITS, type AuditExportLimits } from './export';
import type { AuditTableComponent } from './grid-table';
import { createAuditLabels, type AuditLabelOverrides, type AuditLabels } from './labels';
import { AuditScreen, type AuditScreenProps } from './screen';
import { httpAuditTransport, type AuditTransport } from './transport';
import { AuditViewer, type AuditViewerProps } from './viewer';

/**
 * The one thing this package exposes to a FRONTEND host.
 *
 * Everything the audit screen IS — the dashboard chrome, the filter bar, the
 * grid, the diff summary, the saved-view chrome, the pagination, the export and
 * the rendering of the impersonation PAIR — lives inside this package. The host
 * names where the API is mounted, what its own words are, and which of ITS
 * wiring the screen should render through:
 *
 *   const { page: AuditLog } = createWebAudit({ apiBase, vocabulary });
 *
 * The vocabulary is the SAME value the backend half is given, so the actions the
 * writer can emit and the labels this screen renders are one list.
 */

export interface AuditWebConfig {
  /** The admin mount the routes live under, e.g. `/api/admin/acme`. */
  apiBase: string;
  /**
   * The action/resource vocabulary — the value `defineAuditVocabulary()`
   * returned, and the SAME value passed to `createApiAudit`.
   *
   * REQUIRED, and there used to be a default: this surface fell back to the
   * extraction origin's catalog, so a host that forgot to pass its own rendered
   * a filter bar of another product's actions, labelled in another product's
   * language, over its own rows — and every one of its own actions fell through
   * to a raw dotted id. Nothing failed; the screen simply described somebody
   * else's application.
   */
  vocabulary: AuditVocabulary;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: AuditTransport;
  /** Label overrides — the host's copy. See `labels.ts` for the defaults. */
  labels?: AuditLabelOverrides;
  /**
   * The host's own `DataViews` table — the wrapper it already gives every other
   * admin list, carrying its saved-view persistence and its `?view=` URL sync.
   *
   * Optional, and the absence is not a degraded screen: the trail renders on
   * the same grid either way. What a host loses by omitting it is saved views,
   * because there is nowhere to save one TO — persistence is a backend the
   * package cannot invent, exactly as the router is one it cannot know.
   *
   * Bind it once, beside the rest of this config: the member is a component
   * TYPE, so a wrapper rebuilt per render would remount the whole grid.
   */
  table?: AuditTableComponent;
  /**
   * How a timestamp is written. Default: the RUNTIME's own locale, short date
   * and short time.
   *
   * The default used to be one market's locale, which put that market's date
   * order on every adopter's screen. `undefined` as the `Intl` locale means
   * "whatever this browser is set to", which is the only neutral answer a
   * package has; a host that wants its own passes `locale`, and one that wants
   * full control passes `formatDate`.
   */
  formatDate?: (iso: string) => string;
  /**
   * BCP-47 tag for the default stamp formatter. Default: the runtime's.
   *
   * It no longer decides the DAY-BOUND field order: the period filter is the
   * grid's own day-range pill now, and its inputs follow the host's
   * `DataViewsCopy` and locale like every other date field in an adopting host
   * — which is the consistency the masked fields it replaces were paying for
   * with a control nobody else on the screen had.
   */
  locale?: string;
  /** How much one export may collect. See `export.ts`. */
  exportLimits?: AuditExportLimits;
  /**
   * Filters pinned IN THE UI — merged over the operator's own on every request, so
   * an embedded screen always shows the slice the host framed it for (an order page
   * passing `{ resourceId: order.id }`, say).
   *
   * **Not an authorization boundary.** The server has no notion of them: the wire
   * schema does not declare them, no descriptor sees them, and a user holding the
   * read permission can `GET /audit-logs` directly and read the whole tenant's
   * trail. If an operator must not see the rest of it, gate them with a PERMISSION
   * (`gatePermissions.read`) — pinning a filter here hides nothing.
   */
  fixedFilters?: AuditLogFilters;
}

export interface WebAudit {
  /**
   * The whole SCREEN: the dashboard frame, the header and the trail. A host
   * names its breadcrumb's earlier crumbs and, if it lifts the filter state,
   * mirrors that state into its own URL.
   */
  page: ComponentType<AuditScreenProps>;
  /**
   * The trail's BODY alone — filters and grid, no page chrome. For a trail
   * embedded in something else (an order's detail page with `fixedFilters`).
   */
  Viewer: ComponentType<
    Pick<AuditViewerProps, 'filters' | 'onFiltersChange' | 'views' | 'table'>
  >;
}

/** The config, resolved once — what every bound component shares. */
interface SurfaceParts {
  api: AuditApiClient;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
  exportLimits: AuditExportLimits;
  table?: AuditTableComponent;
  fixedFilters?: AuditLogFilters;
}

function surfaceParts(config: AuditWebConfig): SurfaceParts {
  // Assembly refuses here exactly as it does on the server half: this is a
  // published entry point, and a host that mounts only the viewer never calls
  // `createApiAudit` at all.
  const vocabulary = assertAuditVocabulary(config.vocabulary);
  const labels = createAuditLabels(config.labels);
  const formatter = new Intl.DateTimeFormat(config.locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return {
    api: createAuditApiClient(
      config.apiBase,
      // The transport's own fallback sentence comes from the host's labels, so
      // there is one place the screen's words are declared.
      config.transport ?? httpAuditTransport({ fallbackMessage: labels.requestFailed }),
    ),
    labels,
    vocabulary,
    formatDate: config.formatDate ?? ((iso) => formatter.format(new Date(iso))),
    exportLimits: config.exportLimits ?? DEFAULT_EXPORT_LIMITS,
    ...(config.table ? { table: config.table } : {}),
    ...(config.fixedFilters ? { fixedFilters: config.fixedFilters } : {}),
  };
}

export function createWebAudit(config: AuditWebConfig): WebAudit {
  const parts = surfaceParts(config);
  return {
    page: (props: AuditScreenProps): JSX.Element => (
      <AuditScreen
        parts={parts}
        {...props}
        // The config's table is the default; a call site may still override it,
        // which is what lets one surface serve a page and an embed.
        table={props.table ?? parts.table}
      />
    ),
    Viewer: (props): JSX.Element => (
      <AuditViewer
        api={parts.api}
        labels={parts.labels}
        vocabulary={parts.vocabulary}
        formatDate={parts.formatDate}
        {...props}
        table={props.table ?? parts.table}
        {...(parts.fixedFilters ? { fixedFilters: parts.fixedFilters } : {})}
      />
    ),
  };
}
