import type { PaymentMethodKind } from '../core/types';

/**
 * WHAT A TERMINAL STATUS CANNOT SAY ON ITS OWN (FUT-612) — the `/status`
 * answer's optional facts, next to the state token, in ONE shape every host
 * speaks.
 *
 * A payable parked for less than its total answered `"FAILED"`, the same token
 * a declined card answers, so the buyer's screen said "Nenhum valor foi
 * cobrado" to somebody whose money had arrived. The token is right — the
 * payable is not settled — and a fourth `Payable.state` would turn the port
 * into an order. What was missing is a FACT the server states beside it:
 *
 *  - `shortfall` — a capture arrived and it did not cover the total. The
 *    screen offers to pay only what is missing, or to have the capture
 *    returned.
 *  - `stockGone` — the WHOLE amount arrived and the payable still could not be
 *    fulfilled (an item ran out). Nothing is missing, so nothing is offered:
 *    the store confirms or returns the money.
 *
 * The CLIENT NEVER INFERS EITHER from amounts or tokens: a decline answers no
 * fact, so it renders exactly as before, and an older host that sends none
 * gets today's screen. Every number is the host's, computed from its CURRENT
 * record — the library checks the shape, never the arithmetic it cannot see
 * (credit applied, a total a person edited).
 */

/**
 * Where a shortfall stands. `null` while the buyer can still act;
 * `REFUND_PENDING` once a refund was asked and the provider has not taken it
 * yet; `REFUNDED` once the capture went back; `SETTLED` once the store
 * collected the difference itself and confirmed.
 */
export type ShortfallResolution = 'REFUNDED' | 'REFUND_PENDING' | 'SETTLED' | null;

/** A capture arrived short of the total. Cents, the payable's currency. */
export interface PaymentShortfall {
  /** The payable's total NOW (a person may have edited it since the capture). */
  totalCents: number;
  /** What the parked captures add up to. */
  paidCents: number;
  /**
   * What is still missing, as the host computes it (total, less any credit,
   * less the captures). Zero or less means nothing can be asked of the buyer —
   * the store is checking it — and is sent as `0`.
   */
  dueCents: number;
  /** How the money that arrived was paid. */
  paidMethod: PaymentMethodKind;
  resolution: ShortfallResolution;
}

/** The whole amount arrived, and the payable could not be fulfilled. */
export interface PaymentStockGone {
  /** What arrived, in cents. */
  receivedCents: number;
  /** What ran out, in the host's own words for it (an item's name). */
  missing: readonly string[];
}

/** The facts a terminal status may carry. Both absent is today's answer. */
export interface CheckoutStatusFacts {
  shortfall?: PaymentShortfall | null;
  stockGone?: PaymentStockGone | null;
}

/** The `/status` body: the host's state token, plus whichever fact applies. */
export interface CheckoutStatusBody {
  data: string;
  shortfall?: PaymentShortfall;
  stockGone?: PaymentStockGone;
}

const RESOLUTIONS: ReadonlySet<ShortfallResolution> = new Set(['REFUNDED', 'REFUND_PENDING', 'SETTLED', null]);

function cents(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`checkout status: ${what} must be a non-negative integer of cents`);
  }
  return value;
}

/**
 * The shortfall as it travels: checked, with a non-positive balance sent as 0.
 *
 * THROWS on a malformed one rather than dropping it. Dropping it would answer
 * the bare token — the decline screen, "nothing was charged" — to a buyer whose
 * money arrived; a host's arithmetic bug must surface in its own tests, not in
 * front of that buyer.
 */
export function shortfallFact(input: PaymentShortfall): PaymentShortfall {
  if (!RESOLUTIONS.has(input.resolution)) {
    throw new TypeError(`checkout status: unknown shortfall resolution ${String(input.resolution)}`);
  }
  const paidCents = cents(input.paidCents, 'paidCents');
  if (paidCents === 0) throw new TypeError('checkout status: a shortfall needs a capture (paidCents > 0)');
  return {
    totalCents: cents(input.totalCents, 'totalCents'),
    paidCents,
    dueCents: Number.isSafeInteger(input.dueCents) ? Math.max(0, input.dueCents) : cents(input.dueCents, 'dueCents'),
    paidMethod: input.paidMethod,
    resolution: input.resolution,
  };
}

function stockGoneFact(input: PaymentStockGone): PaymentStockGone {
  return { receivedCents: cents(input.receivedCents, 'receivedCents'), missing: [...input.missing] };
}

/**
 * The `/status` body for a token and its facts.
 *
 * ONE fact at most. A payable parked because an item ran out after its whole
 * amount arrived — a balance that settled the money and then met an empty
 * shelf, say — is a stock-gone payable even if a shortfall was recorded on the
 * way: nothing is missing any more, and offering "pay the difference" on it
 * would ask for money a second time. So `stockGone` wins.
 */
export function checkoutStatusBody(token: string, facts?: CheckoutStatusFacts | null): CheckoutStatusBody {
  if (facts?.stockGone) return { data: token, stockGone: stockGoneFact(facts.stockGone) };
  if (facts?.shortfall) return { data: token, shortfall: shortfallFact(facts.shortfall) };
  return { data: token };
}
