/**
 * `@12-apps/report-builder/react` — the reports feature as ONE thing.
 *
 * A frontend host writes one line:
 *
 *   const { page } = createWebReportBuilder({ tenantSlug, surface });
 *
 * Everything the feature is — the list, the viewer, the editor, the config
 * panel, the filter rows, the pickers, and the ROUTES between them — lives
 * inside this package. The host supplies only what is genuinely its own: which
 * tenant, how to reach the API, and its own VOCABULARY (`surface`) — the
 * built-in reports, the dashboards, the menu sections they hang off, the block
 * templates its picker offers and the clock its tenants keep.
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
 * The vocabulary a host declares, and the types it declares it in.
 *
 * This export used to be `SYSTEM_DASHBOARDS`, `SYSTEM_REPORT_KEYS` and
 * `SYSTEM_REPORT_NAV` — the origin host's seven built-ins and two dashboards, as
 * VALUES, out of a package every other host installs. A host's menu built rows
 * from them and got another product's reports. What crosses this boundary now
 * is the shape they are declared in; the entries themselves are the host's, and
 * travel INTO the surface rather than out of it.
 */
export type { ReportBuilderSurface } from './transport-context';
export type {
  SystemDashboardDef,
  SystemReportDef,
  SystemReportNavEntry,
  SystemReportSection,
} from '../server/system-reports';
export { systemReportNav } from '../server/system-reports';
export {
  blankBlockTemplate,
  blockTemplateGroups,
  type BlockTemplate,
  type BlockTemplateGroup,
} from '../server/block-templates';

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

export type { ReportBuilderCopy } from './copy';
export { useReportCopy, useReportEngineCopy } from './transport-context';

// The screens' words, and the pt-BR pack a host passes to keep today's
// wording. REQUIRED config since FUT-760 — this package ships no defaults.
export { PT_BR_REPORT_SCREENS_COPY } from './pt-BR';
export { EN_US_REPORT_SCREENS_COPY } from './en-US';
export type {
  ReportScreensCopy,
  ReportListCopy,
  ReportRelativeTimeCopy,
  ReportViewCopy,
  ReportEditorCopy,
  ReportArchiveCopy,
  ReportRangeCopy,
  ReportSystemCopy,
  ReportBuilderPanelCopy,
  ReportSettingsCopy,
  ReportChoiceCardCopy,
} from './screens-copy';
