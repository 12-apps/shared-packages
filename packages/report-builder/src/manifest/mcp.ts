/**
 * The package's OWN MCP tool declarations (12-27) — every reports endpoint,
 * declared once, beside the descriptors they proxy to.
 *
 * These used to be a ~150-line hand-written registry file in each host,
 * restating paths the descriptors already state and schemas `/server` already
 * exports. What is genuinely the package's is ALL of it: the operation, the
 * wire schemas, the behavior annotations, and the mechanics each summary
 * explains. What stays the host's is narrowing (its own preset-key enum, a
 * richer summary) — supplied as OVERRIDES at adoption, never by forking this
 * list — and the audited tool policy its own gates enforce, for which the
 * annotations here are the package-supplied DEFAULTS.
 *
 * Paths are RELATIVE to the http mount, exactly like the route descriptors.
 * `@12-apps/wiring`'s consumer absolutizes them from the adoption's
 * `mountPath`; a host wiring by hand calls {@link reportBuilderMcpTools} with
 * its base path and exports the result — the whole registry file:
 *
 *     export const endpoints =
 *       reportBuilderMcpTools({ basePath: '/api/admin/{tenantSlug}' });
 */

import { z } from 'zod';
import type { WireMcpTool } from '@12-apps/wiring';

import type { ReportRangeMessages } from '../server/messages';

import {
  fieldListingSchema,
  REPORT_MAX_RANGE_DAYS,
  REPORT_RUN_MAX_ROWS,
  reportRangeQuery,
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
} from '../server/index';

const data = (schema: z.ZodType): z.ZodType => z.object({ data: schema });

/**
 * The date-range refusals the MCP schemas carry.
 *
 * ENGLISH, and deliberately not the host's pack. This manifest is a static
 * declaration consumed by `@12-apps/wiring`, and its audience is the AGENT
 * reading the tool schema before it calls — a developer-facing contract, not
 * the store owner's screen. The pt-BR a person actually reads comes from the
 * route, which answers with `config.messages`; these are what an agent is told
 * about the shape of an argument it got wrong.
 *
 * Being module-scope English is what keeps the manifest static, which
 * `manifest/index.ts` requires: a factory here would have to be threaded
 * through the wiring manifest for no gain to any reader.
 */
const MCP_RANGE_MESSAGES = {
  datesRequired: 'Provide both `from` and `to` for a custom range.',
  invalidDate: 'Not a valid calendar date.',
  endBeforeStart: '`to` must be the same day as `from` or later.',
  tooLong: (maxDays: number) => `The range may not exceed ${maxDays} days.`,
  isoFormat: 'Use the format YYYY-MM-DD.',
  customNeedsBothDates: 'Provide both `from` and `to` for a custom range.',
} satisfies ReportRangeMessages;

