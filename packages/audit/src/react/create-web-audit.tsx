import type { ComponentType, JSX } from 'react';

import type { AuditLogFilters } from '../core/types';
import { assertAuditVocabulary, type AuditVocabulary } from '../core/vocabulary';

import { createAuditApiClient, type AuditApiClient } from './api';
import { createAuditLabels, type AuditLabelOverrides, type AuditLabels } from './labels';
import { httpAuditTransport, type AuditTransport } from './transport';
import { AuditViewer } from './viewer';

/**
 * The one thing this package exposes to a FRONTEND host.
 *
 * Everything the audit viewer IS — the filter bar, the pills, the day bounds, the
 * table, the diff summary, the pagination, the impersonation PAIR — lives inside
 * this package. The host names where the API is mounted and what its own words
 * are:
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
  /** BCP-47 tag for the default stamp formatter. Default: the runtime's. */
  locale?: string;
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
  /** The whole surface: the filter bar and the trail. */
  page: ComponentType;
  /**
   * The same screen with the filter state LIFTED, for a host that mirrors filters
   * into its own router's URL (which a package cannot do for it).
   */
  Viewer: ComponentType<{
    filters: AuditLogFilters;
    onFiltersChange: (filters: AuditLogFilters) => void;
  }>;
}

/** The config, resolved once — what every bound component shares. */
interface SurfaceParts {
  api: AuditApiClient;
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
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
    ...(config.fixedFilters ? { fixedFilters: config.fixedFilters } : {}),
  };
}

export function createWebAudit(config: AuditWebConfig): WebAudit {
  const parts = surfaceParts(config);
  return {
    page: (): JSX.Element => (
      <AuditViewer
        api={parts.api}
        labels={parts.labels}
        vocabulary={parts.vocabulary}
        formatDate={parts.formatDate}
        {...(parts.fixedFilters ? { fixedFilters: parts.fixedFilters } : {})}
      />
    ),
    Viewer: ({ filters, onFiltersChange }): JSX.Element => (
      <AuditViewer
        api={parts.api}
        labels={parts.labels}
        vocabulary={parts.vocabulary}
        formatDate={parts.formatDate}
        filters={filters}
        onFiltersChange={onFiltersChange}
        {...(parts.fixedFilters ? { fixedFilters: parts.fixedFilters } : {})}
      />
    ),
  };
}
