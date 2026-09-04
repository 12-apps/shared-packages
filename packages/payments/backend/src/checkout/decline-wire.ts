import { attachedChargeOf } from './runtime';
import type { ChargeSnapshot, DeclineReason } from '../core/types';
import type { ChargeCorrelationPort, Payable } from './types';

/**
 * WHAT A REFUSAL TELLS THE BUYER, and what it tells the host (FUT-1145).
 *
 * Its own module because `flows-charge.ts` is at its size ceiling and because
 * these two are one decision seen from both sides: the same classification the
 * adapters have produced since FUT-340 goes out on the wire for the buyer's
 * screen to word, and into the correlation write for the host to act on.
 */

/**
 * WHY the card was refused, on the wire (FUT-1145).
 *
 * The adapters have classified declines since FUT-340 — 33 PagBank codes plus
 * their issuer sub-reasons, each carrying the vendor's own retry verdict — and
 * this route answered `{ status }` and dropped the lot. So an expired card, a
 * card reported stolen, no funds, a cancelled recurring mandate and "attempts
 * exhausted, DO NOT RETRY" all reached the buyer as one sentence with one
 * button, and pressing it produced the identical refusal plus a second failed
 * order in their history.
 *
 * EMPTY for anything that is not a refusal. An approved charge has no reason,
 * and a PENDING one has not been refused — answering either with a decline
 * shape would invite a client to render one.
 *
 * Both fields stay OPTIONAL on the wire: an adapter that classifies nothing
 * publishes nothing, and the client renders exactly what it rendered before.
 */
export function declineOf(snapshot: ChargeSnapshot): {
  declineReason?: DeclineReason;
  retriable?: boolean;
} {
  if (snapshot.status !== 'DECLINED') return {};
  return {
    ...(snapshot.declineReason ? { declineReason: snapshot.declineReason } : {}),
    ...(snapshot.declineRetriable === undefined ? {} : { retriable: snapshot.declineRetriable }),
  };
}

/**
 * What the host is told about a settled-or-refused card charge.
 *
 * Its own function because the retry verdict rides along conditionally
 * (FUT-1145) and a conditional spread inside the call site pushed
 * `chargeInstrument` over the complexity gate — which is the gate doing its
 * job: the money path should read as a sequence of named decisions.
 */
export function cardOutcomeOf(
  payable: Payable,
  snapshot: ChargeSnapshot,
  refusal: { retriable?: boolean },
): Parameters<ChargeCorrelationPort['recordCardOutcome']>[0] {
  return {
    ref: payable.ref,
    charge: attachedChargeOf(snapshot),
    // A decline is a business OUTCOME the provider reports, not an error.
    approved: snapshot.status === 'PAID' || snapshot.status === 'AUTHORIZED',
    amount: payable.amount,
    ...(refusal.retriable === undefined ? {} : { retriable: refusal.retriable }),
  };
}
