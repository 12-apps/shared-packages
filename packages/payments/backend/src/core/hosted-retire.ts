import type { ChargeQueryStore } from './charge-queries';
import { UnsupportedOperationError } from './errors';
import { reportProviderFailure, type ProviderFailureReporter } from './provider-failure';
import type { SupersededWhy } from './supersession';
import type { ChargeSnapshot, ChargeStatus, MerchantRef } from './types';

export type { SupersededWhy } from './supersession';

/**
 * RETIRING THE HOSTED LINKS A CHECKOUT MOVED PAST (FUT-4072).
 *
 * When a parked link is not handed back (`hosted-landing.ts`), the buyer ends
 * up holding another charge — a new one, or a different live one that was
 * reused — and the old link is still payable at its provider. Left alone that
 * is two payable charges for one payable, the exact double payment FUT-604
 * exists to prevent. So each moved-past link is retired, ONCE:
 *
 *  1. VOIDED at the provider when its adapter can (`cancelCharge`) AND the
 *     provider confirms it — the answer must read CANCELED (or another state a
 *     buyer cannot pay). The void goes through the gateway, so a refusal is
 *     reported to the host's `onProviderFailure` (FUT-4074).
 *  2. Otherwise MARKED SUPERSEDED on the stored row
 *     (`ChargeQueryStore.markSuperseded`) — so it is never offered back as the
 *     live charge and never retired twice — and then RECORDED through the
 *     host's recorder, so a payment of it reaches the host's superseded /
 *     duplicate-payment handling instead of settling unnoticed. With no
 *     recorder wired the line is logged as an error by name — never silent.
 *  3. A void the provider answers with a SETTLED charge (`PAID_BEFORE_VOID`:
 *     the buyer paid the old link in the window) is not superseded — it IS the
 *     payment. It is logged as an error, reported to `onProviderFailure`, and
 *     becomes the buyer's answer ({@link answerHeld}); the charge that was
 *     about to replace it is retired against it instead.
 *
 * ONLY ONCE THE CHARGE THE BUYER HOLDS IS LIVE. A declined or failed charge
 * leaves the buyer with nothing else to pay, and a recorded-superseded link they
 * then pay would be refused by the host. The link is retired by the next
 * attempt that does produce a live one. A PENDING charge counts as live: it is
 * what the buyer is now holding — a QR, a hosted page, a card awaiting 3-D
 * Secure. If that 3-D Secure then fails, the next attempt mints a fresh link;
 * the superseded one, paid anyway, reaches the host's superseded handling.
 *
 * NEVER THROWS. The buyer is waiting on the charge they hold; failing their
 * checkout because an OLD link could not be retired would turn a stale link
 * into an outage of the payment path.
 */

/** A moved-past charge that is still the buyer's to pay — or was paid anyway. */
export interface SupersededCharge {
  merchant: MerchantRef;
  /** The host's own reference for the thing being paid. */
  reference: string;
  /** The moved-past charge, as last known. */
  snapshot: ChargeSnapshot;
  /** The charge that replaced it. */
  replacedBy: ChargeSnapshot;
  why: SupersededWhy;
}

/**
 * The host's record of a superseded charge. Called once per charge in the
 * ordinary case — the stored mark keeps it from being met again — but it MUST
 * be idempotent on `(snapshot.provider, snapshot.providerChargeId)`: a store
 * without `markSuperseded`, or a mark that failed, meets the same link on the
 * next attempt and records it again. Awaited and CONTAINED: a recorder that
 * throws is logged and cannot fail the buyer's charge.
 */
export type SupersededRecorder = (charge: SupersededCharge) => Promise<void> | void;

export interface RetireDeps {
  gateway: {
    cancelCharge(merchant: MerchantRef, provider: string, providerChargeId: string): Promise<ChargeSnapshot>;
  };
  charges: Pick<ChargeQueryStore, 'markSuperseded'>;
  log: { warn(message: string): void; error(message: string): void };
  onSuperseded?: SupersededRecorder;
  /** Told when a void comes back SETTLED (FUT-4074). */
  onProviderFailure?: ProviderFailureReporter;
}

interface RetireInput {
  merchant: MerchantRef;
  reference: string;
  movedPast: readonly ChargeSnapshot[];
  /** The charge the buyer holds now: raised by this attempt, or reused. */
  raised: ChargeSnapshot;
}

/** A charge a buyer holds or has paid — the only kind that may replace a link. */
const LIVE: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['PENDING', 'AUTHORIZED', 'PAID']);
/** A void answer a buyer can no longer pay. */
const GONE: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['CANCELED', 'EXPIRED', 'DECLINED']);

function sameCharge(a: ChargeSnapshot, b: ChargeSnapshot): boolean {
  return a.provider === b.provider && a.providerChargeId === b.providerChargeId;
}

/**
 * Void every moved-past link, or mark and record the ones still payable.
 * Answers the first link the provider reported PAID instead of voiding — the
 * buyer already paid THAT one — or null.
 */
export async function retireMovedPast(deps: RetireDeps, input: RetireInput): Promise<ChargeSnapshot | null> {
  const stale = input.movedPast.filter((snapshot) => !sameCharge(snapshot, input.raised));
  if (stale.length === 0) return null;
  if (!LIVE.has(input.raised.status)) {
    deps.log.warn(
      `payments.superseded kept ${stale.length} hosted link(s) on ${input.reference}: ` +
        `the ${input.raised.provider} charge the buyer holds is ${input.raised.status}`,
    );
    return null;
  }
  let paid: ChargeSnapshot | null = null;
  for (const snapshot of stale) {
    const settled = await retireOne(deps, input, snapshot);
    paid = paid ?? settled;
  }
  return paid;
}

