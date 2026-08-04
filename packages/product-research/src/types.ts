/** By-value pointer to a host catalog record — never a foreign key. */
export interface CatalogRef {
  type: string;
  id: string;
}

/** What the host's catalog knows about an item, in connector-usable terms. */
export interface CatalogItem {
  ref: CatalogRef;
  name: string;
  brand?: string;
  ean?: string;
  /** Free-form pack descriptor as the catalog spells it, e.g. "Lata 350ml". */
  packSize?: string;
}

/** A search a buyer asked for. `region` is a CEP in the Brazilian host. */
export interface ResearchQuery {
  term: string;
  brand?: string;
  ean?: string;
  quantity: number;
  region?: string;
}

/**
 * What a connector returns before normalization. Prices are integer cents in
 * `currency`; anything the connector cannot determine stays undefined and the
 * pipeline fills what it can (pack from the title) or drops the offer (no
 * price). `raw` is kept verbatim so parser fixes can be replayed offline.
 */
export interface RawOffer {
  supplierName: string;
  title: string;
  url?: string;
  imageUrl?: string;
  ean?: string;
  currency?: string;
  priceCents?: number;
  /**
   * TRI-STATE, and the distinction is load-bearing (FUT-518): `undefined` = the
   * source never stated a shipping cost, `0` = the source stated FREE, `n` = the
   * source stated `n`. Until FUT-518 the pipeline coalesced undefined to 0, so
   * an offer whose freight nobody knew was ranked as though freight were free —
   * and `serp.ts` states it never, which made that every Google Shopping offer.
   * Same doctrine as `outsideDeliveryArea` below (FUT-491): keep the unknown
   * visible instead of inventing a number for it.
   */
  shippingCents?: number;
  packQuantity?: number;
  availability?: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  etaDays?: number;
  /**
   * Connector-known freshness horizon (e.g. a manual price list's validity
   * date). When absent the pipeline applies its TTL-based default; when
   * present the EARLIER of the two wins — an offer must never advertise
   * freshness beyond what its source promised.
   */
  expiresAt?: Date;
  /**
   * The store does NOT deliver to the region the buyer asked about, and this
   * price is its default region's (FUT-491). Information beats silence — the
   * offer is ranked on its unit price like any other, and every surface that
   * shows it must caveat that it may not be deliverable to this CEP. Absent
   * (the normal case) means the price applies to the buyer's own region.
   */
  outsideDeliveryArea?: boolean;
  raw?: unknown;
}

/** A normalized, scored, rankable offer — the shape the store persists. */
export interface ScoredOffer {
  sourceId: string | null;
  sourceType: string;
  supplierName: string;
  title: string;
  url?: string;
  imageUrl?: string;
  currency: string;
  priceCents: number;
  /** Carried from `RawOffer.shippingCents` — see there (FUT-518). Absent means
   *  the source never said, so `totalCents` below is a FLOOR, not a price. */
  shippingCents?: number;
  packQuantity: number;
  unitPriceCents: number;
  /**
   * Cost of enough whole packs to cover the requested quantity, PLUS whatever
   * shipping the source stated. When `shippingCents` is absent this is a LOWER
   * BOUND on what the buyer will pay (FUT-518) — the ranking says so in
   * `ranking/rank.ts` and every surface that renders it must caveat it.
   */
  totalCents: number;
  availability?: string;
  etaDays?: number;
  relevanceScore: number;
  rank?: number;
  raw?: unknown;
  expiresAt?: Date;
  /** Carried from `RawOffer.outsideDeliveryArea` — see there (FUT-491). */
  outsideDeliveryArea?: boolean;
  /**
   * This offer claims ONE unit at a price many times the run's median unit
   * price, so it is almost certainly an unparsed multipack (FUT-497). Derived
   * from the whole result set — see `ranking/plausibility.ts` — never stored:
   * absent means "not flagged", which also covers a run too small to judge.
   */
  suspectUnitPrice?: boolean;
}

export type SourceType = 'VTEX' | 'MERCADO_LIVRE' | 'SERP' | 'AMAZON' | 'MANUAL';

/** A tenant's configured source row, as the store hands it to the pipeline. */
export interface SourceRecord {
  id: string;
  clientId: string;
  type: SourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  status: 'ACTIVE' | 'DEGRADED';
}

/** Per-source outcome recorded on the run — drives the streaming status row. */
export interface SourceStat {
  sourceId: string;
  type: string;
  name: string;
  status: 'OK' | 'CACHED' | 'FAILED' | 'BUDGET_EXCEEDED' | 'SKIPPED';
  offerCount: number;
  ms: number;
  error?: string;
  /**
   * Paid vendor calls this source consumed against the budget in THIS run —
   * the per-run cost metric. Only present for paid source types: 1 when a
   * vendor call was made (even one that then failed — the budget unit is
   * spent), 0 when the cache or the budget gate answered instead.
   */
  costUnits?: number;
  /**
   * The source answered with another region's prices because it does not
   * deliver to the queried one (FUT-491). A carrier flag, NOT a status: the
   * source succeeded, so `status` stays OK/CACHED and the status union is
   * unchanged — the UI reads this to say "outra região" beside the count.
   */
  outsideDeliveryArea?: boolean;
  /**
   * This source hit the per-source wall-clock ceiling (`ResearchConfig.
   * sourceBudgetMs`, FUT-516) and stopped mid-fan-out.
   * A carrier flag, NOT a status — the same argument `outsideDeliveryArea`
   * above makes: widening the status union would touch every reader for a fact
   * that is orthogonal to whether the source answered.
   *
   * - `OK`/`CACHED` + truncated — usable but possibly SHORT: the connector
   *   unwound naturally and kept what it already had, so the offers are real,
   *   there may be fewer of them, and any later tier it never reached (VTEX's
   *   delivery simulation, an EAN→text fallback) made no claim at all.
   * - `FAILED` + truncated — the ceiling arrived before anything came back.
   *
   * The source is NEVER marked DEGRADED for it: what we observed is our own
   * fan-out running out of time, not the store failing.
   */
  truncated?: boolean;
}

export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface RunResult {
  runId: string;
  status: RunStatus;
  offers: ScoredOffer[];
  sourceStats: SourceStat[];
}
