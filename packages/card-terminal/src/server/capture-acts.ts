import type { TerminalCaptureLedger } from './ledger';
import type { TerminalLegs } from './legs';
import { CaptureError, notBoundReasonOf, type CaptureKind, type CaptureNotBoundReason, type TerminalCaptureRecord } from './model';
import type { StationCaptureWire } from './readers';

/**
 * The operator's acts on a capture the terminal took (FUT-4996): give its money
 * back, or let it pay a sale's leg that was taken another way. The engine
 * decides and moves the capture through the ledger; the host answers the ports
 * over its own tables — the sale and its legs, the cash it gives back, its
 * record of who did what — and keeps the permission, the confirmation and the
 * copy.
 *
 * - **Refund** ({@link CaptureActs.refund}): the capture's money is owed back,
 *   flagged once with the reason the host names. `RECEIVED_TWICE` (the leg was
 *   already received another way) fits only a capture no sale holds; any other
 *   reason is the host's own, an open string, and fits a held capture too
 *   unless the ledger was configured with it as unbound-only. A second act is
 *   answered as the first and records nothing more.
 * - **Rebind** ({@link CaptureActs.rebind}): the sale received a leg in cash
 *   AND the terminal captured it. The capture stays: the sale's cash leg of at
 *   least that amount gives the amount up to a leg of the captured kind, the
 *   capture binds to the sale's payment row (compare-and-set), and the cash
 *   goes back — all in ONE transaction of the host's, or none of it. A
 *   capture already bound to that sale's payment row answers as the first act
 *   and writes nothing more.
 *
 * Every answer is a code; the host owns the words and the status.
 */

/** A settled leg of a sale: how it was paid and how much. A host's leg may carry more; it is kept as is. */
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
 * - `NO_CASH_LEG`: the sale is not a settled sale of this tenant, or has no
 *   cash leg as large as the capture.
 */
export type CaptureActRefusal = CaptureNotBoundReason | 'NOT_FOUND' | 'NO_CASH_LEG';

export type CaptureActResult = { ok: true } | { ok: false; code: CaptureActRefusal };

/** A sale a rebind may land on: its settled legs and its one payment row. */
export interface SettledSale<L extends SettledLeg = SettledLeg> {
  legs: readonly L[];
  paymentId: string;
}

/** What an act did, for the host's record of it (an audit row). The host adds who and why. */
export type CaptureActRecord =
  | { act: 'REFUND'; clientId: string; transactionCode: string; refundReason: string; orderId?: string }
  | { act: 'REBIND'; clientId: string; transactionCode: string; kind: CaptureKind; amountCents: number; orderId: string };

/** The money a rebind gives back from the sale's cash, for the host to book. */
export interface CashBack {
  clientId: string;
  orderId: string;
  amountCents: number;
  transactionCode: string;
}

/**
 * What the host answers, each on the handle of the transaction the engine
 * opened through {@link CaptureActPorts.transaction}.
 */
export interface CaptureActPorts<TTx = unknown, L extends SettledLeg = SettledLeg, TNote = unknown> {
  /** Run `work` in one transaction of the host's: everything it writes commits together, or nothing does. */
  transaction<T>(work: (tx: TTx) => Promise<T>): Promise<T>;
  /** The sale, when it is a settled (paid) sale of this tenant with its payment row; otherwise null. */
  settledSale(tx: TTx, clientId: string, orderId: string): Promise<SettledSale<L> | null>;
  /** Replace the sale's settled legs. */
  writeLegs(tx: TTx, clientId: string, orderId: string, legs: ReadonlyArray<L | CaptureLeg>): Promise<void>;
  /** Book the cash the sale gives back, where the sale's cash was taken in, with the caller's note (who acted). */
  bookCashBack(tx: TTx, cash: CashBack, note: TNote): Promise<void>;
  /** The host's record of the act, with the note the caller passed (who, why, under which permission). */
  record(tx: TTx, act: CaptureActRecord, note: TNote): Promise<void>;
}

export interface CaptureActsConfig<TTx = unknown, L extends SettledLeg = SettledLeg, TNote = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  legs: TerminalLegs<TTx>;
  ports: CaptureActPorts<TTx, L, TNote>;
  /** The tender a cash leg carries. Default: `CASH`. */
  cashTender?: string;
}

