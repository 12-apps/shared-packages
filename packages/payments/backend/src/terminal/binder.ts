import {
  CaptureError,
  clampToNow,
  notBoundReasonOf,
  type BindTarget,
  type CaptureNotBoundReason,
  type RecordCaptureInput,
} from './model';
import type { TerminalCaptureLedger } from './ledger';
import type { TerminalLegs } from './legs';
import type { Savepoint } from './ports';
import type { StationCaptureWire } from './readers';

/**
 * A non-refusing capture binder: the captures of a sale that was already made
 * — the goods left and the money was taken, say while the server was away —
 * bound to it when it is finally booked, and NEVER the reason the sale is
 * refused. Failing the sale over its capture would jam every sale queued
 * after it, forever.
 *
 * 1. **Before the sale's transaction** each capture is recorded, idempotent on
 *    its code ({@link NonRefusingCaptureBinder.recordEach}): under the
 *    station's report when it carries the trace, from the leg itself (source
 *    `JOURNAL`) when the station lost it and kept the leg — the terminal's own
 *    report fills the trace in later. The terminal may have recorded it
 *    first; then this is a no-op.
 * 2. **Inside the sale's transaction**, after its ONE payment row is written,
 *    each capture is bound to that row ({@link NonRefusingCaptureBinder.bindEach}),
 *    each under its own savepoint, so one that cannot bind leaves nothing of
 *    its own and the rest go on.
 *
 * A capture that cannot bind — another amount under its code, a terminal not
 * the tenant's, flagged for a refund, held by another sale — is left exactly
 * as it was and answered with its {@link CaptureNotBoundReason}, for the host
 * to record beside the sale.
 */

/** One capture a sale's leg names: the trace the station heard, or only the code it kept with the leg. */
export type SaleCapture =
  | { readonly code: string; readonly wire: StationCaptureWire }
  | { readonly code: string; readonly leg: { tender: string; amountCents: number } };

/** The codes that will not bind, and why. */
export type NotBound = ReadonlyMap<string, CaptureNotBoundReason>;

/** A capture the binder could not bind, as the host records it beside the sale. */
export interface CaptureNotBound {
  transactionCode: string;
  reason: CaptureNotBoundReason;
}

export interface NonRefusingCaptureBinder<TTx = unknown> {
  /**
   * Record each capture before the sale's transaction, so the money is on
   * record whatever happens to the sale. `at` is when the sale was made: a
   * capture kept from its leg alone is dated by it (never in the future).
   * Never throws a capture refusal; answers the codes that cannot be recorded
   * — they will not be bound either — with why.
   */
  recordEach(clientId: string, captures: readonly SaleCapture[], at: Date | string): Promise<Map<string, CaptureNotBoundReason>>;
  /**
   * In the sale's transaction, bind each capture to the payment row, each
   * under its own savepoint. Answers every capture not bound: those
   * `notBound` already named (not tried again), and those refused here.
   */
  bindEach(
    tx: TTx,
    clientId: string,
    captures: readonly SaleCapture[],
    at: Date | string,
    target: BindTarget,
    notBound: NotBound,
  ): Promise<CaptureNotBound[]>;
}

export interface NonRefusingCaptureBinderConfig<TTx = unknown> {
  ledger: TerminalCaptureLedger<TTx>;
  legs: TerminalLegs<TTx>;
  savepoint: Savepoint<TTx>;
  /** The clock. Default: the system's. */
  now?: () => Date;
}

export function createNonRefusingCaptureBinder<TTx = unknown>(config: NonRefusingCaptureBinderConfig<TTx>): NonRefusingCaptureBinder<TTx> {
  const { ledger, legs, savepoint } = config;
  const clock = config.now ?? (() => new Date());

  /** A capture kept from its leg alone: its kind is the leg's tender, its time the sale's (never the future). */
  function journalInput(clientId: string, at: Date | string, code: string, leg: { tender: string; amountCents: number }): RecordCaptureInput {
    return {
      clientId,
      source: 'JOURNAL',
      transactionCode: code,
      kind: leg.tender as RecordCaptureInput['kind'],
      amountCents: leg.amountCents,
      capturedAt: clampToNow(new Date(at), clock()),
    };
  }

  /** Record one capture; a refusal is answered, never thrown. */
  async function recordOne(clientId: string, at: Date | string, capture: SaleCapture): Promise<CaptureNotBoundReason | null> {
    if ('wire' in capture) return legs.recordStation(clientId, [capture.wire]);
    try {
      await ledger.record(journalInput(clientId, at, capture.code, capture.leg));
      return null;
    } catch (error) {
      if (error instanceof CaptureError) return notBoundReasonOf(error);
      throw error;
    }
  }

  /** Bind one capture to the payment row. Throws its `CaptureError` when it cannot. */
  async function bindOne(tx: TTx, clientId: string, at: Date | string, capture: SaleCapture, target: BindTarget): Promise<void> {
    if ('wire' in capture) {
      await legs.bindingFor(clientId, target.orderId, [capture.wire])?.bind(tx, target.paymentId);
      return;
    }
    await ledger.record(journalInput(clientId, at, capture.code, capture.leg), tx);
    await ledger.bind(tx, clientId, [capture.code], target);
  }

  /** {@link bindOne} under a savepoint: rolled back to it, and the reason answered, when the capture will not bind. */
  async function bindSaved(tx: TTx, clientId: string, at: Date | string, capture: SaleCapture, target: BindTarget): Promise<CaptureNotBoundReason | null> {
    await savepoint.open(tx);
    try {
      await bindOne(tx, clientId, at, capture, target);
      await savepoint.release(tx);
      return null;
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      await savepoint.rollBack(tx);
      return notBoundReasonOf(error);
    }
  }

  return {
    async recordEach(clientId, captures, at) {
      const refused = new Map<string, CaptureNotBoundReason>();
      for (const capture of captures) {
        // One capture per card or Pix leg of ONE sale.
        const reason = await recordOne(clientId, at, capture);
        if (reason !== null) refused.set(capture.code, reason);
      }
      return refused;
    },
    async bindEach(tx, clientId, captures, at, target, notBound) {
      const missed: CaptureNotBound[] = [];
      for (const capture of captures) {
        const known = notBound.get(capture.code);
        // Each leg binds under its own savepoint so one refusal undoes only itself.
        const reason = known ?? (await bindSaved(tx, clientId, at, capture, target));
        if (reason !== null) missed.push({ transactionCode: capture.code, reason });
      }
      return missed;
    },
  };
}
