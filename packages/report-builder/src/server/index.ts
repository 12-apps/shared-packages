export {
  createApiReportBuilder,
  documentShape,
  type ReportActor,
  type ReportAdapterFactory,
  type ReportBuilderServerConfig,
  type ReportRequest,
  type ReportResponse,
  type ReportRoute,
} from './create-report-builder';
/**
 * The period a report runs over. Exported because a host resolves the SAME
 * window for its own non-report surfaces (a dashboard tile, an export), and
 * two resolvers disagreeing about where a day begins is precisely the bug this
 * math exists to prevent.
 */
export {
  REPORT_DEFAULT_RANGES,
  resolveDefaultRange,
  resolveReportRange,
  startOfDay,
  startOfNextDay,
  toReportRangeView,
  type ReportDefaultRange,
  type ReportRangeInput,
  type ReportRangePreset,
  type ReportRangeView,
  type ResolvedReportRange,
} from './range';
/** Compile-only validation of a document, the way the save routes do it. */
export { compileDocument } from './compile-document';
export { toSummary, type SavedReportSummary } from './summary';
/**
 * `@12-apps/report-builder/server` — the host-mounted backend surface
 * (plug-and-play, payments-backend doctrine): the domain field catalog and
 * system-report presets, the entity→permission policy, the duck-typed
 * tenant-scoped DataSource and SavedReport store, and the wire (zod) contract
 * the host's routes and MCP registry import. The host owns AUTH and tenant
 * attribution; nothing here reads sessions or imports a generated client.
 * See ADOPTING.md for the standardized adoption contract.
 */
export { REPORT_ENTITY_DATE_FIELD, reportCatalog } from './catalog';
/**
 * The per-cook suppression floor (FUT-454), exported so a host surface can
 * STATE the policy with the same number the server enforces it with, rather
 * than restating "20" in prose that can drift away from the constant.
 */
export { KITCHEN_CHEF_MIN_SAMPLE } from './adapter-kitchen-source';
export {
  getSystemReport,
  SYSTEM_REPORT_KEYS,
  SYSTEM_REPORT_NAV,
  SYSTEM_REPORTS,
  type SystemReportNavEntry,
  type SystemReportSection,
} from './presets';
export { REPORT_ENTITY_PERMISSION, REPORT_RUN_MAX_ROWS } from './policy';
/**
 * The "Adicionar bloco" picker's contents (FUT-391). Server-side because every
 * template's spec IS a starter, and the starters are compile-validated against
 * the live catalog here — a client-side copy would carry no such guarantee.
 */
export {
  BLANK_BLOCK_TEMPLATE,
  blockTemplateGroups,
  findBlockTemplate,
  type BlockTemplate,
  type BlockTemplateGroup,
} from './block-templates';
export { REPORT_ENTITY_STARTERS } from './starters';
export {
  canViewSavedReport,
  REPORT_STATUSES,
  REPORT_VISIBILITIES,
  visibilityRoleIds,
  type ReportStatus,
  type ReportVisibility,
  type ReportVisibilityActor,
  type ReportVisibilityFields,
} from './visibility';
export { dayOfWeekSaoPaulo, hourOfDaySaoPaulo } from './local-time';
export {
  createTenantReportDataSource,
  type ReportSourceDb,
  type ReportSourceDbProvider,
  type ReportWindow,
} from './adapter';
export {
  createSavedReportStore,
  isUniqueNameViolation,
  type SavedReportDb,
  type SavedReportDbProvider,
  type SavedReportInput,
  type SavedReportRecord,
  type SavedReportStore,
} from './saved';
export {
  dashboardBlockRenderSchema,
  fieldListingSchema,
  REPORT_GRAINS,
  REPORT_MAX_RANGE_DAYS,
  REPORT_RANGE_PRESETS,
  reportRangeQuery,
  reportRangeViewSchema,
  reportRenderSchema,
  reportsParams,
  reportWorkingCopySchema,
  runReportBody,
  runResultSchema,
  saveReportBody,
  savedReportParams,
  savedReportSummarySchema,
  savedReportViewSchema,
  systemReportParams,
  systemReportResultSchema,
  systemReportSummarySchema,
} from './wire';
