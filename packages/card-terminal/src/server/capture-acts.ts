import type { TerminalCaptureLedger } from './ledger';
import type { TerminalLegs } from './legs';
import { CaptureError, notBoundReasonOf, type CaptureKind, type CaptureNotBoundReason, type TerminalCaptureRecord } from './model';
import type { StationCaptureWire } from './readers';

/**
 * The operator's acts on a capture the terminal took (FUT-4996): give its money
 * back, or let it pay a sale's leg that was taken another way.
 *
 * CALLER-DRIVEN. The engine moves only the capture, through the ledger, and
 * answers with a result that says what happened and what the caller must do
 * with its OWN records. It never reads or writes the caller's sale, legs, till
 * or audit: the caller (a point of sale) depends on this package, never the
 * other way round.
 *
 * - **Refund** ({@link CaptureActs.refund}): the capture's money is owed back,
 *   flagged once with the reason the caller names. `RECEIVED_TWICE` (the leg
 *   was already received another way) fits only a capture no sale holds; any
 *   other reason is the caller's own, an open string, and fits a held capture
 *   too unless the ledger was configured with it as unbound-only. A second act
 *   answers `flagged: false`: the caller records nothing more.
 * - **Rebind** ({@link CaptureActs.rebind}): the sale received a leg in cash
 *   AND the terminal captured it. The caller opens ONE transaction, LOCKS its
 *   sale row (`SELECT … FOR UPDATE`), reads the sale's legs and passes them as
 *   plain data with the handle; the engine binds the capture to the sale's
 *   payment row (compare-and-set) on that handle and answers the sale's new
 *   legs and the cash to give back. The caller writes those in the same
 *   transaction, or throws and nothing commits. A repeated or concurrent rebind
 *   of the SAME capture answers `moved: false` and the caller writes nothing.
 *   Two DIFFERENT captures rebound onto one sale are serialised only by the
 *   caller's lock: the engine plans from the legs it is given, so without the
 *   lock both plan from the same cash leg and too much cash goes back.
 *
 * Every refusal is a code; the caller owns the words, the permission and the
 * status.
 */

/** A settled leg of a sale: how it was paid and how much. A caller's leg may carry more; it is kept as is. */
export interface SettledLeg {
  tender: string;
  amountCents: number;
}

/** The leg a capture becomes on its sale. */
export interface CaptureLeg {
  tender: CaptureKind;
  amountCents: number;
}

/**
 * Why an act refused. The ledger's refusals as a sale-path names them
 * ({@link CaptureNotBoundReason}), plus:
 * - `NOT_FOUND`: no capture with that code at this tenant;
 * - `NO_CASH_LEG`: the sale has no cash leg as large as the capture.
 */
export type CaptureActRefusal = CaptureNotBoundReason | 'NOT_FOUND' | 'NO_CASH_LEG';

export interface CaptureActRefused {
  ok: false;
  code: CaptureActRefusal;
}

/** What a refund did, enough for the caller's own audit row. */
export interface RefundRecord {
  act: 'REFUND';
  clientId: string;
  transactionCode: string;
  refundReason: string;
  orderId?: string;
}

/** What a rebind did, enough for the caller's own audit row. */
export interface RebindRecord {
  act: 'REBIND';
  clientId: string;
  transactionCode: string;
  kind: CaptureKind;
  amountCents: number;
  orderId: string;
}

/**
 * The refund's answer. `flagged: true` with the `record` the caller audits;
 * `flagged: false` when a flag was already live (a repeated act), and the
 * caller writes nothing.
 */
export type RefundOutcome = { ok: true; flagged: true; record: RefundRecord } | { ok: true; flagged: false } | CaptureActRefused;

/**
 * The rebind's answer.
 * - `moved: true`: this call bound the capture. The caller replaces the sale's
 *   legs with `legs`, gives back `cashBackCents` from its till, and audits
 *   `record` — all on the same transaction handle it passed.
 * - `moved: false`: the capture already was this sale's (a repeat), or a
 *   concurrent twin bound it between the read and the write. Its act wrote the
 *   rest: the caller writes nothing.
 */
export type RebindOutcome<L extends SettledLeg = SettledLeg> =
  | { ok: true; moved: true; legs: Array<L | CaptureLeg>; cashBackCents: number; record: RebindRecord }
  | { ok: true; moved: false }
  | CaptureActRefused;

export interface CaptureActsConfig<TTx = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  /** Used only to record the station's report of a capture before a refund. */
  legs: TerminalLegs<TTx>;
  /** The tender a cash leg carries. Default: `CASH`. */
  cashTender?: string;
}

export interface RefundCaptureInput {
  clientId: string;
  transactionCode: string;
  /** `RECEIVED_TWICE`, or a reason of the caller's own. */
  refundReason: string;
  /** The station's report of the capture, recorded first when the terminal may not have reported yet. */
  capture?: StationCaptureWire;
  /** The sale the act was taken from, carried into the record. */
  orderId?: string;
}

export interface RebindCaptureInput<L extends SettledLeg = SettledLeg> {
  clientId: string;
  transactionCode: string;
  /** The caller's settled sale and its one payment row; the ledger checks the row is the sale's and the tenant's. */
  orderId: string;
  paymentId: string;
  /**
   * The sale's settled legs as the caller read them in this transaction, AFTER
   * locking the sale row. Plain data: nothing is written back here. A capture
   * the legs' cash cannot cover is `NO_CASH_LEG`.
   */
  legs: readonly L[];
}

