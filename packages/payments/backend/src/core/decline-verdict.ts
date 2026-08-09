import type { ChargeSnapshot, DeclineReason } from './types';

/**
 * What a decline MEANS, as properties of this package's taxonomy — ported
 * from the future-pay host's collection policy (FUT-761).
 *
 * The split matters: which reasons kill the INSTRUMENT (rather than the
 * moment) and which snapshots forbid another presentation are statements
 * about `DeclineReason`/`ChargeSnapshot`, so they live here, next to the
 * vocabulary they describe, where a new reason is forced to take a position.
 * What to DO with the verdict — retry ladders, grace windows, when to ask
 * for a different card — is each host's commercial policy and deliberately
 * NOT modelled here.
 */

/** Reasons that mean the INSTRUMENT is finished, not that the moment was bad. */
const INSTRUMENT_DEAD: ReadonlySet<DeclineReason> = new Set<DeclineReason>([
  'INVALID_CARD',
  'EXPIRED_CARD',
  'FRAUD_SUSPECTED',
]);

/**
 * True when this decline reason says the card itself is dead — asking the
 * holder for a different instrument is the only move that can ever work.
 */
export function declineMeansInstrumentDead(reason: DeclineReason): boolean {
  return INSTRUMENT_DEAD.has(reason);
}

/**
 * True when the provider explicitly said not to present this instrument
 * again. It catches the declines the reason taxonomy cannot express as
 * terminal — a cancelled recurring mandate, an exhausted attempt limit — and
 * treating them as soft declines is what keeps presenting a debit the holder
 * revoked. Absent (`undefined`) means the provider took no position.
 */
export function declineForbidsRetry(snapshot: Pick<ChargeSnapshot, 'declineRetriable'>): boolean {
  return snapshot.declineRetriable === false;
}
