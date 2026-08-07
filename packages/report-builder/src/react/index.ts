/**
 * `@12-apps/report-builder/react` — the reports feature as ONE thing.
 *
 * A frontend host writes one line:
 *
 *   const { page } = createWebReportBuilder({ tenantSlug });
 *
 * Everything the feature is — the list, the viewer, the editor, the config
 * panel, the filter rows, the pickers, the templates, and the ROUTES between
 * them — lives inside this package. The host supplies only what is genuinely
 * its own: which tenant, and how to reach the API.
 *
 * This entry deliberately does NOT export the screens individually. It used
 * to, and the cost showed up immediately: hosts hand-wrote the route table, so
 * each had to rediscover that `reports/new` must precede `reports/:id` or the
 * static segment is read as an id — a rule of this surface leaking into every
 * consumer. Exploring components one at a time is Storybook's job, and belongs
 * in this package rather than in a consumer's route file.
 *
 * The host still owns auth: the default transport rides the browser's cookies
 * against its own `/api/admin/...` endpoints. See ADOPTING.md.
 */
export { createWebReportBuilder, type ReportBuilderConfig } from './create-report-builder';
export { httpTransport, type ReportBuilderTransport } from './transport';

/**
 * The built-in dashboards a host mounts in its OWN lateral menu — the one
 * genuine integration point beyond the surface itself, because only the host
 * knows where its menu lives and which permission gates a row.
 */
export {
  SYSTEM_DASHBOARDS,
  SYSTEM_REPORT_KEYS,
  SYSTEM_REPORT_NAV,
  type SystemDashboardDef,
  type SystemReportNavEntry,
  type SystemReportSection,
} from '../server/presets';

/**
 * Wire types, for a host that persists or proxies these payloads. Types only —
 * no behaviour crosses this boundary.
 */
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
