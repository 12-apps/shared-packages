import type { ChargeSnapshot, DeclineReason } from './types';

/**
 * What a decline MEANS, as properties of this package's taxonomy — ported
 * from the first adopting host's collection policy (FUT-761).
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

/**
 * Reasons that are about the card DATA the buyer typed — a mistyped number,
 * CVV or expiry, or a card past its date (FUT-4401). The buyer standing at the
 * checkout can correct them in place, and the corrected card is a different
 * presentation than the refused one.
 */
const CARD_DATA: ReadonlySet<DeclineReason> = new Set<DeclineReason>(['INVALID_CARD', 'EXPIRED_CARD']);

/**
 * Whether a refused CHARGE leaves its payable chargeable — the one rule a
 * checkout host applies when it books a refusal (FUT-1145, FUT-4401).
 *
 * `retriable` has ONE meaning everywhere: the provider's verdict on whether the
 * SAME instrument may be presented again (PagBank's "Retentável" column). It
 * never meant "no other attempt can succeed", and reading it that way is what
 * closed a buyer's order on a mistyped CVV — PagBank's 20007 is
 * `INVALID_CARD, retriable:false`, because resending the identical card data
 * will fail identically — and left them a screen that told them to correct the
 * card with nothing to correct it in.
 *
 * So the payable stays open when the same card may be retried, or when the
 * refusal is about the card's data, which the buyer corrects (a different
 * presentation, so "do not retry" does not reach it). Every other refusal keeps
 * the behaviour hosts had: `false` and silence (`undefined`) close it, and the
 * buyer's next attempt goes on a fresh payable.
 */
export function declineLeavesPayableOpen(refusal: { reason?: DeclineReason; retriable?: boolean }): boolean {
  if (refusal.retriable === true) return true;
  return refusal.reason !== undefined && CARD_DATA.has(refusal.reason);
}
