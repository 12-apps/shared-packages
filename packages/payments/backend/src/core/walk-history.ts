import type { AttemptLedger } from './ports';
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
 */

/** The text the walk records on a breaker skip — matched, so it is shared. */
export const OUTAGE_SKIP = 'recent failures indicate an outage';

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
