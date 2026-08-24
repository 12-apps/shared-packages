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
 * (plug-and-play, payments-backend doctrine): the endpoints, the period, the
 * lifecycle/visibility rules, the SavedReport store seam and the wire (zod)
 * contract the host's routes and MCP registry import.
 *
 * What it does NOT ship, and used to: a field catalog, a set of built-in
 * reports, a starter per entity, a picker of block templates, an
 * entity→permission map and a tenant-scoped Prisma DataSource — all of them
 * the origin host's, in pt-BR, over `orders` / `stock_movements` /
 * `kitchen_ticket_items`, and half of them wired in as DEFAULTS so a host that
 * declared none inherited all of them. Those are the host's, and arrive as
 * config. See ADOPTING.md for the migration.
 *
 * The host owns AUTH and tenant attribution; nothing here reads sessions or
 * imports a generated client.
 */

/**
 * The permission guarding THIS package's own surface, as a contribution the
 * host composes into its catalog (`composePermissions` in `@12-apps/rbac`, or
 * the equivalent) and wires back via `gatePermissions`.
 */
export {
  definePermissionContribution,
  DEFAULT_AUTHOR_PERMISSION,
  REPORT_BUILDER_PERMISSIONS,
  type ReportBuilderPermission,
  type ReportPermissionContribution,
  type ReportPermissionKind,
  type ReportPermissionLabels,
  type ReportPermissionOf,
  type ReportPermissionSpec,
} from './contribution';
/** The plan-feature keys the route policy declares — map them, never retype them. */
export { REPORT_BUILDER_FEATURES, type ReportBuilderFeature } from './features';
/** The wiring check every mount runs, and the error it throws. */
export { assertReportBuilderConfig, ReportBuilderConfigError } from './config';
/** The SHAPE of a host's built-in reports, and the projections over them. */
export {
  findSystemDashboard,
  findSystemReport,
  systemReportNav,
  type SystemDashboardBlockDef,
  type SystemDashboardDef,
  type SystemReportDef,
  type SystemReportNavEntry,
  type SystemReportSection,
} from './system-reports';
export { REPORT_RUN_MAX_ROWS } from './policy';
/**
 * The block picker's SHAPE. Its contents are the host's, and travel into
 * `createWebReportBuilder({ surface })`; this module ships only the blank
 * template and the composition that always appends it.
 */
export {
  blankBlockTemplate,
  blockTemplateGroups,
  type BlockTemplate,
  type BlockTemplateGroup,
} from './block-templates';
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
/**
 * The reporting window, and the Prisma-shaped filter a host adapter applies it
 * with. The adapter itself is the host's — this package no longer ships one,
 * because an adapter is a set of reads against one application's tables.
 */
export { windowWhere, type DateWindowWhere, type ReportWindow } from './adapter-shared';
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

export type { ReportRangeMessages, ReportServerMessages } from './messages';
export type { BlankBlockTemplateCopy } from './block-templates';
export { PT_BR_BLANK_BLOCK_TEMPLATE_COPY, PT_BR_REPORT_SERVER_MESSAGES } from './pt-BR';
export { EN_US_BLANK_BLOCK_TEMPLATE_COPY, EN_US_REPORT_SERVER_MESSAGES } from './en-US';
