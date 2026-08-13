/**
 * `@12-apps/audit/react` — the frontend half (12-14).
 *
 * One factory: {@link createWebAudit}. The pieces below are exported for a host
 * that composes its own screen (a trail embedded in an order's detail page, say,
 * with `fixedFilters`), never because the surface needs assembling.
 */
export { createWebAudit, type AuditWebConfig, type WebAudit } from './create-web-audit';
export { auditQueryString, createAuditApiClient, type AuditApiClient } from './api';
export {
  createAuditLabels,
  DEFAULT_LABELS,
  formatLabel,
  type AuditLabelOverrides,
  type AuditLabels,
} from './labels';
export {
  AuditRequestError,
  httpAuditTransport,
  type AuditTransport,
} from './transport';
export { AuditViewer, type AuditViewerProps } from './viewer';
export { AuditEntriesTable, formatDiff, type AuditEntriesTableProps } from './entries-table';
export { AuditFilterBar, type AuditFilterBarProps } from './filter-bar';
