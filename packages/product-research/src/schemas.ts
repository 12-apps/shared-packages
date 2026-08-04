import { z } from 'zod';

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