export interface RefundCaptureInput {
  clientId: string;
  transactionCode: string;
  /** `RECEIVED_TWICE`, or a reason of the host's own. */
  refundReason: string;
  /** The station's report of the capture, recorded first when the terminal may not have reported yet. */
  capture?: StationCaptureWire;
  /** The sale the act was taken from, carried to the host's record. */
  orderId?: string;
}

export interface RebindCaptureInput {
  clientId: string;
  transactionCode: string;
  orderId: string;
}

export interface CaptureActs<TNote = unknown> {
  refund(input: RefundCaptureInput, note: TNote): Promise<CaptureActResult>;
  rebind(input: RebindCaptureInput, note: TNote): Promise<CaptureActResult>;
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
async function refusing(act: () => Promise<CaptureActResult>): Promise<CaptureActResult> {
  try {
    return await act();
  } catch (error) {
    if (error instanceof CaptureError) return { ok: false, code: captureActRefusalOf(error) };
    throw error;
  }
}

async function refund<TTx, L extends SettledLeg, TNote>(
  config: CaptureActsConfig<TTx, L, TNote>,
  input: RefundCaptureInput,
  note: TNote,
): Promise<CaptureActResult> {
  const { clientId, transactionCode, refundReason } = input;
  if (input.capture !== undefined) {
    const refused = await config.legs.recordStation(clientId, [{ ...input.capture, transactionCode }]);
    if (refused !== null) return { ok: false, code: refused };
  }
  return refusing(() =>
    config.ports.transaction(async (tx) => {
      const { flagged } = await config.ledger.flag({ clientId, transactionCode }, refundReason, undefined, tx);
      // A flag already live is the first act's: answered as it, recorded once.
      if (!flagged) return { ok: true };
      const orderId = input.orderId === undefined ? {} : { orderId: input.orderId };
      await config.ports.record(tx, { act: 'REFUND', clientId, transactionCode, refundReason, ...orderId }, note);
      return { ok: true };
    }),
  );
}

async function rebind<TTx, L extends SettledLeg, TNote>(
  config: CaptureActsConfig<TTx, L, TNote>,
  input: RebindCaptureInput,
  note: TNote,
): Promise<CaptureActResult> {
  const { clientId, transactionCode, orderId } = input;
  const { ledger, ports } = config;
  return refusing(() =>
    ports.transaction(async (tx): Promise<CaptureActResult> => {
      const [capture] = await ledger.findByCodes(clientId, [transactionCode], tx);
      if (capture === undefined) return { ok: false, code: 'NOT_FOUND' };
      const sale = await ports.settledSale(tx, clientId, orderId);
      // Already this sale's leg (a repeated act): answered as the first, nothing written again.
      if (sale !== null && capture.state === 'BOUND' && capture.orderId === orderId && capture.paymentId === sale.paymentId) return { ok: true };
      const plan = sale === null ? null : planRebind(sale.legs, capture, config.cashTender);
      if (sale === null || plan === null) return { ok: false, code: 'NO_CASH_LEG' };
      const { moved } = await ledger.bindReporting(tx, clientId, [transactionCode], { orderId, paymentId: sale.paymentId });
      // A concurrent twin bound it between our read and our write: its act wrote the rest.
      if (moved.length === 0) return { ok: true };
      await ports.writeLegs(tx, clientId, orderId, plan.legs);
      await ports.bookCashBack(tx, { clientId, orderId, amountCents: plan.cashBackCents, transactionCode }, note);
      const { kind, amountCents } = capture;
      await ports.record(tx, { act: 'REBIND', clientId, transactionCode, kind, amountCents, orderId }, note);
      return { ok: true };
    }),
  );
}

/** The capture acts over a ledger, its legs and the host's ports. */
export function createCaptureActs<TTx = unknown, L extends SettledLeg = SettledLeg, TNote = unknown>(
  config: CaptureActsConfig<TTx, L, TNote>,
): CaptureActs<TNote> {
  return {
    refund: (input, note) => refund(config, input, note),
    rebind: (input, note) => rebind(config, input, note),
  };
}