export interface CaptureActs<TTx = unknown> {
  /** Flag the capture's money to go back. With `tx`, the flag joins the caller's transaction (its audit row with it). */
  refund(input: RefundCaptureInput, tx?: TTx): Promise<RefundOutcome>;
  /**
   * Bind the capture to the sale's payment row on the caller's transaction and
   * answer the legs and the cash back. `tx` is required (an undefined handle
   * throws): without it the bind commits alone, and a caller write that then
   * fails leaves the capture bound with no cash given back. The caller must
   * hold its sale row's lock for the whole transaction.
   */
  rebind<L extends SettledLeg>(input: RebindCaptureInput<L>, tx: TTx): Promise<RebindOutcome<L>>;
}

/** A ledger refusal as an act's code. */
export function captureActRefusalOf(error: CaptureError): CaptureActRefusal {
  return error.code === 'NOT_FOUND' ? 'NOT_FOUND' : notBoundReasonOf(error);
}

/** The decision of a rebind: the sale's legs after it, and the cash it gives back. */
export interface RebindPlan<L extends SettledLeg = SettledLeg> {
  legs: Array<L | CaptureLeg>;
  cashBackCents: number;
}

/**
 * The sale's legs with `capture.amountCents` of its first cash leg at least
 * that large moved onto a leg of the capture's kind, the cash leg dropped when
 * nothing is left of it — or null when no cash leg is that large. Pure.
 */
export function planRebind<L extends SettledLeg>(
  legs: readonly L[],
  capture: Pick<TerminalCaptureRecord, 'kind' | 'amountCents'>,
  cashTender = 'CASH',
): RebindPlan<L> | null {
  const cash = legs.findIndex((leg) => leg.tender === cashTender && leg.amountCents >= capture.amountCents);
  if (cash === -1) return null;
  const kept = legs.flatMap((leg, index): L[] => {
    if (index !== cash) return [leg];
    const left = leg.amountCents - capture.amountCents;
    return left > 0 ? [{ ...leg, amountCents: left }] : [];
  });
  return { legs: [...kept, { tender: capture.kind, amountCents: capture.amountCents }], cashBackCents: capture.amountCents };
}

/** Run `act`, answering a ledger refusal as its code; anything else is thrown. */
async function refusing<T>(act: () => Promise<T | CaptureActRefused>): Promise<T | CaptureActRefused> {
  try {
    return await act();
  } catch (error) {
    if (error instanceof CaptureError) return { ok: false, code: captureActRefusalOf(error) };
    throw error;
  }
}

async function refund<TTx>(config: CaptureActsConfig<TTx>, input: RefundCaptureInput, tx: TTx | undefined): Promise<RefundOutcome> {
  const { clientId, transactionCode, refundReason } = input;
  if (input.capture !== undefined) {
    const refused = await config.legs.recordStation(clientId, [{ ...input.capture, transactionCode }]);
    if (refused !== null) return { ok: false, code: refused };
  }
  return refusing(async (): Promise<RefundOutcome> => {
    const { flagged } = await config.ledger.flag({ clientId, transactionCode }, refundReason, undefined, tx);
    // A flag already live is the first act's: answered as it, recorded once by the caller.
    if (!flagged) return { ok: true, flagged: false };
    const orderId = input.orderId === undefined ? {} : { orderId: input.orderId };
    return { ok: true, flagged: true, record: { act: 'REFUND', clientId, transactionCode, refundReason, ...orderId } };
  });
}

async function rebind<TTx, L extends SettledLeg>(config: CaptureActsConfig<TTx>, input: RebindCaptureInput<L>, tx: TTx): Promise<RebindOutcome<L>> {
  const { clientId, transactionCode, orderId, paymentId } = input;
  const { ledger } = config;
  if (tx === undefined) throw new Error("rebind runs on the caller's transaction: pass its handle.");
  return refusing(async (): Promise<RebindOutcome<L>> => {
    const [capture] = await ledger.findByCodes(clientId, [transactionCode], tx);
    if (capture === undefined) return { ok: false, code: 'NOT_FOUND' };
    // Already this sale's leg (a repeated act): answered as the first, nothing written again.
    if (capture.state === 'BOUND' && capture.orderId === orderId && capture.paymentId === paymentId) return { ok: true, moved: false };
    const plan = planRebind(input.legs, capture, config.cashTender);
    if (plan === null) return { ok: false, code: 'NO_CASH_LEG' };
    const { moved } = await ledger.bindReporting(tx, clientId, [transactionCode], { orderId, paymentId });
    // A concurrent twin bound it between our read and our write: its act wrote the rest.
    if (moved.length === 0) return { ok: true, moved: false };
    const { kind, amountCents } = capture;
    return { ok: true, moved: true, ...plan, record: { act: 'REBIND', clientId, transactionCode, kind, amountCents, orderId } };
  });
}

/** The capture acts over a ledger. Each answers what the caller must write; none writes it. */
export function createCaptureActs<TTx = unknown>(config: CaptureActsConfig<TTx>): CaptureActs<TTx> {
  return {
    refund: (input, tx) => refund(config, input, tx),
    rebind: (input, tx) => rebind(config, input, tx),
  };
}
