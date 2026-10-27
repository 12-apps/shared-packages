import type { AttemptLedger } from './ports';
import type { ProviderHealth } from './provider-health';
import type { MerchantRef, ProviderName } from './types';

/**
 * WHAT A FINISHED WALK MOVED PAST, and why that can be trusted (FUT-4072).
 *
 * A parked hosted link at the chain's SECOND provider is either a link the
 * chain has since been reordered away from (the trapped payable: reuse would
 * keep sending the buyer to a provider the store no longer routes to first)
 * or a link the walk landed on because the head was DOWN when it was minted
 * (FUT-563: reusing it is exactly FUT-604's double-charge protection). The
 * chain alone cannot tell the two apart; the ledger of the walk that minted
 * the link can. Only provider-side outcomes count:
 *
 *  - FAILED_OVER — the provider failed and provably created nothing;
 *  - SKIPPED by the outage breaker — the same outage, seen from its second
 *    minute on.
 *
 * Every other skip is deliberately NOT "walked past": a missing instrument, a
 * missing buyer field or an unsupported method is about THAT request, and a
 * re-tap that brings what was missing must be able to land there.
 *
 * AND ONLY WHILE THE OUTAGE LASTS. A link minted during an outage is reused
 * only while every provider it walked past is STILL unavailable — its outage
 * breaker still open, so a walk now would skip it too. Once the head is healthy
 * again the store's chain is the answer: the checkout walks it and retires the
 * link. Without a breaker (`ProviderHealth`) nothing says the head is still
 * down, so nothing is "still walked past" and every re-tap walks.
 */

/** The text the walk records on a breaker skip — matched, so it is shared. */
export const OUTAGE_SKIP = 'recent failures indicate an outage';

/** The providers the walk under `idempotencyKey` moved past, per its ledger. */
export async function providersWalkedPast(
  attempts: AttemptLedger,
  merchant: MerchantRef,
  idempotencyKey: string,
): Promise<ProviderName[]> {
  const rows = await attempts.listByIdempotencyKey(merchant, idempotencyKey);
  return rows
    .filter(
      (row) =>
        row.outcome === 'FAILED_OVER' ||
        (row.outcome === 'SKIPPED' && (row.error ?? '').includes(OUTAGE_SKIP)),
    )
    .map((row) => row.provider);
}

/** The subset of {@link providersWalkedPast} the outage breaker still keeps out. */
export async function providersStillWalkedPast(
  attempts: AttemptLedger,
  health: ProviderHealth | undefined,
  merchant: MerchantRef,
  idempotencyKey: string,
): Promise<ProviderName[]> {
  if (!health) return [];
  const walkedPast = await providersWalkedPast(attempts, merchant, idempotencyKey);
  const still: ProviderName[] = [];
  for (const provider of new Set(walkedPast)) {
    // `isAvailable` is not a pure read: once a provider's cooldown has elapsed
    // it lets ONE half-open trial through, closing the circuit, and asking here
    // spends that step. That is acceptable, and in fact what is wanted: the
    // answer is then "available", so the checkout walks the chain — and the
    // walk's own call is the trial, against a circuit that will re-open on the
    // next outage signal exactly as it would have.
    if (!(await health.isAvailable(provider))) still.push(provider);
  }
  return still;
}
