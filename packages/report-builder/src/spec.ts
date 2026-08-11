import { z } from 'zod';

/**
 * The declarative report contract — pure JSON, no code, no SQL. Structural
 * validation lives here (zod); catalog-aware validation (do these fields
 * exist? is this aggregation allowed?) happens in `compileReport`.
 */

const aggregationSchema = z.enum([
  'sum',
  'avg',
  'count',
  'min',
  'max',
  'count_distinct',
  'p50',
  'p90',
  'p95',
  'ratio',
]);
const timeGrainSchema = z.enum(['day', 'week', 'month']);
const valueFormatSchema = z.enum(['brl', 'integer', 'decimal', 'text', 'duration', 'percent']);

/** Largest `minSample` a spec may ask for — a bigger floor hides everything. */
export const MAX_MIN_SAMPLE = 1000;

const filterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const reportFilterSchema = z
  .object({
    field: z.string().min(1),
    operator: z.enum(['eq', 'neq', 'in', 'gte', 'lte', 'between']),
    value: filterValueSchema.optional(),
    values: z.array(filterValueSchema).min(1).max(100).optional(),
    from: filterValueSchema.optional(),
    to: filterValueSchema.optional(),
  })
  .superRefine((filter, issues) => {
    if (filter.operator === 'in' && !filter.values) {
      issues.addIssue({ code: 'custom', message: 'Filter operator "in" requires "values" (a non-empty array).' });
    }
    if (filter.operator === 'between' && (filter.from === undefined || filter.to === undefined)) {
      issues.addIssue({ code: 'custom', message: 'Filter operator "between" requires both "from" and "to".' });
    }
    if (['eq', 'neq', 'gte', 'lte'].includes(filter.operator) && filter.value === undefined) {
      issues.addIssue({ code: 'custom', message: `Filter operator "${filter.operator}" requires "value".` });
    }
  });

export const reportDimensionSchema = z.object({
  field: z.string().min(1),
  /** Only valid on date dimensions; buckets values by the grain. */
  timeGrain: timeGrainSchema.optional(),
});

export const reportMeasureSchema = z.object({
  field: z.string().min(1),
  /** Defaults per field type (money/number → sum, otherwise count). */
  aggregation: aggregationSchema.optional(),
  /** Output column name; defaults to `${aggregation}_${field}`. */
  alias: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'alias must be alphanumeric/underscore, starting with a letter')
    .max(64)
    .optional(),
  /** Required by (and only valid on) `aggregation: "ratio"` — the summed divisor. */
  denominator: z.string().min(1).optional(),
  /**
   * Minimum eligible rows before the figure is shown (FUT-454). Below it the
   * executor emits a suppression marker and the value never reaches the
   * client — a per-person ranking over three lines is noise, not a ranking.
   */
  minSample: z.number().int().min(1).max(MAX_MIN_SAMPLE).optional(),
  /** Overrides the render format derived from the field (duration, percent…). */
  format: valueFormatSchema.optional(),
});

export const reportPresentationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table') }),
  z.object({
    kind: z.literal('chart'),
    chartType: z.enum(['line', 'bar', 'area', 'pie', 'donut']),
    stacked: z.boolean().optional(),
    /** Overrides the number format derived from the first measure's type. */
    numberFormat: z.enum(['brl', 'percent', 'compact', 'integer', 'decimal']).optional(),
  }),
  /**
   * A single-number tile (FUT-309): the measure aggregated over the whole
   * period, no grouping. Requires 0 dimensions and exactly 1 measure.
   */
  z.object({
    kind: z.literal('kpi'),
    /** Tile caption; defaults to the measure's catalog label. */
    label: z.string().min(1).max(80).optional(),
    /** Overrides the number format derived from the measure's type. */
    numberFormat: z
      .enum(['brl', 'percent', 'compact', 'integer', 'decimal', 'duration'])
      .optional(),
  }),
]);

export const reportSpecSchema = z.object({
  /** Spec contract version — always 1 today; parse rejects anything else. */
  version: z.literal(1).default(1),
  entity: z.string().min(1),
  /**
   * The tenant's IANA zone for date buckets (FUT-454). Omitted, the host's
   * execution context decides, falling back to `America/Sao_Paulo`.
   */
  timeZone: z.string().min(1).max(64).optional(),
  /**
   * The hour the tenant's trading day begins, 0-23 (FUT-755). Omitted, the
   * host's execution context decides, falling back to midnight. A bar closing
   * at 02:00 sets 5, so Wednesday 00:00-02:00 counts as Tuesday's takings.
   */
  dayStartsAt: z.number().int().min(0).max(23).optional(),
  dimensions: z.array(reportDimensionSchema).max(2).default([]),
  measures: z.array(reportMeasureSchema).min(1).max(10),
  filters: z.array(reportFilterSchema).max(20).default([]),
  sort: z
    .array(z.object({ by: z.string().min(1), direction: z.enum(['asc', 'desc']).default('desc') }))
    .max(3)
    .default([]),
  limit: z.number().int().min(1).max(10_000).optional(),
  presentation: reportPresentationSchema.default({ kind: 'table' }),
});

