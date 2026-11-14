import {
  CaptureError,
  notBoundReasonOf,
  type BindTarget,
  type CaptureNotBoundReason,
} from './model';
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
 *    its code ({@link NonRefusingCaptureBinder.recordEach}), under the
 *    station's relay of the terminal's report. The terminal may have recorded
 *    it first; then this is a no-op. Only a capture the terminal reported is
 *    ever bound: a leg with no such report is no capture at all.
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

/** One capture a sale's leg names: the trace the station heard from the terminal. */
export interface SaleCapture {
  readonly code: string;
  readonly wire: StationCaptureWire;
}

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
   * record whatever happens to the sale. Never throws a capture refusal;
   * answers the codes that cannot be recorded — they will not be bound
   * either — with why.
   */
  recordEach(clientId: string, captures: readonly SaleCapture[]): Promise<Map<string, CaptureNotBoundReason>>;
  /**
   * In the sale's transaction, bind each capture to the payment row, each
   * under its own savepoint. Answers every capture not bound: those
   * `notBound` already named (not tried again), and those refused here.
   */
  bindEach(
    tx: TTx,
    clientId: string,
    captures: readonly SaleCapture[],
    target: BindTarget,
    notBound: NotBound,
  ): Promise<CaptureNotBound[]>;
}

export interface NonRefusingCaptureBinderConfig<TTx = unknown> {
  legs: TerminalLegs<TTx>;
  savepoint: Savepoint<TTx>;
}

export function createNonRefusingCaptureBinder<TTx = unknown>(config: NonRefusingCaptureBinderConfig<TTx>): NonRefusingCaptureBinder<TTx> {
  const { legs, savepoint } = config;

  /** Record one capture; a refusal is answered, never thrown. */
  function recordOne(clientId: string, capture: SaleCapture): Promise<CaptureNotBoundReason | null> {
    return legs.recordStation(clientId, [capture.wire]);
  }

  /** Bind one capture to the payment row. Throws its `CaptureError` when it cannot. */
  async function bindOne(tx: TTx, clientId: string, capture: SaleCapture, target: BindTarget): Promise<void> {
    await legs.bindingFor(clientId, target.orderId, [capture.wire])?.bind(tx, target.paymentId);
  }

  /** {@link bindOne} under a savepoint: rolled back to it, and the reason answered, when the capture will not bind. */
  async function bindSaved(tx: TTx, clientId: string, capture: SaleCapture, target: BindTarget): Promise<CaptureNotBoundReason | null> {
    await savepoint.open(tx);
    try {
      await bindOne(tx, clientId, capture, target);
      await savepoint.release(tx);
      return null;
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      await savepoint.rollBack(tx);
      return notBoundReasonOf(error);
    }
  }

  return {
    async recordEach(clientId, captures) {
      const refused = new Map<string, CaptureNotBoundReason>();
      for (const capture of captures) {
        // One capture per card or Pix leg of ONE sale.
        const reason = await recordOne(clientId, capture);
        if (reason !== null) refused.set(capture.code, reason);
      }
      return refused;
    },
    async bindEach(tx, clientId, captures, target, notBound) {
      const missed: CaptureNotBound[] = [];
      for (const capture of captures) {
        const known = notBound.get(capture.code);
        // Each leg binds under its own savepoint so one refusal undoes only itself.
        const reason = known ?? (await bindSaved(tx, clientId, capture, target));
        if (reason !== null) missed.push({ transactionCode: capture.code, reason });
      }
      return missed;
    },
  };
}