/** What the buyer is answered with once the moved-past links are retired. */
export interface HeldAnswer {
  answer: ChargeSnapshot;
  /** The answer is an EARLIER charge the buyer already paid (`PAID_BEFORE_VOID`). */
  paidEarlier: boolean;
}

/**
 * Retire the moved-past links against the charge the buyer holds — and when
 * one of them turns out to be PAID already, answer with THAT one: the buyer
 * paid, so the checkout must show paid rather than a fresh QR or page. The
 * charge they were about to be handed is then itself retired against the paid
 * one (voided, or marked and recorded superseded), so it cannot be paid twice.
 */
export async function answerHeld(
  deps: RetireDeps,
  input: Omit<RetireInput, 'raised'> & { held: ChargeSnapshot },
): Promise<HeldAnswer> {
  const { held, ...rest } = input;
  const paid = await retireMovedPast(deps, { ...rest, raised: held });
  if (!paid) return { answer: held, paidEarlier: false };
  await retireMovedPast(deps, { ...rest, movedPast: [held], raised: paid });
  return { answer: paid, paidEarlier: true };
}

function describe(snapshot: ChargeSnapshot, reference: string): string {
  return (
    `${snapshot.provider} charge ${snapshot.providerChargeId} ` +
    `(${snapshot.amount.amountCents} ${snapshot.amount.currency}) on ${reference}`
  );
}

/** Ask the provider to void; answer null when it is gone, else why it is not. */
async function voidAt(deps: RetireDeps, input: RetireInput, snapshot: ChargeSnapshot, what: string) {
  let answer: ChargeSnapshot;
  try {
    answer = await deps.gateway.cancelCharge(input.merchant, snapshot.provider, snapshot.providerChargeId);
  } catch (error) {
    if (error instanceof UnsupportedOperationError) {
      deps.log.warn(`payments.void unsupported for moved-past hosted ${what}`);
      return { why: 'VOID_UNSUPPORTED' as const, latest: snapshot };
    }
    deps.log.error(`payments.void failed for moved-past hosted ${what}: ${reason(error)}`);
    return { why: 'VOID_FAILED' as const, latest: snapshot };
  }
  if (GONE.has(answer.status)) {
    deps.log.warn(`payments.void voided moved-past hosted ${what} (${answer.status})`);
    return null;
  }
  if (answer.status === 'PENDING') {
    deps.log.error(`payments.void not confirmed for moved-past hosted ${what}: still PENDING`);
    return { why: 'VOID_NOT_CONFIRMED' as const, latest: answer };
  }
  const message =
    `PAID_BEFORE_VOID: moved-past hosted ${what} was ${answer.status} before the void: ` +
    `the buyer paid it, so it is the answer and the charge that replaced it is retired`;
  deps.log.error(`payments.void ${message}`);
  reportProviderFailure(deps.onProviderFailure, {
    path: 'CANCEL',
    severity: 'error',
    merchant: input.merchant,
    provider: snapshot.provider,
    reference: snapshot.providerChargeId,
    message,
  });
  return { paid: answer };
}

/** Retire one link; answers it when the provider reported it PAID instead. */
async function retireOne(
  deps: RetireDeps,
  input: RetireInput,
  snapshot: ChargeSnapshot,
): Promise<ChargeSnapshot | null> {
  const what = describe(snapshot, input.reference);
  const kept = await voidAt(deps, input, snapshot, what);
  if (!kept) return null;
  if ('paid' in kept) return kept.paid ?? null;
  await markSuperseded(deps, input, snapshot, kept.why, what);
  await recordSuperseded(
    deps,
    {
      merchant: input.merchant,
      reference: input.reference,
      snapshot: kept.latest,
      replacedBy: input.raised,
      why: kept.why,
    },
    what,
  );
  return null;
}

/** The stored mark — FIRST, so a recorder that throws still leaves it retired. */
async function markSuperseded(
  deps: RetireDeps,
  input: RetireInput,
  snapshot: ChargeSnapshot,
  why: SupersededWhy,
  what: string,
): Promise<void> {
  const mark = deps.charges.markSuperseded;
  if (!mark) {
    deps.log.error(`payments.superseded cannot mark ${what}: the charge store has no markSuperseded`);
    return;
  }
  try {
    await mark.call(deps.charges, input.merchant, snapshot.provider, snapshot.providerChargeId, {
      at: new Date().toISOString(),
      replacedBy: input.raised.providerChargeId,
      why,
    });
  } catch (error) {
    deps.log.error(`payments.superseded could not mark ${what}: ${reason(error)}`);
  }
}

async function recordSuperseded(deps: RetireDeps, charge: SupersededCharge, what: string): Promise<void> {
  if (!deps.onSuperseded) {
    deps.log.error(
      `payments.superseded ${what} (${charge.why}) and no superseded recorder is wired: reconcile by hand`,
    );
    return;
  }
  try {
    await deps.onSuperseded(charge);
  } catch (error) {
    deps.log.error(`payments.superseded could not record ${what}: ${reason(error)}`);
  }
}

/** A STRING, never the error object — a provider error retains the buyer's data. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
