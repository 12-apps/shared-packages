import type { ComponentType, JSX } from 'react';

import type { AuditLogFilters } from '../core/types';
import { indexVocabulary, type AuditVocabulary } from '../core/vocabulary';
import { FUTURE_PAY_AUDIT_VOCABULARY } from '../core/future-pay-vocabulary';

import { createAuditApiClient, type AuditApiClient } from './api';
import { createAuditLabels, type AuditLabelOverrides, type AuditLabels } from './labels';
import { httpAuditTransport, type AuditTransport } from './transport';
import { AuditViewer } from './viewer';

/**
 * The one thing this package exposes to a FRONTEND host (12-14).
 *
 * Everything the audit viewer IS — the filter bar, the pills, the day bounds, the
 * table, the diff summary, the pagination, the impersonation PAIR — lives inside
 * this package. The host names where the API is mounted, and that is the whole
 * wiring:
 *
 *   const { page: AuditLog } = createWebAudit({ apiBase: '/api/admin/my-store' });
 *
 * The vocabulary is shared with the backend half, so the actions the writer can
 * emit and the labels this screen renders are ONE list. In future-pay they were
 * two files in two apps, and nine actions had no label at all.
 */

export interface AuditWebConfig {
  /** The admin mount the routes live under, e.g. `/api/admin/minha-loja`. */
  apiBase: string;
  /**
   * The action/resource vocabulary — the SAME value the backend half is given.
   * Defaults to the Future Pay vocabulary (the `@12-apps/rbac` precedent for
   * shipping a host's catalog beside generic machinery).
   */
  vocabulary?: AuditVocabulary;
  /** How the surface reaches its data. Default: same-origin fetch. */
  transport?: AuditTransport;
  /** pt-BR label overrides. */
  labels?: AuditLabelOverrides;
  /** Stamp formatter. Default: pt-BR short date + short time. */
  formatDate?: (iso: string) => string;
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
  vocabulary: ReturnType<typeof indexVocabulary>;
  formatDate: (iso: string) => string;
  fixedFilters?: AuditLogFilters;
}

const DEFAULT_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function surfaceParts(config: AuditWebConfig): SurfaceParts {
  return {
    api: createAuditApiClient(config.apiBase, config.transport ?? httpAuditTransport()),
    labels: createAuditLabels(config.labels),
    vocabulary: indexVocabulary(config.vocabulary ?? FUTURE_PAY_AUDIT_VOCABULARY),
    formatDate: config.formatDate ?? ((iso) => DEFAULT_DATE_TIME.format(new Date(iso))),
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
