import type { PendingVerification } from '../config/types';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ChargeSnapshot, ResolvedCredentials } from '../core/types';

/**
 * The card phase's lost-answer machinery (FUT-679) — shared by the verify
 * flow and the reconcile sweep.
 *
 * A card verification charge is synchronous: create, read the answer, refund.
 * When the ANSWER is lost — a timeout after PagBank already created the order,
 * a reset mid-response — a real cent may exist that nothing remembers: the
 * charge is raised through the adapter directly (no stored charge row), and
 * PagBank's webhook `verify` proves the sender rather than the payment, so
 * neither of the sweep's durable proofs will ever appear for it.
 *
 * What the attempt DOES have is its deterministic reference, which the adapter
 * indexed the order under at creation — exactly what `findChargeByReference`
 * exists to answer. So the card flow writes its intent BEFORE the create (the
 * same write-ahead the redirect flow performs in `rememberAttempt`), clears it
 * on every settled answer, and everything that later finds the row still
 * standing — the retry, the settings-screen heal, the sweep — resolves it by
 * asking the provider. The whole mechanism is gated on the adapter declaring
 * `findChargeByReference`: without the probe no machinery could ever resolve
 * the row, and a record nothing can act on would only block retries.
 */

/** The write-ahead intent recorded before the card-phase `createCharge`. */
export function cardAttemptRecord(reference: string): PendingVerification {
  return { reference, checkoutUrl: '', startedAt: new Date().toISOString(), phase: 'CARD' };
}

/** Whether this pending row is a card attempt (vs a redirect link). */
export function isCardAttemptRecord(pending: PendingVerification): boolean {
  return pending.phase === 'CARD';
}

/**
 * What became of an attempt whose answer was lost, as the provider tells it.
 *
 * `PROVEN` means money moved (or moved and came back): the merchant
 * demonstrably charges, which is the fact activation exists to establish.
 * `GONE` is the provider's own word that no live charge exists — safe to
 * forget and try again. `UNANSWERED` is the one outcome that must change
 * nothing: an unanswerable question is not a "no".
 */
export type LostCardAttempt =
  | { kind: 'PROVEN'; providerChargeId: string; alreadyRefunded: boolean }
  | { kind: 'DECLINED'; declineReason?: string }
  | { kind: 'GONE' }
  | { kind: 'OPEN' }
  | { kind: 'UNANSWERED'; error: unknown };

/**
 * Ask the provider what a lost attempt's reference actually became.
 *
 * Never throws: both callers act on `UNANSWERED` by LEAVING the write-ahead
 * row in place, which is the safe outcome — unlike the charge walk's probe,
 * no failover decision hinges on distinguishing the probe's own failure, and
 * a throw out of the settings-screen heal would take the whole page down.
 */
export async function probeLostCardAttempt(
  adapter: PaymentProviderAdapter,
  reference: string,
  credentials: ResolvedCredentials,
): Promise<LostCardAttempt> {
  if (!adapter.findChargeByReference) {
    return { kind: 'UNANSWERED', error: new Error(`${adapter.name} cannot be probed by reference`) };
  }
  let snapshot: ChargeSnapshot | null;
  try {
    snapshot = await adapter.findChargeByReference(reference, credentials);
  } catch (error) {
    return { kind: 'UNANSWERED', error };
  }
  return classifyLostAttempt(snapshot);
}

/**
 * `REFUNDED`/`PARTIALLY_REFUNDED` count as PROVEN: the charge was paid first
 * — a refund of money that never moved does not exist — so the connection
 * demonstrably charges, and the cent needs no second refund.
 */
function classifyLostAttempt(snapshot: ChargeSnapshot | null): LostCardAttempt {
  if (!snapshot) return { kind: 'GONE' };
  const { status, providerChargeId } = snapshot;
  if (status === 'PAID' || status === 'AUTHORIZED') {
    return { kind: 'PROVEN', providerChargeId, alreadyRefunded: false };
  }
  if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') {
    return { kind: 'PROVEN', providerChargeId, alreadyRefunded: true };
  }
  if (status === 'DECLINED') {
    return {
      kind: 'DECLINED',
      ...(snapshot.declineReason ? { declineReason: snapshot.declineReason } : {}),
    };
  }
  // EXPIRED and CANCELED never took the buyer's money and never will.
  if (status === 'EXPIRED' || status === 'CANCELED') return { kind: 'GONE' };
  return { kind: 'OPEN' };
}

/**
 * Give the cent back, best effort. A failed refund must never fail the caller
 * — the merchant demonstrably charges, which is what was being proven — so it
 * is reported as `false` and the owner sees a cent they can reconcile.
 */
export async function refundCent(
  adapter: PaymentProviderAdapter,
  providerChargeId: string,
  credentials: ResolvedCredentials,
): Promise<boolean> {
  if (!adapter.refund) return false;
  try {
    await adapter.refund({ providerChargeId, reason: 'verification' }, credentials);
    return true;
  } catch {
    return false;
  }
}
