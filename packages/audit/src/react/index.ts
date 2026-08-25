/**
 * `@12-apps/audit/react` — the frontend half.
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
  type AuditTransportOptions,
} from './transport';
export { AuditScreen, type AuditCrumb, type AuditScreenProps } from './screen';
export { AuditViewer, type AuditViewerProps } from './viewer';
// The grid seam: the props a host's own `DataViews` wrapper is bound through,
// and the fallback the surface renders on when it is given none.
export {
  StandaloneAuditTable,
  type AuditTableComponent,
  type AuditTableProps,
  type StandaloneAuditTableProps,
} from './grid-table';
// The grid's declarations, for a host assembling the trail into a table of its
// own — and `formatDiff`, which was published beside the hand-rolled table this
// replaces and is the one piece of it that was never about the table.
export {
  auditColumns,
  auditExportColumns,
  auditFields,
  auditRangeFields,
  auditSortFields,
  filtersFromQuery,
  stateFromFilters,
  AUDIT_FIELD,
  AUDIT_RANGE_PERIOD,
  AUDIT_SORT_COLUMN,
} from './grid-config';
export { formatDiff, toAuditRow, toAuditRows, type AuditRow } from './grid-rows';
export {
  collectAuditEntries,
  DEFAULT_EXPORT_LIMITS,
  type AuditExportLimits,
  type AuditExportResult,
} from './export';
