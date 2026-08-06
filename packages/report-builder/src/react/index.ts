/**
 * `@12-apps/report-builder/react` — the plug-and-play reports UI (payments-
 * frontend doctrine), each page taking only `tenantSlug` from the host:
 *
 *   - {@link ReportsPage}      the Relatórios area: pick an authored report,
 *                              read it, edit or archive it (FUT-391);
 *   - {@link ReportEditorPage} the same canvas, inline-editable;
 *   - {@link SystemReportPage} one built-in report, reached from the host's
 *                              lateral menu under the area it analyses;
 *   - {@link SystemDashboardPage} a whole SECTION's built-ins on one canvas
 *                              under one period.
 *
 * The host mounts the built-in DASHBOARDS in its menu from
 * {@link SYSTEM_DASHBOARDS} — one row per section, gated by the entry's own
 * permission; {@link SYSTEM_REPORT_NAV} still describes the individual reports
 * those dashboards are composed from, which stay reachable by deep link.
 *
 * Routing (react-router) and data fetching (same-origin `/api/admin/...`) are
 * self-contained; the host owns auth. See ADOPTING.md.
 */
export { ReportsPage } from './reports-page';
export { ReportEditorPage } from './report-editor';
export { SystemReportPage } from './system-report';
export { SystemDashboardPage } from './system-dashboard';
export { ReportRenderView } from './report-render';
export { ReportGrid, ReportGridItem, ReportBlockFrame } from './report-grid';
/**
 * The list, separately from the page that fetches for it. `ReportsPage` needs a
 * router and a query client; this takes reports as a prop, so a host that
 * already has the summaries — or the consumer harness, which has no API at all
 * — can render the real list rather than a lookalike. `filterReports` is the
 * rule the list applies, exported so it can be asserted without a DOM.
 */
export { ReportCardList } from './report-card-list';
export {
  filterReports,
  REPORT_SCOPE_LABELS,
  type ReportScope,
} from './report-list-filters';
export {
  SYSTEM_DASHBOARDS,
  SYSTEM_REPORT_KEYS,
  SYSTEM_REPORT_NAV,
  type SystemDashboardDef,
  type SystemReportNavEntry,
  type SystemReportSection,
} from '../server/presets';
export type { ReportRender, ReportRow, ReportTableColumn, SystemReportSummary } from './reports-api';
export type {
  DashboardBlockWire,
  DashboardSpecWire,
  ReportDocumentWire,
  ReportEntityFields,
  ReportField,
  ReportSpecWire,
  ReportStatusWire,
  SavedReportSummary,
  SavedReportView,
} from './custom-reports-api';
export type { ReportBlockDraft, ReportDraft } from './report-model';
