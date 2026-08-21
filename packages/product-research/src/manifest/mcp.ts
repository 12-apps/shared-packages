/**
 * The package's OWN MCP tool declarations (the report-builder shape): the
 * research operations whose whole wire contract this package states —
 * schemas from `../schemas`, paths RELATIVE to the http mount, behavior
 * annotations as the package-supplied DEFAULTS a host's audited policy table
 * may override.
 *
 * Deliberately NOT every route `./http` declares. The source-roster and
 * integration tools stay host-authored: their response shapes carry the
 * host's connector roster views, and the history LISTING's query grammar is
 * derived from the host's own search-grid config — a declaration here could
 * only restate that config or drift from it. Host-built tools join the
 * assembled surface through the adoption's `mcpEndpoints` extension, exactly
 * as the contract documents for vocabulary-dependent factories.
 */

import { z } from 'zod';

import {
  addManualQuoteBody,
  importManualPricesBody,
  importResultSchema,
  listManualPricesQuery,
  manualPriceViewSchema,
  researchCollectionParams,
  researchPaginationSchema,
  researchRequestParams,
  researchRequestViewSchema,
  researchRunParams,
  researchRunViewSchema,
  researchSourceParams,
  startResearchSchema,
} from '../schemas';

/** Structural twin of the wiring contract's `WireMcpTool<z.ZodType>`. */
export interface ResearchMcpTool {
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** OpenAPI `{param}` template, relative to the http mount. */
  path: string;
  summary: string;
  tags?: readonly string[];
  query?: z.ZodType;
  params?: z.ZodType;
  body?: z.ZodType;
  status?: number;
  response?: z.ZodType;
  annotations?: { title?: string; readOnly?: boolean; destructive?: boolean; openWorld?: boolean };
}

const data = (schema: z.ZodType): z.ZodType => z.object({ data: schema });

/** The tools, mount-relative — the form the shared manifest carries. */
export const PRODUCT_RESEARCH_MCP_TOOLS: readonly ResearchMcpTool[] = [
  {
    operationId: 'startResearch',
    method: 'POST',
    path: '/research',
    summary:
      'Start a product research (admin): search the store\'s enabled price sources for the term (plus optional brand, EAN and CEP region), normalize pack sizes, and rank offers cheapest-first for the requested quantity. Runs in the background: poll getResearchRequest with the returned requestId until latestRun appears, then getResearchRun for the ranked offers — which accumulate while the run is RUNNING, so a non-empty list does not mean the search finished; only status COMPLETED does. If `enqueued` is false the queue was unavailable; a reconciliation sweep re-enqueues the request within ~10 minutes.',
    tags: ['research'],
    params: researchCollectionParams,
    body: startResearchSchema,
    status: 202,
    response: data(z.object({ requestId: z.string(), enqueued: z.boolean() })),
    // Spends outbound calls (and, with a paid connector, budget) beyond the
    // host's own data — additive, never destructive.
    annotations: { openWorld: true },
  },
  {
    operationId: 'getResearchRequest',
    method: 'GET',
    path: '/research/requests/{requestId}',
    summary:
      'Read one product-research request with its latest run (admin). The poll target after startResearch: `latestRun` is null until the background job creates the run, then carries the runId to pass to getResearchRun.',
    tags: ['research'],
    params: researchRequestParams,
    response: data(researchRequestViewSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: 'getResearchRun',
    method: 'GET',
    path: '/research/runs/{runId}',
    summary:
      'Read one research run (admin): status, per-source stats (OK | CACHED | FAILED | BUDGET_EXCEEDED | SKIPPED with timings), and the ranked offers — unit price, whole-pack total for the requested quantity, relevance and buy link. While status is RUNNING the offers found so far are already returned, in final cheapest-first order but with `rank` null and no `suspectUnitPrice` caveat: both are computed over the whole run, so they are final only once status is COMPLETED (or FAILED).',
    tags: ['research'],
    params: researchRunParams,
    response: data(researchRunViewSchema),
    annotations: { readOnly: true },
  },
  {
    operationId: 'listManualPrices',
    method: 'GET',
    path: '/research/sources/{sourceId}/prices',
    summary:
      'List the manually imported price entries of a MANUAL research source (admin), paginated and ordered by product title. Each entry carries its validity date — expired entries stay listed here for audit but no longer appear in new research results.',
    tags: ['research'],
    params: researchSourceParams,
    query: listManualPricesQuery,
    response: z.object({
      data: z.array(manualPriceViewSchema),
      pagination: researchPaginationSchema,
    }),
    annotations: { readOnly: true },
  },
  {
    operationId: 'importManualPrices',
    method: 'POST',
    path: '/research/sources/{sourceId}/prices',
    summary:
      "Import a price list into a MANUAL research source (admin): structured rows or raw CSV (PT-BR headers auto-detected; explicit column mapping supported; 'R$ 1.234,56'-style prices parsed to cents). Replaces the source's previous list by default. Unimportable rows are returned in `problems` with their line numbers — never dropped silently. Imported prices compete in ranked research results until their validity date.",
    tags: ['research'],
    params: researchSourceParams,
    body: importManualPricesBody,
    response: data(importResultSchema),
  },
  {
    operationId: 'addManualQuote',
    method: 'POST',
    path: '/research/sources/{sourceId}/quotes',
    summary:
      'Record a one-off quote (phone/WhatsApp) on a MANUAL research source (admin): one product row with price, optional pack/EAN/link/ETA and validity (7 days when omitted). Appends without touching the imported list.',
    tags: ['research'],
    params: researchSourceParams,
    body: addManualQuoteBody,
    response: data(importResultSchema),
  },
];

export interface ResearchMcpConfig {
  /** `'/api/admin/{tenantSlug}'` — the http mount, `{param}` form. */
  basePath: string;
}

/**
 * The tools absolutized for a host wiring by hand; hosts adopting through
 * `@12-apps/wiring` never call this — the consumer absolutizes the
 * manifest's tools from the http binding's own `mountPath`, so the tool
 * URLs and the route URLs cannot drift apart.
 */
export function productResearchMcpTools(config: ResearchMcpConfig): readonly ResearchMcpTool[] {
  const prefix = config.basePath.endsWith('/') ? config.basePath.slice(0, -1) : config.basePath;
  return PRODUCT_RESEARCH_MCP_TOOLS.map((tool) => ({ ...tool, path: `${prefix}${tool.path}` }));
}
