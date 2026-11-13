/**
 * The canonical shape every marketplace adapter normalizes INTO.
 *
 * This type is the seam. The engine below it knows no marketplace by name: a
 * marketplace is an adapter registered with the engine (`./adapter`), and the
 * provider id is whatever that adapter says it is. A second marketplace is a
 * second adapter, never a second pipeline, a second acceptance clock or a
 * second idea of what an order is.
 *
 * Deliberately POORER than any marketplace's own payload. Everything a store
 * operates on is here; everything else stays in the inbox row's raw `payload`,
 * which is where a normalization bug is reconstructed from.
 */

/**
 * A marketplace's id, as its adapter declares it (`"IFOOD"`). Uppercase
 * letters, digits and underscores; the migration's CHECK holds the same shape.
 * A string rather than a closed union, because the set of marketplaces is the
 * set of registered adapters, and a union would make a new one a code change
 * in the engine.
 */
export type MarketplaceProvider = string;

/** The shape a provider id must have. Shared by the registry and the CHECK. */
export const PROVIDER_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

/** One line of an incoming order, before it is resolved against the catalog. */
export interface NormalizedOrderLine {
  /** The marketplace's own SKU — the key the SKU map is matched on. */
  externalSku: string;
  /** What the marketplace called it. Snapshotted, and the fallback line text. */
  name: string;
  quantity: number;
  /**
   * Unit price in the smallest currency unit AS THE MARKETPLACE STATES IT. A
   * marketplace's menu carries its own prices, and the buyer's receipt is the
   * marketplace's one: re-pricing from the host's catalog would produce a
   * total nobody was charged.
   */
  unitPriceCents: number;
  /** The buyer's note on this line, when they left one. */
  note: string | null;
}

/** The buyer, as much of them as the marketplace discloses. */
export interface NormalizedBuyer {
  /** The marketplace's own stable id for this customer, when it gives one. */
  externalId: string | null;
  name: string | null;
  phone: string | null;
}

/** Where a delivery goes, as much of it as the marketplace states. */
export interface NormalizedAddress {
  street: string;
  number: string;
  neighborhood: string;
  complement: string | null;
  /** The sentence that finds the door. */
  reference: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
}

/** How the order reaches the buyer: brought to the door, or collected. */
export type MarketplaceOrderType = "DELIVERY" | "TAKEOUT";

/** WHO carries a delivery: the merchant's own courier, or the marketplace's fleet. */
export type MarketplaceDeliveredBy = "MERCHANT" | "MARKETPLACE";

/** An incoming marketplace order, normalized. */
export interface NormalizedMarketplaceOrder {
  provider: MarketplaceProvider;
  /** The marketplace's order id — THE idempotency key for the whole pipeline. */
  externalOrderId: string;
  /** The short code the courier and the buyer say out loud. */
  externalDisplayId: string | null;
  buyer: NormalizedBuyer;
  lines: NormalizedOrderLine[];
  /**
   * What the buyer paid, gross. NOT derived from the lines when the
   * marketplace states it: its total carries fees, promotions and rounding the
   * line sum does not, and the number that must match the receipt is this one.
   */
  totalCents: number;
  /** The marketplace's cut, when it states one. NULL is "did not say", not 0. */
  commissionCents: number | null;
  /** The marketplace's own promise to the buyer. */
  deliveryDueAt: Date | null;
  /** When the marketplace says the order was placed. */
  placedAt: Date;
  /** Null when the payload does not say. */
  orderType?: MarketplaceOrderType | null;
  /** Null on a take-out and when unstated. */
  deliveredBy?: MarketplaceDeliveredBy | null;
  /** Null on a take-out and when unstated. */
  deliveryAddress?: NormalizedAddress | null;
}

/**
 * What an event says about the STORE's own cancellation request: `CONFIRMED`
 * when the marketplace cancelled the order (a pending request is answered),
 * `FAILED` when it refused the request.
 */
export type CancellationOutcome = "CONFIRMED" | "FAILED";

/** What an adapter makes of one inbound delivery. */
export interface NormalizedEvent {
  provider: MarketplaceProvider;
  /** The delivery's own id — the inbox dedup key, paired with the provider. */
  eventId: string;
  /** The provider's event type verbatim, kept for the inbox row and the log. */
  eventType: string;
  /** The merchant this event names, used to attribute it to a tenant. */
  externalMerchantId: string | null;
  externalOrderId: string | null;
  /**
   * The order this event carries, or null when the event is one the engine
   * understands and does not ingest. A null here is an IGNORED inbox row (or a
   * cancellation, below), never a failure.
   */
  order: NormalizedMarketplaceOrder | null;
  /** The marketplace has CANCELLED the order. */
  cancelled: boolean;
  /**
   * The answer to the store's own cancellation request, when this event is
   * one. A `cancelled: true` event reads as `CONFIRMED` when this is absent.
   */
  cancellationOutcome?: CancellationOutcome | null;
  /**
   * OPTIONAL. This event announces an order whose body the marketplace serves
   * separately (Open Delivery's `CREATED` carries only the order's id): the
   * engine fetches it through the adapter's `fetchOrder`, in the
   * `marketplace.fetch-order` job, never inside the request that delivered
   * the event. Ignored when `order` is present.
   */
  orderToFetch?: boolean;
}
