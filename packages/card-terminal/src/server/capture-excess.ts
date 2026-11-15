import { captureActRefusalOf, type CaptureActRefusal } from './capture-acts';
import { CaptureError } from './model';
import type { TerminalCaptureLedger } from './ledger';

/**
 * Captures above what a sale is worth (FUT-4996): the total went down after
 * the terminal charged, or the terminal approved more than the leg. The
 * capture is the money truth, so it is never cut to fit: the excess is booked
 * only by an explicit choice, and with none the sale is refused naming it.
 *
 * - `CHANGE`: every capture leg stays at what was captured, and the excess is
 *   handed back in cash: `settle` answers `cashRefundCents` and the CALLER
 *   books it in its own till.
 * - `STORE_CREDIT`: the excess is kept for the sale's buyer: `settle` answers
 *   the `credit` to post, with a dedupe key stable across retries (the
 *   captures' codes), and the CALLER posts it to its wallet after its own
 *   commit; refused `EXCESS_NEEDS_BUYER` when the caller says the sale has no
 *   identified buyer to hold it.
 * - `REFUND_AND_RECHARGE`: the captures that overshoot are flagged for a refund
 *   with the caller's refund reason CODE (`refundReason` in the config, e.g. a
 *   reduced total), and the amount left to charge again is answered.
 *
 * CALLER-DRIVEN: {@link planExcess} and {@link admitExcess} are pure, and
 * {@link CaptureExcess.settle} writes only the captures' refund flags, on the
 * caller's transaction, and answers what the caller must book in its own
 * records (the cash, the credit, its audit row). The caller keeps the permission, the
 * confirmation and the copy.
 */

export const EXCESS_CHOICES = ['CHANGE', 'STORE_CREDIT', 'REFUND_AND_RECHARGE'] as const;
export type ExcessChoice = (typeof EXCESS_CHOICES)[number];

/** The operator's choice for the excess, and why (for the host's record). */
export interface ExcessResolution {
  as: ExcessChoice;
  reason: string;
}

/** A capture paying the sale: its code and what was captured. */
export interface ExcessCapture {
  transactionCode: string;
  amountCents: number;
}

export interface ExcessInput {
  /** The captures paying the sale, in the order they were taken. */
  captures: readonly ExcessCapture[];
  /**
   * What the captures may cover: the sale's total less its non-capture legs
   * (cash, vouchers…). The host composes those other legs; the plan only
   * answers for the captures.
   */
  dueCents: number;
  /** The operator's choice; absent when none was made. */
  choice?: ExcessResolution | undefined;
}

/**
 * What the excess means. `FITS`: there is none, the ordinary split applies.
 * `REFUSED`: there is, and no choice settles it.
 */
export type ExcessPlan =
  | { kind: 'FITS'; excessCents: 0 }
  | { kind: 'REFUSED'; code: 'CAPTURES_EXCEED_TOTAL'; excessCents: number }
  | {
      kind: 'CHANGE';
      excessCents: number;
      reason: string;
      /** Each capture leg at its captured amount: they add up to the due plus the excess. */
      legs: ExcessCapture[];
      /** The cash handed back: the excess. */
      cashRefundCents: number;
    }
  | { kind: 'STORE_CREDIT'; excessCents: number; reason: string; legs: ExcessCapture[]; creditCents: number }
  | {
      kind: 'REFUND_AND_RECHARGE';
      excessCents: number;
      reason: string;
      /** The captures kept: they fit inside the due. */
      kept: ExcessCapture[];
      /** The captures owed back, the latest first taken off. */
      refunded: ExcessCapture[];
      /** What is left to charge again: the due less what the kept captures cover. */
      rechargeCents: number;
    };

const sumOf = (captures: readonly ExcessCapture[]): number => captures.reduce((sum, capture) => sum + capture.amountCents, 0);

/** What the captures took above `dueCents`: 0 when they fit inside it. */
export function capturedAbove(captures: readonly ExcessCapture[], dueCents: number): number {
  return Math.max(0, sumOf(captures) - dueCents);
}

/** The latest captures off until the rest fit inside the due. */
function splitToFit(captures: readonly ExcessCapture[], dueCents: number): { kept: ExcessCapture[]; refunded: ExcessCapture[] } {
  const kept = [...captures];
  const refunded: ExcessCapture[] = [];
  while (kept.length > 0 && sumOf(kept) > dueCents) {
    const last = kept.pop();
    if (last !== undefined) refunded.unshift(last);
  }
  return { kept, refunded };
}

