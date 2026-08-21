import { z } from 'zod';

import { manualPriceRowSchema } from './import/manual';

/**
 * Transport schemas — defined once here so every host's REST routes (and, in
 * Paladira, the MCP tool registry) validate the exact same shapes.
 */

export const researchQuerySchema = z.object({
  term: z.string().trim().min(2).max(200),
  brand: z.string().trim().min(1).max(100).optional(),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/)
    .optional(),
  quantity: z.number().int().min(1).max(100_000).default(1),
  region: z.string().trim().max(20).optional(),
});

export const startResearchSchema = z.object({
  catalogRef: z
    .object({ type: z.string().min(1).max(50), id: z.string().min(1).max(100) })
    .optional(),
  query: researchQuerySchema,
});

export const sourceStatSchema = z.object({
  sourceId: z.string(),
  type: z.string(),
  name: z.string(),
  status: z.enum(['OK', 'CACHED', 'FAILED', 'BUDGET_EXCEEDED', 'SKIPPED']),
  offerCount: z.number().int().min(0),
  ms: z.number().min(0),
  error: z.string().optional(),
  costUnits: z.number().int().min(0).optional(),
  // FUT-491: the source served another region's prices because it does not
  // deliver to the queried one. Optional carrier — `status` stays OK/CACHED.
  outsideDeliveryArea: z.boolean().optional(),
  // FUT-516: the source hit the per-source wall-clock ceiling, so its answer
  // may be short. Another optional carrier beside an unchanged `status`.
  // LOAD-BEARING, not cosmetic: `progress-wire.ts`'s `sourceSettledSchema`
  // parses THROUGH this schema, so a missing field here would silently strip
  // the flag off the realtime row while the run's stored stat array kept it —
  // the streaming chip and the final chip would disagree.
  truncated: z.boolean().optional(),
});

export const offerOutputSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  supplierName: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  imageUrl: z.string().nullable(),
  currency: z.string(),
  priceCents: z.number().int(),
  /**
   * FUT-518: NULL means the source never stated a shipping cost, so
   * `totalCents` below is a MINIMUM and the surface must caveat it; 0 means the
   * source stated FREE. Nullable rather than optional because it is a real
   * column (`supplier_offers.shipping_cents`) that is always selected — absent
   * would mean "the read forgot it", which is a different bug.
   */
  shippingCents: z.number().int().nullable(),
  packQuantity: z.number().int(),
  unitPriceCents: z.number().int(),
  /** Cost of the whole packs needed PLUS stated shipping — a LOWER BOUND when
   *  `shippingCents` is null (FUT-518). */
  totalCents: z.number().int(),
  availability: z.string().nullable(),
  etaDays: z.number().int().nullable(),
  relevanceScore: z.number().min(0).max(1),
  rank: z.number().int().nullable(),
  expiresAt: z.string().nullable(),
  /**
   * FUT-491: this price is the store's DEFAULT region's, because the store
   * does not deliver to the queried CEP. Always present on the wire (the
   * column defaults to false), so a surface can render the caveat badge
   * without guessing.
   */
  outsideDeliveryArea: z.boolean(),
  /**
   * FUT-497: a single-unit claim at many times the run's median unit price —
   * an unparsed multipack, so the per-unit number must be read with care.
   * OPTIONAL on the wire, unlike the caveat above: it is derived from the
   * result set rather than stored, so absent legitimately means both "not
   * flagged" and "this run was too small to judge".
   */
  suspectUnitPrice: z.boolean().optional(),
});

export type StartResearchInput = z.infer<typeof startResearchSchema>;
export type ResearchQueryInput = z.infer<typeof researchQuerySchema>;
export type OfferOutput = z.infer<typeof offerOutputSchema>;

/**
 * View and body schemas for the HTTP surface `./http` declares — moved here
 * from the origin host's tool registry so every host of the engine (and its
 * REST + MCP surfaces) validates the exact same shapes. Field-for-field the
 * envelopes the origin host's clients already read.
 */

/** Path params, host-mount vocabulary included (the report-builder shape). */
export const researchCollectionParams = z.object({ tenantSlug: z.string().min(1) });
export const researchRequestParams = z.object({
  tenantSlug: z.string().min(1),
  requestId: z.string().min(1),
});
export const researchRunParams = z.object({
  tenantSlug: z.string().min(1),
  runId: z.string().min(1),
});
export const researchSourceParams = z.object({
  tenantSlug: z.string().min(1),
  sourceId: z.string().min(1),
});

const latestRunSchema = z.object({
  id: z.string(),
  status: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

/** One research request with its latest run — the poll target. */
export const researchRequestViewSchema = z.object({
  id: z.string(),
  term: z.string(),
  brand: z.string().nullable(),
  ean: z.string().nullable(),
  quantity: z.number().int(),
  region: z.string().nullable(),
  /** The catalog entry the research was started from, when there was one —
   *  what a repeat of this request re-sends. */
  catalogRef: z.object({ type: z.string(), id: z.string() }).nullable(),
  createdAt: z.string(),
  latestRun: latestRunSchema.nullable(),
});

/** One run: status, per-source stats, and the ranked offers. */
export const researchRunViewSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  status: z.string(),
  sourceStats: z.array(sourceStatSchema),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  offers: z.array(offerOutputSchema),
});

export const researchPaginationSchema = z.object({
  total: z.number().int(),
  pageCount: z.number().int(),
  hasNextPage: z.boolean(),
});

/**
 * Body for importing a manual price list: structured rows (a UI mapping step
 * or XLSX parsed client-side) OR raw CSV text with optional column mapping.
 * `replace` defaults to true — re-importing an updated list replaces the
 * source's previous entries rather than stacking a second copy.
 */
export const importManualPricesBody = z
  .object({
    rows: z.array(manualPriceRowSchema).max(5000).optional(),
    csv: z
      .object({
        content: z.string().min(1).max(2_000_000),
        delimiter: z.string().length(1).optional(),
        mapping: z
          .object({
            title: z.string().optional(),
            price: z.string().optional(),
            supplierName: z.string().optional(),
            brand: z.string().optional(),
            ean: z.string().optional(),
            packQuantity: z.string().optional(),
            validUntil: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    replace: z.boolean().default(true),
    /** Default validity (ISO date) for rows without one; 7 days when absent. */
    validUntil: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: 'Data de validade inválida.',
      })
      .optional(),
    /** Supplier for rows without one; the source's name when absent. */
    defaultSupplierName: z.string().trim().min(1).max(160).optional(),
  })
  .refine((body) => body.rows !== undefined || body.csv !== undefined, {
    message: 'Envie rows ou csv.',
  });

/** Body for a one-off typed quote (phone/WhatsApp) — one row, appended. */
export const addManualQuoteBody = manualPriceRowSchema;

const rowProblemSchema = z.object({ line: z.number().int(), reason: z.string() });

/** What both manual-price writes answer with. */
export const importResultSchema = z.object({
  imported: z.number().int(),
  problems: z.array(rowProblemSchema),
  batchId: z.string(),
  replaced: z.boolean(),
});

/** One stored manual price entry, as the roster reads it. */
export const manualPriceViewSchema = z.object({
  id: z.string(),
  supplierName: z.string(),
  title: z.string(),
  brand: z.string().nullable(),
  ean: z.string().nullable(),
  packQuantity: z.number().int().nullable(),
  priceCents: z.number().int(),
  currency: z.string(),
  url: z.string().nullable(),
  availability: z.string().nullable(),
  etaDays: z.number().int().nullable(),
  validUntil: z.string(),
  createdAt: z.string(),
});

export const listManualPricesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
