import { z } from 'zod';

import { dashboardSpecSchema, reportDocumentSchema, reportSpecSchema } from '../spec';
import { SYSTEM_REPORT_KEYS } from './presets';
import { REPORT_STATUSES, REPORT_VISIBILITIES } from './visibility';

/**
 * The wire contract of the reports HTTP/MCP surface — authored ONCE here (the
 * payments doctrine: schemas come from the package; the host's MCP registry
 * and route handlers import them, so the advertised tool surface can never
 * drift from runtime validation).
 */

export const REPORT_RANGE_PRESETS = ['today', '7d', '30d', 'custom'] as const;
export const REPORT_MAX_RANGE_DAYS = 366;
export const REPORT_GRAINS = ['day', 'week', 'month'] as const;

export const reportsParams = z.object({
  tenantSlug: z.string().min(1),
});

export const systemReportParams = z.object({
  tenantSlug: z.string().min(1),
  key: z.enum(SYSTEM_REPORT_KEYS),
});

export const savedReportParams = z.object({
  tenantSlug: z.string().min(1),
  id: z.string().min(1),
});

/** A calendar date (`YYYY-MM-DD`), interpreted at UTC midnight by the API. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Data inválida.');

function spanInDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return ms / (24 * 60 * 60 * 1000) + 1;
}

interface CustomRangeFields {
  preset: string;
  from?: string;
  to?: string;
}

/** The custom-range rules, applied to every schema that carries a window. */
function withRangeRules<T extends z.ZodType<CustomRangeFields>>(schema: T): T {
  return schema
    .refine((value) => value.preset !== 'custom' || (value.from && value.to), {
      message: 'Informe `from` e `to` para o período personalizado.',
      path: ['from'],
    })
    .refine(
      (value) => value.preset !== 'custom' || !value.from || !value.to || value.from <= value.to,
      { message: 'A data final deve ser igual ou posterior à inicial.', path: ['to'] },
    )
    .refine(
      (value) =>
        value.preset !== 'custom' ||
        !value.from ||
        !value.to ||
        spanInDays(value.from, value.to) <= REPORT_MAX_RANGE_DAYS,
      { message: `O período não pode exceder ${REPORT_MAX_RANGE_DAYS} dias.`, path: ['to'] },
    ) as unknown as T;
}

/** Report window + grain (rolling presets or an inclusive custom range). */
export const reportRangeQuery = withRangeRules(
  z.object({
    preset: z.enum(REPORT_RANGE_PRESETS).default('30d'),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    grain: z.enum(REPORT_GRAINS).default('day'),
  }),
);

/** Body of a dry run: the declarative spec plus the window. */
export const runReportBody = withRangeRules(
  z.object({
    spec: reportSpecSchema,
    preset: z.enum(REPORT_RANGE_PRESETS).default('30d'),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  }),
);

export const saveReportBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  /** A single ReportSpec, or a dashboard document (`kind: "dashboard"`). */
  spec: reportDocumentSchema,
  /**
   * Lifecycle (FUT-307). Omitted: create defaults to 'published' (the
   * pre-lifecycle behavior); update keeps the stored value.
   */
  status: z.enum(REPORT_STATUSES).optional(),
  /** Sharing (FUT-307). Omitted: create defaults to 'tenant'; update keeps. */
  visibility: z.enum(REPORT_VISIBILITIES).optional(),
  /** Host role ids granted access when visibility = 'roles'. */
  visibilityRoles: z.array(z.string().min(1).max(64)).max(20).optional(),
});

/** One row of a report result, keyed by output-column alias. */
const reportRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const reportTableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  /**
   * Serializable format hint: `brl` = integer centavos, `duration` = seconds,
   * `percent` = a 0-1 ratio (FUT-454).
   */
  format: z.enum(['brl', 'integer', 'decimal', 'text', 'duration', 'percent']),
});

