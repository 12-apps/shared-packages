/**
 * The order-side vocabulary the host's order port speaks: what a resolved line
 * is, what the queue shows, what a person stated, and why an order or a
 * cancellation ended. Plain data with no engine dependency; `./ports`
 * re-exports every name, so a host imports them from there as before.
 */

/**
 * One order line after the engine has matched it against the SKU map.
 * `subjectRef` is the host catalog id, or null when the SKU was never mapped —
 * never an error, and never a reason to refuse the order. `variationRef` is
 * the variation of `subjectRef` the SKU was mapped to (FUT-4927), or null for
 * the item alone and for every unmapped line.
 */
export interface ResolvedOrderLine {
  externalSku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  note: string | null;
  subjectRef: string | null;
  variationRef: string | null;
}

/** What the acceptance queue shows about an order, resolved by the host. */
export interface MarketplaceOrderSummary {
  buyerName: string | null;
  totalCents: number;
  unmappedLines: number;
  createdAt: string | null;
}

/**
 * What a person stated beside an accept, for the host's admission to read.
 * Every field is optional and the host decides what it means.
 */
export interface MarketplaceAdmission {
  /** "Accept anyway": the person was told the order is short and confirmed. */
  admitStockPastZero?: boolean;
}

/** The host's answer: proceed, or refuse with its own coded reason. */
export type MarketplaceAdmissionResult =
  | { admitted: true }
  | {
      admitted: false;
      /** The host's machine code (`MARKETPLACE_STOCK_ASK`). The route answers 409 with it. */
      code: string;
      /** The host's sentence, in the caller's language. */
      message: string;
      /** Anything the client needs to ask the person (the short lines). */
      details?: unknown;
    };

/** Why the engine tells the host to refuse an order. Vocabulary, not copy. */
export type MarketplaceRefusal = "REJECTED" | "EXPIRED" | "CANCELLED";

/**
 * Why the store's own cancellation request FAILED. Vocabulary, not copy.
 *
 * - `REFUSED`: the marketplace judged the request and denied it: its denial
 *   event, an answer that is its business refusal, or an adapter that has no
 *   cancellation API to call. An adapter that cannot tell a business 4xx from
 *   a malformed request (iFood, Rappi) reports every final 4xx as REFUSED.
 * - `UNREACHABLE`: our own request never got a judgement: no credentials or
 *   ones that do not open, a token the marketplace did not grant, a request
 *   the marketplace calls malformed (99Food's 400), or every attempt failed
 *   on the network or a 5xx. Retrying, or fixing the connection, can help.
 * - `TIMEOUT`: no answer inside the marketplace's cancellation window.
 *
 * A host written before `UNREACHABLE` existed treats an unknown value as it
 * treats REFUSED: the order stays and a person finishes in the marketplace's app.
 */
export type CancellationFailureReason = "REFUSED" | "UNREACHABLE" | "TIMEOUT";
