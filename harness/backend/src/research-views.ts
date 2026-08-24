/**
 * The two research VIEWS, in one place — because both halves of this host read
 * them and they have to be the same shape.
 *
 * The package's own note on the store seam is that "views come back exactly as
 * the host's clients read them; the package never reshapes rows", which sounds
 * like freedom and is actually an obligation: `@12-apps/product-research-ui`
 * renders `ResearchRequestView` and `ResearchRunView` FIELD BY FIELD, so a host
 * whose store answers a smaller shape gets screens that render `undefined` and
 * a package that cannot tell it. There is no type error between the two — the
 * seam is typed `Promise<unknown>` precisely so a host can answer its own
 * shape.
 *
 * So the mapping lives here and nowhere else, and both the store's `view` and
 * the host's own history listing go through it. That is the whole reason the
 * listing is mounted in this harness rather than skipped: it is the ONE route
 * where a host writes the wire shape by hand, next to a package route that
 * writes the same shape from the same rows, and the two disagreeing is exactly
 * the bug a consumer harness exists to find.
 */
import type { ResearchRequestView, ResearchRunView } from '@12-apps/product-research-ui';

/** Every column the request view needs, aliased to its wire name. */
export const REQUEST_VIEW_COLUMNS = `r.id, r.term, r.brand, r.ean, r.quantity, r.region,
    r.catalog_ref_type AS "catalogRefType", r.catalog_ref_id AS "catalogRefId",
    r.created_at AS "createdAt",
    run.id AS "runId", run.status AS "runStatus",
    run.started_at AS "runStartedAt", run.finished_at AS "runFinishedAt"`;

/** The join that carries the LATEST run onto a request row. */
export const LATEST_RUN_JOIN = `LEFT JOIN LATERAL (
    SELECT id, status, started_at, finished_at
      FROM research_runs
     WHERE request_id = r.id
     ORDER BY created_at DESC
     LIMIT 1
  ) run ON true`;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toRequestView(row: Record<string, unknown>): ResearchRequestView {
  const runId = row['runId'];
  return {
    id: String(row['id']),
    term: String(row['term']),
    brand: (row['brand'] as string | null) ?? null,
    ean: (row['ean'] as string | null) ?? null,
    quantity: Number(row['quantity']),
    region: (row['region'] as string | null) ?? null,
    // Both halves or neither: a ref with a type and no id is not a pointer.
    catalogRef:
      row['catalogRefType'] && row['catalogRefId']
        ? { type: String(row['catalogRefType']), id: String(row['catalogRefId']) }
        : null,
    createdAt: iso(row['createdAt']) ?? '',
    // `null` is what the run screen polls ON: the 202 cannot carry a run id
    // because the run is created by the host's background job, so the screen
    // waits here until one appears.
    latestRun:
      typeof runId === 'string'
        ? {
            id: runId,
            status: String(row['runStatus']),
            startedAt: iso(row['runStartedAt']),
            finishedAt: iso(row['runFinishedAt']),
          }
        : null,
  };
}

export function toRunView(
  row: Record<string, unknown>,
  offers: Record<string, unknown>[],
): ResearchRunView {
  return {
    id: String(row['id']),
    requestId: String(row['requestId']),
    status: String(row['status']),
    sourceStats: (row['sourceStats'] ?? []) as ResearchRunView['sourceStats'],
    error: (row['error'] as string | null) ?? null,
    startedAt: iso(row['startedAt']),
    finishedAt: iso(row['finishedAt']),
    offers: offers.map((offer) => ({
      ...offer,
      expiresAt: iso(offer['expiresAt']),
    })) as ResearchRunView['offers'],
  };
}

/** Every offer column the ranked table reads, aliased to its wire name. */
export const OFFER_VIEW_COLUMNS = `id, source_id AS "sourceId", source_type AS "sourceType",
    supplier_name AS "supplierName", title, url, image_url AS "imageUrl", currency,
    price_cents AS "priceCents", shipping_cents AS "shippingCents",
    pack_quantity AS "packQuantity", unit_price_cents AS "unitPriceCents",
    total_cents AS "totalCents", availability, eta_days AS "etaDays",
    relevance_score AS "relevanceScore", rank, expires_at AS "expiresAt",
    outside_delivery_area AS "outsideDeliveryArea"`;