/** Serializable ChartSpec consumed by @12-apps/ui SpecChart. */
const chartSpecSchema = z.object({
  type: z.string(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  xAxis: z.object({ key: z.string(), label: z.string().optional() }),
  yAxis: z.object({ label: z.string().optional() }).optional(),
  series: z.array(
    z.object({ key: z.string(), label: z.string().optional(), color: z.string().optional() }),
  ),
  stacked: z.boolean().optional(),
  numberFormat: z.string().optional(),
  colorScheme: z.array(z.string()).optional(),
});

/** Rendered report: a table model or a chart spec, plus the aliased rows. */
export const reportRenderSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('table'),
    columns: z.array(reportTableColumnSchema),
    rows: z.array(reportRowSchema),
  }),
  z.object({
    kind: z.literal('chart'),
    chartSpec: chartSpecSchema,
    rows: z.array(reportRowSchema),
  }),
  /** Single-number tile (FUT-309): the whole-period figure, pre-labeled. */
  z.object({
    kind: z.literal('kpi'),
    label: z.string(),
    value: z.number().nullable(),
    /** True when `minSample` withheld the figure server-side (FUT-454). */
    suppressed: z.boolean(),
    format: z.enum(['brl', 'percent', 'compact', 'integer', 'decimal', 'duration']),
    rows: z.array(reportRowSchema),
  }),
]);

/** The resolved window echoed back with every report run. */
export const reportRangeViewSchema = z.object({
  preset: z.enum(REPORT_RANGE_PRESETS),
  from: z.string(),
  toExclusive: z.string(),
});

export const systemReportSummarySchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  presentation: z.enum(['chart', 'table']),
  supportsGrain: z.boolean(),
});

export const systemReportResultSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  supportsGrain: z.boolean(),
  range: reportRangeViewSchema,
  grain: z.enum(REPORT_GRAINS),
  render: reportRenderSchema,
});

export const savedReportSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Whether the saved document is a single report or a dashboard (FUT-306). */
  type: z.enum(['report', 'dashboard']),
  /** Single report: its entity. Dashboard: '' (see `entities`). */
  entity: z.string(),
  /** Every entity the document queries (one for a single report). */
  entities: z.array(z.string()),
  /** Lifecycle + sharing (FUT-307). */
  status: z.enum(REPORT_STATUSES),
  visibility: z.enum(REPORT_VISIBILITIES),
  updatedAt: z.string(),
});

export const runResultSchema = z.object({
  range: reportRangeViewSchema,
  render: reportRenderSchema,
});

/** One rendered dashboard block: its layout metadata plus result or error. */
export const dashboardBlockRenderSchema = z.discriminatedUnion('status', [
  z.object({
    id: z.string(),
    title: z.string().optional(),
    span: z.number().int(),
    status: z.literal('ok'),
    render: reportRenderSchema,
  }),
  z.object({
    id: z.string(),
    title: z.string().optional(),
    span: z.number().int(),
    status: z.literal('error'),
    error: z.string(),
  }),
]);

/** Lifecycle + sharing fields echoed on every saved view (FUT-307). */
const savedLifecycleFields = {
  status: z.enum(REPORT_STATUSES),
  visibility: z.enum(REPORT_VISIBILITIES),
  visibilityRoles: z.array(z.string()),
} as const;

const savedSingleReportViewSchema = z.object({
  type: z.literal('report'),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  spec: reportSpecSchema,
  ...savedLifecycleFields,
  range: reportRangeViewSchema,
  render: reportRenderSchema,
});

const savedDashboardViewSchema = z.object({
  type: z.literal('dashboard'),
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  spec: dashboardSpecSchema,
  ...savedLifecycleFields,
  range: reportRangeViewSchema,
  blocks: z.array(dashboardBlockRenderSchema),
});

/** Opening a saved document: a single report's render, or a dashboard's blocks. */
export const savedReportViewSchema = z.discriminatedUnion('type', [
  savedSingleReportViewSchema,
  savedDashboardViewSchema,
]);

/** Serializable field catalog for builders and LLM authoring. */
export const fieldListingSchema = z.object({
  entities: z.array(
    z.object({
      entity: z.string(),
      label: z.string(),
      description: z.string().optional(),
      fields: z.array(
        z.object({
          field: z.string(),
          label: z.string(),
          type: z.string(),
          role: z.enum(['dimension', 'measure']),
          aggregations: z.array(z.string()).optional(),
          /** Declared render format (`duration`, `percent`…), when there is one. */
          format: z.string().optional(),
          description: z.string().optional(),
          /** Identity dimension: the `minSample` floor every measure must declare. */
          minGroupSample: z.number().int().positive().optional(),
          /**
           * Identity-sensitive measure: rows with fewer eligible observations
           * than this never carry the figure, whatever the spec asks for.
           */
          identityMinSample: z.number().int().positive().optional(),
        }),
      ),
      /** A known-good starter spec for this entity (FUT-308 smart default). */
      starter: reportSpecSchema.optional(),
    }),
  ),
});
