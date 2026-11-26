import { HOLD_REFUSALS, MOVE_ATTEMPTS, REFUSALS, holdDecision, versionOf } from './decisions';
import { CaptureError, type CaptureKey, type TerminalCaptureRecord } from './model';
import type { TerminalCaptureStore, TerminalCaptureStoreFor } from './ports';

/**
 * Captures held for a sale context (FUT-3770): a capture a settle refused
 * because the bill GREW is still good money, kept under the host's own opaque
 * key for what it was taken for, so ANY terminal settling that context is
 * offered it — not only the terminal that took it. Part of the ledger
 * (`createTerminalCaptureLedger`); here so the ledger stays readable.
 */
export interface TerminalCaptureHolds<TTx = unknown> {
  /**
   * Hold an UNBOUND capture for a sale context: `holdKey` is the host's own
   * opaque key for what the money was taken for (a bill, a table's tab), so
   * that ANY terminal settling that context is offered it as already received
   * ({@link findHeld}). Meant for a capture a settle refused because the bill
   * GREW after the charge: the money is good, the sale is not written yet.
   *
   * Idempotent: holding it again for the same context writes nothing
   * (`held: false`). Refused as a {@link CaptureError}, with nothing written:
   * `NOT_FOUND`; `NOT_UNBOUND` when a sale holds it; `FLAGGED` when its flag is
   * live (money owed back is never held); `BOUND_ELSEWHERE` when it is held for
   * another context. A bind (or a sale marking it created) lets go of the
   * hold. The 24 h sweep still reads a held capture as UNBOUND: a hold does not
   * extend the window. Throws a plain `Error` when the store keeps no holds
   * ({@link holdsReady}).
   */
  hold(key: CaptureKey, holdKey: string, tx?: TTx): Promise<{ held: boolean }>;
  /**
   * The captures held for this sale context and still usable: UNBOUND, flag
   * not live. Oldest first. Throws a plain `Error` when the store keeps no
   * holds ({@link holdsReady}).
   */
  findHeld(clientId: string, holdKey: string, tx?: TTx): Promise<TerminalCaptureRecord[]>;
  /** The store keeps holds (it answers `findHeld`): {@link hold} and {@link findHeld} work. */
  readonly holdsReady: boolean;
}

const NO_HOLDS = 'The capture store keeps no holds: map a nullable hold_key column and answer findHeld (see the README).';

function heldReader(store: TerminalCaptureStore): NonNullable<TerminalCaptureStore['findHeld']> {
  if (!store.findHeld) throw new Error(NO_HOLDS);
  return store.findHeld.bind(store);
}

function validHoldKey(holdKey: string): string {
  if (typeof holdKey !== 'string' || holdKey.length === 0) throw new Error('holdKey must be a non-empty string.');
  return holdKey;
}

async function hold(store: TerminalCaptureStore, key: CaptureKey, holdKey: string): Promise<{ held: boolean }> {
  validHoldKey(holdKey);
  heldReader(store);
  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt += 1) {
    const current = await store.find(key.clientId, key.transactionCode);
    if (!current) throw new CaptureError('NOT_FOUND', key.transactionCode, REFUSALS.NOT_FOUND);
    const decision = holdDecision(current, holdKey);
    if (decision === 'replay') return { held: false };
    if (decision !== 'hold') throw new CaptureError(decision, key.transactionCode, HOLD_REFUSALS[decision]);
    // The hold is part of the predicate: two contexts racing for one capture, the second decides again.
    if (await store.writeIfUnchanged({ ...versionOf(current), holdKey: null }, { holdKey })) return { held: true };
  }
  throw new CaptureError('CONTENDED', key.transactionCode, REFUSALS.CONTENDED);
}

/** The ledger's holds over its store. */
export function captureHolds<TTx>(storeFor: TerminalCaptureStoreFor<TTx>): TerminalCaptureHolds<TTx> {
  return {
    hold: (key, holdKey, tx) => hold(storeFor(tx), key, holdKey),
    async findHeld(clientId, holdKey, tx) {
      return heldReader(storeFor(tx))(clientId, validHoldKey(holdKey));
    },
    get holdsReady() {
      return typeof storeFor().findHeld === 'function';
    },
  };
}
