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

export type {
  PresentationCopy,
  RenderLabelCopy,
  ReportEngineCopy,
  SpecSentenceCopy,
  SpecSentenceParts,
  ValueFormatCopy,
} from './copy';
export { PT_BR_REPORT_ENGINE_COPY } from './pt-BR';
export {
  defineCatalog,
  listCatalogFields,
  type CatalogFieldListing,
} from './catalog';
export {
  defaultPresentation,
  isOrderedDimension,
  PRESENTATION_OPTIONS,
  presentationCompatibility,
  type AxisFieldFacts,
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
export { autoTitle, specSentence } from './describe';
/**
 * Unsaved-changes comparison (FUT-391). Core, not react/: it is pure structural
 * equality with no React dependency, and a host validating a draft server-side
 * — or a consumer harness with no DOM — has the same question to answer.
 */
export { deepEqual, isDirty } from './dirty-state';
export { ReportBuilderError } from './errors';
export {
  defaultValueFor,
  isClosedSet,
  isMultiValue,
  operatorsFor,
} from './filters';
export {
  formatDurationSeconds,
  formatKpiFigure,
  formatReportValue,
  SUPPRESSED_PLACEHOLDER,
} from './format';
export {
  BLOCK_HEIGHT_MAX,
  BLOCK_HEIGHT_MIN,
  BLOCK_SPAN_MAX,
  BLOCK_SPAN_MIN,
  blockHeightCss,
  clampBlockHeight,
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
export type { ReportKpiFigure } from './render-kpi';
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
export { isValidTimeZone, truncateDateToGrain } from './time';
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