export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type ReportDimension = z.infer<typeof reportDimensionSchema>;
export type ReportMeasure = z.infer<typeof reportMeasureSchema>;
export type ReportPresentation = z.infer<typeof reportPresentationSchema>;
export type ReportSpec = z.infer<typeof reportSpecSchema>;
export type ReportSpecInput = z.input<typeof reportSpecSchema>;

/** Most blocks a dashboard document may carry (each runs a full report). */
export const DASHBOARD_MAX_BLOCKS = 12;

/**
 * One dashboard block (FUT-306): a REGULAR {@link reportSpecSchema} plus
 * layout metadata. `id` is the block's stable identity — layout edits and
 * per-block render results key on it, so reordering never re-identifies a
 * block. `span` is a 12-column grid width (12 = a full row).
 *
 * The schema accepts the FULL 1..12 range (FUT-391): readability floors are a
 * per-presentation authoring rule (`minSpanForPresentation`), enforced where
 * the author picks the width — not a storage constraint that would make a
 * legitimate narrow KPI strip unsavable.
 */
export const dashboardBlockSchema = z.object({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,40}$/, 'block id must be 1-40 letters, digits, "_" or "-"'),
  title: z.string().min(1).max(120).optional(),
  span: z.number().int().min(1).max(12).default(6),
  /**
   * The block's height as a TIER (FUT-755) — 1, 2 or 3, which the canvas draws
   * as `Baixa`, `Média` and `Alta`. What each is worth on screen is `layout.ts`
   * (`blockHeightCss`): a clamped share of the window rather than a pixel
   * count, so the three stay far enough apart to tell apart on any display.
   *
   * OPTIONAL, with NO default, and that is the whole compatibility story: a
   * block storing no height is as tall as its content, which is what every
   * block saved before this field was and what all of them must go on being. A
   * default here would silently resize every stored report the first time it
   * was parsed.
   */
  height: z.number().int().min(1).max(3).optional(),
  spec: reportSpecSchema,
});

/**
 * A multi-block dashboard document (FUT-306): N independent report specs laid
 * out on a grid, stored in the SAME `SavedReport.spec` column as single
 * reports and discriminated by `kind: "dashboard"` (a single spec has no
 * top-level `kind`).
 */
export const dashboardSpecSchema = z
  .object({
    /** Spec contract version — always 1 today; parse rejects anything else. */
    version: z.literal(1).default(1),
    kind: z.literal('dashboard'),
    blocks: z.array(dashboardBlockSchema).min(1).max(DASHBOARD_MAX_BLOCKS),
  })
  .superRefine((dashboard, issues) => {
    const seen = new Set<string>();
    for (const block of dashboard.blocks) {
      if (seen.has(block.id)) {
        issues.addIssue({
          code: 'custom',
          message: `Duplicate block id "${block.id}". Block ids must be unique within a dashboard.`,
        });
      }
      seen.add(block.id);
    }
  });

/**
 * What a `SavedReport.spec` column may hold: a single report spec (the
 * original contract) or a dashboard document. Prefer
 * {@link parseReportDocument} over parsing this union directly — it branches
 * on `kind` first, so validation errors stay actionable instead of mixing
 * both variants' issues.
 */
export const reportDocumentSchema = z.union([dashboardSpecSchema, reportSpecSchema]);

export type DashboardBlock = z.infer<typeof dashboardBlockSchema>;
export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;
export type ReportDocument = z.infer<typeof reportDocumentSchema>;
export type ReportDocumentInput = z.input<typeof reportDocumentSchema>;

/** Whether an untrusted document value claims to be a dashboard. */
export function isDashboardInput(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === 'dashboard'
  );
}

/** Narrow a parsed document to its dashboard variant. */
export function isDashboardSpec(doc: ReportDocument): doc is DashboardSpec {
  return 'kind' in doc && doc.kind === 'dashboard';
}

/** Every entity a document queries, deduped in block order. */
export function documentEntities(doc: ReportDocument): string[] {
  if (isDashboardSpec(doc)) {
    return [...new Set(doc.blocks.map((block) => block.spec.entity))];
  }
  return [doc.entity];
}

/** Flatten a zod error into one actionable message (LLM-friendly). */
export function describeSpecIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'spec';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
