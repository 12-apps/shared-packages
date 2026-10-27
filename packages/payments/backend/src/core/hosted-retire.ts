import { UnsupportedOperationError } from './errors';
import type { ChargeSnapshot, ChargeStatus, MerchantRef } from './types';

/**
 * RETIRING THE HOSTED LINK A WALK MOVED PAST (FUT-4072).
 *
 * When the parked link is not reused (`hosted-landing.ts`), the walk mints a new
 * charge and the old link is still payable at its provider. Left alone that is
 * two payable charges for one payable — the exact double payment FUT-604 exists
 * to prevent, now produced by the fix for the trapped payable. So the link is
 * retired, in this order:
 *
 *  1. VOIDED at the provider, when its adapter can (`cancelCharge`). The void
 *     goes through the gateway, so a provider that refuses it is reported to
 *     the host's `onProviderFailure` like every other follow-up call (FUT-4074).
 *  2. Otherwise RECORDED AS SUPERSEDED through the host's recorder: the link
 *     stays payable at a provider that cannot void (or would not, this time),
 *     and a payment of it must be caught by the host's superseded / duplicate
 *     payment handling rather than settle unnoticed. With no recorder wired the
 *     line is logged as an error by name — never silent.
 *
 * ONLY ONCE THE NEW CHARGE IS LIVE. A declined or failed new charge leaves the
 * buyer with nothing else to pay, and a recorded-superseded link they then pay
 * would be refused by the host. The link is retired by the next attempt that
 * does produce a live charge.
 *
 * NEVER THROWS. The new charge is valid and the buyer is waiting on it; failing
 * their checkout because an OLD link could not be retired would turn a stale
 * link into an outage of the payment path.
 */

/** Why a moved-past link is still payable at its provider. */
export type SupersededWhy = 'VOID_UNSUPPORTED' | 'VOID_FAILED';

/** A moved-past charge the provider could not void — still payable there. */
export interface SupersededCharge {
  merchant: MerchantRef;
  /** The host's own reference for the thing being paid. */
  reference: string;
  /** The moved-past charge, as last stored. */
  snapshot: ChargeSnapshot;
  /** The charge that replaced it. */
  replacedBy: ChargeSnapshot;
  why: SupersededWhy;
}

/**
 * The host's record of a superseded charge. Awaited and CONTAINED: a recorder
 * that throws is logged and cannot fail the buyer's new charge.
 */
export type SupersededRecorder = (charge: SupersededCharge) => Promise<void> | void;

export interface RetireDeps {
  gateway: {
    cancelCharge(merchant: MerchantRef, provider: string, providerChargeId: string): Promise<ChargeSnapshot>;
  };
  log: { warn(message: string): void; error(message: string): void };
  onSuperseded?: SupersededRecorder;
}

interface RetireInput {
  merchant: MerchantRef;
  reference: string;
  movedPast: readonly ChargeSnapshot[];
  /** The charge this attempt produced. */
  raised: ChargeSnapshot;
}

/** A charge a buyer holds or has paid — the only kind that may replace a link. */
const LIVE: ReadonlySet<ChargeStatus> = new Set<ChargeStatus>(['PENDING', 'AUTHORIZED', 'PAID']);

function sameCharge(a: ChargeSnapshot, b: ChargeSnapshot): boolean {
  return a.provider === b.provider && a.providerChargeId === b.providerChargeId;
}

/** Void every moved-past link, or record the ones that could not be voided. */
export async function retireMovedPast(deps: RetireDeps, input: RetireInput): Promise<void> {
  const stale = input.movedPast.filter((snapshot) => !sameCharge(snapshot, input.raised));
  if (stale.length === 0) return;
  if (!LIVE.has(input.raised.status)) {
    deps.log.warn(
      `payments.superseded kept ${stale.length} hosted link(s) on ${input.reference}: ` +
        `the new ${input.raised.provider} charge is ${input.raised.status}`,
    );
    return;
  }
  for (const snapshot of stale) await retireOne(deps, input, snapshot);
}

async function retireOne(deps: RetireDeps, input: RetireInput, snapshot: ChargeSnapshot): Promise<void> {
  const what =
    `${snapshot.provider} charge ${snapshot.providerChargeId} ` +
    `(${snapshot.amount.amountCents} ${snapshot.amount.currency}) on ${input.reference}`;
  let why: SupersededWhy;
  try {
    await deps.gateway.cancelCharge(input.merchant, snapshot.provider, snapshot.providerChargeId);
    deps.log.warn(`payments.void voided moved-past hosted ${what}`);
    return;
  } catch (error) {
    why = error instanceof UnsupportedOperationError ? 'VOID_UNSUPPORTED' : 'VOID_FAILED';
    const line = `payments.void ${why === 'VOID_UNSUPPORTED' ? 'unsupported' : 'failed'} for moved-past hosted ${what}`;
    if (why === 'VOID_UNSUPPORTED') deps.log.warn(line);
    else deps.log.error(`${line}: ${reason(error)}`);
  }
  await recordSuperseded(deps, { ...input, snapshot, replacedBy: input.raised, why }, what);
}

async function recordSuperseded(
  deps: RetireDeps,
  charge: SupersededCharge,
  what: string,
): Promise<void> {
  if (!deps.onSuperseded) {
    deps.log.error(
      `payments.superseded ${what} stays payable and no superseded recorder is wired: reconcile by hand`,
    );
    return;
  }
  try {
    await deps.onSuperseded({
      merchant: charge.merchant,
      reference: charge.reference,
      snapshot: charge.snapshot,
      replacedBy: charge.replacedBy,
      why: charge.why,
    });
  } catch (error) {
    deps.log.error(`payments.superseded could not record ${what}: ${reason(error)}`);
  }
}

/** A STRING, never the error object — a provider error retains the buyer's data. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