/** The tools, mount-relative — the form the shared manifest carries. */
export const REPORT_BUILDER_MCP_TOOLS: readonly WireMcpTool<z.ZodType>[] = [
  {
    operationId: 'listSystemReports',
    method: 'GET',
    path: '/reports/system',
    summary:
      "The host's built-in (system) reports the caller may run — each a fixed, named view the host declared. Reports whose permission the caller lacks are omitted; run one with getSystemReport.",
    tags: ['reports'],
    params: reportsParams,
    response: data(z.object({ reports: z.array(systemReportSummarySchema) })),
    annotations: { readOnly: true },
  },
  {
    operationId: 'getSystemReport',
    method: 'GET',
    path: '/reports/system/{key}',
    summary:
      'Run a built-in report for a period and get its rendered result: a table model (columns with format hints + rows) or a chart spec. Pick the window with `preset` (today | 7d | 30d | custom with inclusive from/to `YYYY-MM-DD`, max ' +
      `${REPORT_MAX_RANGE_DAYS} days); reports that support it bucket dates by \`grain\` (day | week | month). Money values are integer cents.`,
    tags: ['reports'],
    params: systemReportParams,
    query: reportRangeQuery(MCP_RANGE_MESSAGES),
    response: data(systemReportResultSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: 'listReportFields',
    method: 'GET',
    path: '/reports/fields',
    summary:
      "The field catalog a custom ReportSpec may query: the host's entities with their dimensions/measures, types and allowed aggregations — narrowed to what the caller's permissions reach. Each entity carries `starter`, a known-good runnable spec: copy and adapt it instead of authoring from scratch. Call this FIRST when authoring; specs naming anything outside this catalog are rejected. Presentation rules: charts need exactly 1 dimension (pie/donut also exactly 1 measure); kind 'kpi' needs 0 dimensions and exactly 1 measure.",
    tags: ['reports'],
    params: reportsParams,
    response: data(fieldListingSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: 'runReport',
    method: 'POST',
    path: '/reports/run',
    summary:
      'Dry-run a custom ReportSpec for a period without saving it: validates the spec against the field catalog, executes it tenant-scoped, and returns the rendered result. Spec shape: { entity, dimensions[{field,timeGrain?}] (max 2), measures[{field,aggregation?,alias?}], filters, sort, limit, presentation }. Money is integer cents; rows are capped at ' +
      `${REPORT_RUN_MAX_ROWS}. Invalid specs return a 400 whose error message lists what IS available — read it and correct the spec.`,
    tags: ['reports'],
    params: reportsParams,
    body: runReportBody(MCP_RANGE_MESSAGES),
    response: data(runResultSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: 'listSavedReports',
    method: 'GET',
    path: '/reports/custom',
    summary:
      "The saved reports the caller may SEE (drafts are author+admin-only; published documents follow their visibility: tenant | roles allowlist | private), narrowed to documents whose every entity the caller's permissions reach. Open one with getSavedReport.",
    tags: ['reports'],
    params: reportsParams,
    response: data(z.object({ reports: z.array(savedReportSummarySchema) })),
    annotations: { readOnly: true },
  },
  {
    operationId: 'saveReport',
    method: 'POST',
    path: '/reports/custom',
    summary:
      "Save a report: a name (unique per tenant), an optional description and a spec. Prefer the dashboard document — { kind: 'dashboard', blocks: [{ id, title?, span? (1-12 of a 12-column canvas), spec: ReportSpec }] }, up to 12 blocks; a bare single ReportSpec is accepted and opens as a one-block report. Every block validates against the field catalog, exactly like runReport. Optional lifecycle: status draft|published|archived and visibility tenant|roles|private ('roles' takes visibilityRoles, role ids the host's roles endpoint lists). Duplicate names are a 409; dry-run each block with runReport first.",
    tags: ['reports'],
    params: reportsParams,
    body: saveReportBody,
    response: data(savedReportSummarySchema),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: 'getSavedReport',
    method: 'GET',
    path: '/reports/custom/{id}',
    summary:
      "Open one saved document and run it for a period. A dashboard runs every block in parallel and returns per-block renders (a stale block yields an inline error instead of failing the report); a legacy single report returns the stored spec plus its result. Requires the permission tier of every entity the document queries; a draft, archived or out-of-visibility document is a 404 for anyone but its author and admins.",
    tags: ['reports'],
    params: savedReportParams,
    query: reportRangeQuery(MCP_RANGE_MESSAGES),
    response: data(savedReportViewSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: 'updateSavedReport',
    method: 'PUT',
    path: '/reports/custom/{id}',
    summary:
      "Replace a saved document's name, description and spec; optional status/visibility/visibilityRoles change its lifecycle — this is also how a report is archived (status 'archived') or restored (status 'published') — and OMITTED lifecycle fields keep their stored values. The spec re-validates against the field catalog; an id outside this tenant is a 404.",
    tags: ['reports'],
    params: savedReportParams,
    body: saveReportBody,
    response: data(savedReportSummarySchema),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: 'deleteSavedReport',
    method: 'DELETE',
    path: '/reports/custom/{id}',
    summary:
      "Permanently delete a saved report. Prefer archiving (updateSavedReport with status 'archived'), which retires it from the picker and can be undone. An id outside this tenant is a 404.",
    tags: ['reports'],
    params: savedReportParams,
    status: 204,
    annotations: { readOnly: false, destructive: true },
  },
  {
    operationId: 'saveReportWorkingCopy',
    method: 'PUT',
    path: '/reports/custom/{id}/working-copy',
    summary:
      "Park an in-progress edit of a PUBLISHED report as its working copy — the editor's autosave. Validated for SHAPE only, deliberately not compiled against the field catalog: a mid-edit spec is legitimately incomplete, and the compile happens on publish, where it decides something. The published document is untouched. A draft or archived document is a 400 (those save directly with updateSavedReport); an id outside this tenant is a 404.",
    tags: ['reports'],
    params: savedReportParams,
    body: reportWorkingCopySchema,
    response: data(z.object({ saved: z.boolean() })),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: 'publishReportWorkingCopy',
    method: 'POST',
    path: '/reports/custom/{id}/working-copy/publish',
    summary:
      "Publish an edit of a published report: the body — the editor's CURRENT state, not whatever the last autosave stored — becomes the live document and the parked working copy is dropped, in one write. Every block compiles against the field catalog first, exactly like saveReport; a name colliding with another report is a 409.",
    tags: ['reports'],
    params: savedReportParams,
    body: reportWorkingCopySchema,
    response: data(savedReportSummarySchema),
    annotations: { readOnly: false, destructive: false },
  },
  {
    operationId: 'discardReportWorkingCopy',
    method: 'DELETE',
    path: '/reports/custom/{id}/working-copy',
    summary:
      'Throw away a report’s parked working copy; the published document is never touched. A document with NOTHING parked is a 404 rather than a silent success — a discard that discarded nothing would tell the editor to reset to a version it is already showing.',
    tags: ['reports'],
    params: savedReportParams,
    response: data(z.object({ discarded: z.boolean() })),
    annotations: { readOnly: false, destructive: true },
  },
];

/** Where the reports surface hangs, in OpenAPI `{param}` form. */
export interface ReportBuilderMcpConfig {
  /** The http mount prefix — `/api/admin/{tenantSlug}` — WITHOUT `/reports`. */
  basePath: string;
}

/**
 * The tools with absolute paths — the whole hand-wired registry file:
 *
 *     export const endpoints =
 *       reportBuilderMcpTools({ basePath: '/api/admin/{tenantSlug}' });
 *
 * Hosts adopting through `@12-apps/wiring` never call this: the consumer
 * absolutizes the manifest's tools from the http binding's own `mountPath`,
 * so the tool URLs and the route URLs cannot drift apart.
 */
export function reportBuilderMcpTools(
  config: ReportBuilderMcpConfig,
): readonly WireMcpTool<z.ZodType>[] {
  const prefix = config.basePath.endsWith('/') ? config.basePath.slice(0, -1) : config.basePath;
  return REPORT_BUILDER_MCP_TOOLS.map((tool) => ({ ...tool, path: `${prefix}${tool.path}` }));
}