/** The plan for a sale's captures against what they may cover. Pure. */
export function planExcess(input: ExcessInput): ExcessPlan {
  const { captures, dueCents, choice } = input;
  const excessCents = capturedAbove(captures, dueCents);
  if (excessCents === 0) return { kind: 'FITS', excessCents: 0 };
  if (choice === undefined) return { kind: 'REFUSED', code: 'CAPTURES_EXCEED_TOTAL', excessCents };
  const legs = captures.map((capture) => ({ ...capture }));
  const { reason } = choice;
  if (choice.as === 'CHANGE') return { kind: 'CHANGE', excessCents, reason, legs, cashRefundCents: excessCents };
  if (choice.as === 'STORE_CREDIT') return { kind: 'STORE_CREDIT', excessCents, reason, legs, creditCents: excessCents };
  const { kept, refunded } = splitToFit(captures, dueCents);
  return { kind: 'REFUND_AND_RECHARGE', excessCents, reason, kept, refunded, rechargeCents: dueCents - sumOf(kept) };
}

/** The sale the excess is booked on: the tenant's, and the sale's id once it has one (a new sale has none yet). */
export interface ExcessSale {
  clientId: string;
  orderId: string | null;
}

/** What the excess booked, enough for the caller's own audit row. */
export interface ExcessRecord {
  clientId: string;
  /** Null only for `REFUND_AND_RECHARGE` before any sale was written. */
  orderId: string | null;
  as: ExcessChoice;
  excessCents: number;
  reason: string;
}

/**
 * The credit a `STORE_CREDIT` settle asks the caller to post to the sale's
 * buyer. Post it AFTER your transaction commits — never inside a transaction
 * that may still roll back — and dedupe on `dedupeKey`: it is built from the
 * tenant and the captures' codes, which a retry keeps (a retried sale gets a
 * new id; its captures do not), so one excess is credited once.
 */
export interface ExcessCredit {
  clientId: string;
  orderId: string;
  amountCents: number;
  reason: string;
  /** The captures whose excess this is, sorted. */
  transactionCodes: string[];
  /** `excess-credit:<clientId>:<codes joined by ','>`: the wallet's idempotency key. */
  dedupeKey: string;
}

export interface CaptureExcessConfig<TTx = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  /**
   * The refund reason CODE a `REFUND_AND_RECHARGE` flags its captures with —
   * one the caller's table accepts (a reduced total, say). Required: the
   * operator's free-text `reason` goes to the record and the credit only,
   * never into the capture's refund reason.
   */
  refundReason: string;
}

/** Why the excess cannot be booked as chosen. */
export type ExcessRefusal =
  | { ok: false; code: 'CAPTURES_EXCEED_TOTAL'; excessCents: number }
  | { ok: false; code: 'EXCESS_NEEDS_BUYER'; excessCents: number };

/**
 * What a settle did, and what the caller must still book in its own records:
 * `cashRefundCents` handed back from its till (`CHANGE`), `rechargeCents` left
 * to charge again (`REFUND_AND_RECHARGE`), and `record` for its audit row
 * (null for a `FITS` plan, which books nothing), and `credit` to post after its
 * commit (`STORE_CREDIT` only, else null).
 *
 * A refusal (`ok: false`) may come after some of a `REFUND_AND_RECHARGE`'s
 * flags were written on `tx`: the caller rolls its transaction back, as it
 * would for any refusal it cannot book.
 */
export type ExcessSettled =
  | { ok: true; plan: ExcessPlan; cashRefundCents: number; creditCents: number; credit: ExcessCredit | null; rechargeCents: number; record: ExcessRecord | null }
  | { ok: false; code: CaptureActRefusal };

export interface CaptureExcess<TTx = unknown> {
  /**
   * Book an admitted plan's capture side on the written sale: the
   * refund flags. A `FITS` plan books nothing. `CHANGE` and `STORE_CREDIT` need
   * the written sale's id; `REFUND_AND_RECHARGE` may run before any sale was
   * written.
   */
  settle(plan: ExcessPlan, sale: ExcessSale, tx: TTx): Promise<ExcessSettled>;
}

