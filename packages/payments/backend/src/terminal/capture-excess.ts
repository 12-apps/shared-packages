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
 *   handed back in cash — a cash refund for the host to book.
 * - `STORE_CREDIT`: the excess is kept for the sale's buyer, posted through a
 *   port; refused `EXCESS_NEEDS_BUYER` when the host says the sale has no
 *   identified buyer to hold it.
 * - `REFUND_AND_RECHARGE`: the captures that overshoot are flagged for a refund
 *   with the host's refund reason code (`refundReason` in the config), and
 *   the amount left to charge again is returned.
 *
 * {@link planExcess} is pure; {@link CaptureExcess.admit} is the read a host
 * runs before writing the sale, and {@link CaptureExcess.settle} books the
 * plan once the sale is written. The host keeps the permission, the
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

/** What the excess booked, for the host's record of it. */
export interface ExcessRecord {
  clientId: string;
  /** Null only for `REFUND_AND_RECHARGE` before any sale was written. */
  orderId: string | null;
  as: ExcessChoice;
  excessCents: number;
  reason: string;
}

export interface CaptureExcessPorts<TTx = unknown, TNote = unknown> {
  /** Run `work` in one transaction of the host's. */
  transaction<T>(work: (tx: TTx) => Promise<T>): Promise<T>;
  /** Whether the sale has an identified buyer who can hold credit. A sale with no id yet (a new one) asks with null. */
  buyerHoldsCredit(clientId: string, orderId: string | null): Promise<boolean>;
  /** Book the cash handed back for `CHANGE`. */
  bookCashRefund(tx: TTx, refund: { clientId: string; orderId: string; amountCents: number }, note: TNote): Promise<void>;
  /** Post the credit for `STORE_CREDIT` to the sale's buyer. Its own transaction: a wallet keeps its own. */
  /**
   * It runs OUTSIDE the transaction (a wallet keeps its own), before the
   * record, so a retried settle reaches it again: the host's port MUST dedupe
   * on `(clientId, orderId)` — one excess credit per sale — or a retry credits
   * twice.
   */
  postCredit(credit: { clientId: string; orderId: string; amountCents: number; reason: string }, note: TNote): Promise<void>;
  /** The host's record of what was booked, with the caller's note. */
  record(tx: TTx, booked: ExcessRecord, note: TNote): Promise<void>;
}

export interface CaptureExcessConfig<TTx = unknown, TNote = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  ports: CaptureExcessPorts<TTx, TNote>;
  /**
   * The refund reason CODE a `REFUND_AND_RECHARGE` flags its captures with —
   * one the host's table accepts (a reduced total, say). Required: the
   * operator's free-text `reason` goes to the record and the credit note only,
   * never into the capture's refund reason.
   */
  refundReason: string;
}

/** Why the excess cannot be booked as chosen. */
export type ExcessRefusal =
  | { ok: false; code: 'CAPTURES_EXCEED_TOTAL'; excessCents: number }
  | { ok: false; code: 'EXCESS_NEEDS_BUYER'; excessCents: number };

export type ExcessSettled =
  | { ok: true; plan: ExcessPlan; rechargeCents: number }
  | { ok: false; code: CaptureActRefusal };

export interface CaptureExcess<TNote = unknown> {
  /** Read before anything is written: the refusal, or null when the plan may be booked. */
  admit(plan: ExcessPlan, sale: ExcessSale): Promise<ExcessRefusal | null>;
  /**
   * Book an admitted plan on the written sale: the cash refund, the credit, or
   * the refund flags; and the host's record. `rechargeCents` is what is left
   * to charge again (0 but for `REFUND_AND_RECHARGE`). A `FITS` plan books nothing.
   * `CHANGE` and `STORE_CREDIT` need the written sale's id; `REFUND_AND_RECHARGE`
   * may run before any sale was written.
   */
  settle(plan: ExcessPlan, sale: ExcessSale, note: TNote): Promise<ExcessSettled>;
}

async function admit<TTx, TNote>(ports: CaptureExcessPorts<TTx, TNote>, plan: ExcessPlan, sale: ExcessSale): Promise<ExcessRefusal | null> {
  if (plan.kind === 'REFUSED') return { ok: false, code: plan.code, excessCents: plan.excessCents };
  if (plan.kind !== 'STORE_CREDIT') return null;
  if (await ports.buyerHoldsCredit(sale.clientId, sale.orderId)) return null;
  return { ok: false, code: 'EXCESS_NEEDS_BUYER', excessCents: plan.excessCents };
}

type Booked = Exclude<ExcessPlan, { kind: 'FITS' } | { kind: 'REFUSED' }>;

/** The plan's writes in the host's transaction, and its record. */
async function book<TTx, TNote>(config: CaptureExcessConfig<TTx, TNote>, plan: Booked, sale: ExcessSale, note: TNote, tx: TTx): Promise<void> {
  const { clientId, orderId } = sale;
  if (plan.kind === 'CHANGE' && orderId !== null) await config.ports.bookCashRefund(tx, { clientId, orderId, amountCents: plan.cashRefundCents }, note);
  if (plan.kind === 'REFUND_AND_RECHARGE') {
    for (const capture of plan.refunded) await config.ledger.flag({ clientId, transactionCode: capture.transactionCode }, config.refundReason, undefined, tx);
  }
  await config.ports.record(tx, { clientId, orderId, as: plan.kind, excessCents: plan.excessCents, reason: plan.reason }, note);
}

async function settle<TTx, TNote>(
  config: CaptureExcessConfig<TTx, TNote>,
  plan: ExcessPlan,
  sale: ExcessSale,
  note: TNote,
): Promise<ExcessSettled> {
  if (plan.kind === 'FITS') return { ok: true, plan, rechargeCents: 0 };
  if (plan.kind === 'REFUSED') throw new Error('A refused excess plan cannot be settled: admit it first.');
  if (plan.kind !== 'REFUND_AND_RECHARGE' && sale.orderId === null) throw new Error(`${plan.kind} is booked on a written sale: pass its id.`);
  if (plan.kind === 'STORE_CREDIT' && sale.orderId !== null) {
    await config.ports.postCredit({ clientId: sale.clientId, orderId: sale.orderId, amountCents: plan.creditCents, reason: plan.reason }, note);
  }
  try {
    await config.ports.transaction((tx) => book(config, plan, sale, note, tx));
  } catch (error) {
    if (error instanceof CaptureError) return { ok: false, code: captureActRefusalOf(error) };
    throw error;
  }
  return { ok: true, plan, rechargeCents: plan.kind === 'REFUND_AND_RECHARGE' ? plan.rechargeCents : 0 };
}

/**
 * The excess planner and settler over a ledger and the host's ports.
 *
 * @deprecated Its ports write the host's own sale, legs, till and audit — the
 * payment code calling into the point of sale. Use the caller-driven
 * `createCaptureExcess` from `@12-apps/card-terminal/server`, which moves only the
 * capture and answers what the caller writes (FUT-4996). Removal is a later
 * major release that needs the owner's approval.
 */
export function createCaptureExcess<TTx = unknown, TNote = unknown>(config: CaptureExcessConfig<TTx, TNote>): CaptureExcess<TNote> {
  return {
    admit: (plan, sale) => admit(config.ports, plan, sale),
    settle: (plan, sale, note) => settle(config, plan, sale, note),
  };
}
