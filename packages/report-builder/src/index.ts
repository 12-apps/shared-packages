/**
 * @12-apps/report-builder — agnostic report-builder library (FUT-130).
 *
 * Declarative JSON `ReportSpec`s validated against a host-registered field
 * catalog, compiled to a neutral query IR, executed through a host-provided
 * `ReportDataSource` adapter, and rendered to a serializable table model or a
 * `@12-apps/ui` ChartSpec.
 *
 * Portability contract: zero imports from apps/*, no Prisma, no Next.js.
 * A host integrates with exactly three things — a catalog (`defineCatalog`),
 * an adapter (`ReportDataSource`, which owns tenant scoping), and a renderer
 * for the render model (e.g. `SpecChart` from `@12-apps/ui/charts` plus any
 * table component). See README.md for the integration walkthrough.
 *
 * Security model: specs are data, never code. They can only name catalog
 * fields; unknown entities/fields/aggregations are rejected with actionable
 * (LLM-friendly) errors, and row output is capped via `maxRows`.
 */

export {
  defineCatalog,
  listCatalogFields,
  type CatalogFieldListing,
} from './catalog';
export {
  defaultPresentation,
  PRESENTATION_OPTIONS,
  presentationCompatibility,
  type PresentationCompatibility,
  type PresentationOption,
  type SpecShape,
} from './compatibility';
export {
  accumulate,
  finalize,
  newAccumulator,
  percentileOf,
  type MeasureAccumulator,
} from './aggregates';
export { DEFAULT_ROW_LIMIT, compileReport, type CompileOptions } from './compile';
export { ReportBuilderError } from './errors';
export {
  formatDurationSeconds,
  formatKpiFigure,
  formatReportValue,
  SUPPRESSED_PLACEHOLDER,
} from './format';
export {
  BLOCK_SPAN_MAX,
  BLOCK_SPAN_MIN,
  clampBlockSpan,
  minSpanForPresentation,
  REPORT_GRID_COLUMNS,
  responsiveSpan,
  spanOptionsFor,
  type PresentationShape,
  type ViewportTier,
} from './layout';
export { createMemoryDataSource, executeCompiledQuery } from './memory';
export { renderReport, type ReportRenderModel, type ReportTableColumn } from './render';
export {
  parseReportDocument,
  parseReportSpec,
  runDashboard,
  runReport,
  type DashboardBlockFailure,
  type DashboardBlockResult,
  type DashboardBlockSuccess,
  type DashboardRunResult,
  type ReportRunResult,
  type RunReportOptions,
} from './run';
export {
  DASHBOARD_MAX_BLOCKS,
  dashboardBlockSchema,
  dashboardSpecSchema,
  describeSpecIssues,
  MAX_MIN_SAMPLE,
  documentEntities,
  isDashboardInput,
  isDashboardSpec,
  reportDimensionSchema,
  reportDocumentSchema,
  reportFilterSchema,
  reportMeasureSchema,
  reportPresentationSchema,
  reportSpecSchema,
  type DashboardBlock,
  type DashboardSpec,
  type ReportDimension,
  type ReportDocument,
  type ReportDocumentInput,
  type ReportFilter,
  type ReportMeasure,
  type ReportPresentation,
  type ReportSpec,
  type ReportSpecInput,
} from './spec';
export { DEFAULT_REPORT_TIME_ZONE, isValidTimeZone, truncateDateToGrain } from './time';
export type {
  Aggregation,
  CompiledDimension,
  CompiledFilter,
  CompiledMeasure,
  CompiledQuery,
  EntityDef,
  FieldCatalog,
  FieldDef,
  FieldType,
  FilterOperator,
  FilterValue,
  PercentileAggregation,
  ReportCellValue,
  ReportDataSource,
  ReportKpiFormat,
  ReportRow,
  ReportValueFormat,
  SuppressedValue,
  TimeGrain,
} from './types';
export {
  AGGREGATIONS,
  isPercentileAggregation,
  isSuppressed,
  PERCENTILE_AGGREGATIONS,
  PERCENTILE_FRACTIONS,
  REPORT_VALUE_FORMATS,
  SUPPRESSED,
  TIME_GRAINS,
} from './types';