/**
 * Whether a plan may be booked, read before anything is written: the refusal,
 * or null. `buyerHoldsCredit` is the caller's answer for its sale (a new sale
 * with no buyer yet answers false). Pure.
 */
export function admitExcess(plan: ExcessPlan, sale: { buyerHoldsCredit: boolean }): ExcessRefusal | null {
  if (plan.kind === 'REFUSED') return { ok: false, code: plan.code, excessCents: plan.excessCents };
  if (plan.kind !== 'STORE_CREDIT' || sale.buyerHoldsCredit) return null;
  return { ok: false, code: 'EXCESS_NEEDS_BUYER', excessCents: plan.excessCents };
}

type Booked = Exclude<ExcessPlan, { kind: 'FITS' } | { kind: 'REFUSED' }>;

/** The credit a `STORE_CREDIT` plan asks the caller to post, keyed on the tenant and the captures' codes. */
function creditOf(plan: Extract<ExcessPlan, { kind: 'STORE_CREDIT' }>, clientId: string, orderId: string): ExcessCredit {
  const transactionCodes = plan.legs.map((leg) => leg.transactionCode).sort();
  return {
    clientId,
    orderId,
    amountCents: plan.creditCents,
    reason: plan.reason,
    transactionCodes,
    dedupeKey: `excess-credit:${clientId}:${transactionCodes.join(',')}`,
  };
}

function settledOf(plan: Booked, sale: ExcessSale): Extract<ExcessSettled, { ok: true }> {
  const record: ExcessRecord = { clientId: sale.clientId, orderId: sale.orderId, as: plan.kind, excessCents: plan.excessCents, reason: plan.reason };
  return {
    ok: true,
    plan,
    cashRefundCents: plan.kind === 'CHANGE' ? plan.cashRefundCents : 0,
    creditCents: plan.kind === 'STORE_CREDIT' ? plan.creditCents : 0,
    credit: plan.kind === 'STORE_CREDIT' && sale.orderId !== null ? creditOf(plan, sale.clientId, sale.orderId) : null,
    rechargeCents: plan.kind === 'REFUND_AND_RECHARGE' ? plan.rechargeCents : 0,
    record,
  };
}

/** Flag a `REFUND_AND_RECHARGE` plan's refunded captures with the caller's reason code; a ledger refusal as its code. */
async function flagRefunded<TTx>(
  config: CaptureExcessConfig<TTx>,
  plan: Extract<ExcessPlan, { kind: 'REFUND_AND_RECHARGE' }>,
  sale: ExcessSale,
  tx: TTx,
): Promise<{ ok: false; code: CaptureActRefusal } | null> {
  try {
    for (const capture of plan.refunded) {
      await config.ledger.flag({ clientId: sale.clientId, transactionCode: capture.transactionCode }, config.refundReason, undefined, tx);
    }
    return null;
  } catch (error) {
    if (error instanceof CaptureError) return { ok: false, code: captureActRefusalOf(error) };
    throw error;
  }
}

async function settle<TTx>(config: CaptureExcessConfig<TTx>, plan: ExcessPlan, sale: ExcessSale, tx: TTx): Promise<ExcessSettled> {
  // Without the caller's handle a refusal part-way through the flags would leave the earlier ones committed.
  if (tx === undefined) throw new Error("settle runs on the caller's transaction: pass its handle.");
  if (plan.kind === 'FITS') return { ok: true, plan, cashRefundCents: 0, creditCents: 0, credit: null, rechargeCents: 0, record: null };
  if (plan.kind === 'REFUSED') throw new Error('A refused excess plan cannot be settled: admit it first.');
  if (plan.kind === 'REFUND_AND_RECHARGE') {
    const refused = await flagRefunded(config, plan, sale, tx);
    return refused ?? settledOf(plan, sale);
  }
  if (sale.orderId === null) throw new Error(`${plan.kind} is booked on a written sale: pass its id.`);
  return settledOf(plan, sale);
}

/** The excess settler over a ledger. It writes the captures' flags only and answers the rest. */
export function createCaptureExcess<TTx = unknown>(config: CaptureExcessConfig<TTx>): CaptureExcess<TTx> {
  return {
    settle: (plan, sale, tx) => settle(config, plan, sale, tx),
  };
}
