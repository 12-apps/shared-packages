import { ChargeNotPersistedError, PaymentsError } from './errors';
import type { AttemptOutcome, FailureBucket, ProbeResult } from './failover';
import type { AttemptLedger, ChargeStore, CredentialStore, StoredCharge } from './ports';
import type { ProviderHealth } from './provider-health';
import type { ProviderRegistry } from './registry';
import type { ChargeInput, ChargeSnapshot, MerchantRef, ProviderName } from './types';

/**
 * The context a failover walk carries, and the storage operations every step
 * performs against it.
 *
 * Kept apart from the attempt state machine in `charge-attempt.ts` because
 * the ORDER of the two writes here is a safety property in its own right:
 * the ledger row goes down BEFORE the charge store, so a store failure still
 * leaves durable evidence that the provider created a charge.
 */

/**
 * Whether a technical failure alone advances the chain, or a DECLINE does
 * too. Retrying a declined card on a second acquirer ("cascading") is a real
 * practice and a real fraud-and-fees risk, so it is opt-in per merchant.
 */
export type FailoverPolicy = 'TECHNICAL' | 'TECHNICAL_AND_DECLINE';

export interface ChargeWalkDeps {
  providers: ProviderRegistry;
  credentials: CredentialStore;
  charges: ChargeStore;
  attempts: AttemptLedger;
  failoverPolicy: FailoverPolicy;
  /** Per-merchant override; falls back to `failoverPolicy` when absent. */
  failoverPolicyFor?: (merchant: MerchantRef) => Promise<FailoverPolicy>;
  /**
   * Outage breaker. OPTIONAL, and its absence is exactly today's behaviour —
   * every provider is always considered available — so a host that wires
   * nothing keeps the walk it already had.
   */
  health?: ProviderHealth;
}

export interface AttemptContext {
  merchant: MerchantRef;
  input: ChargeInput;
  attemptNo: number;
}
/**
 * Most ledger writes are best-effort ON PURPOSE. A charge that reached the
 * provider must not be reported as failed because the audit insert hit a
 * dead connection — the money already moved, and the caller needs the truth
 * about the money, not about our bookkeeping. A lost FAILED_OVER or SKIPPED
 * row costs only that a retry re-attempts a provider already proven to have
 * charged nothing, which is safe.
 *
 * The STOPPED row is the exception, and `recordAttempt` returns whether the
 * write landed so its caller can act on that. It is the ONLY durable evidence
 * that a provider may be holding an unresolved charge; lose it and a retry
 * has nothing to re-probe and will issue a fresh request. Swallowing that
 * failure would quietly delete the guarantee this whole module exists for.
 */
export async function recordAttempt(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  fields: {
    outcome: AttemptOutcome;
    failureBucket?: FailureBucket | null;
    probeResult?: ProbeResult | null;
    providerChargeId?: string | null;
    error?: string | null;
  },
): Promise<boolean> {
  try {
    await deps.attempts.record({
      merchant: ctx.merchant,
      idempotencyKey: ctx.input.idempotencyKey ?? null,
      reference: ctx.input.reference,
      provider,
      attemptNo: ctx.attemptNo,
      ...fields,
    });
    return true;
  } catch {
    return false;
  }
}
/**
 * Health bookkeeping, always best-effort.
 *
 * It decides where the NEXT charge is sent; it has no authority over this one.
 * Letting a health-store failure propagate would fail a charge that had already
 * succeeded, or that the classifier had already handled correctly — trading a
 * real payment for a cache update.
 *
 * Only two events are reported, and the gap between them is deliberate. A
 * failure that is neither is NEUTRAL and moves no counter: a 401 is one
 * merchant's credentials and a 400 is our payload, so counting either as an
 * outage would open the circuit on a healthy vendor — while counting them as
 * proof of life would let a trickle of bad requests reset the counter an outage
 * is climbing. Only the full payment stack can produce a decline or a charge.
 */
export async function noteHealth(
  deps: ChargeWalkDeps,
  provider: ProviderName,
  event: 'ANSWERED' | 'OUTAGE',
): Promise<void> {
  if (!deps.health) return;
  try {
    if (event === 'ANSWERED') await deps.health.recordSuccess(provider);
    else await deps.health.recordFailure(provider);
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * May this provider be sent NEW work?
 *
 * A PINNED call bypasses the breaker entirely. The caller named this provider,
 * and refusing on the strength of other charges' failures would substitute our
 * inference for an explicit instruction — the same reason pinning already
 * overrides the `tried` set. It gets the real attempt and the real error.
 */
export async function breakerAllows(
  deps: ChargeWalkDeps,
  provider: ProviderName,
  pinned: boolean,
): Promise<boolean> {
  if (pinned || !deps.health) return true;
  try {
    return await deps.health.isAvailable(provider);
  } catch {
    // An unreadable breaker must not decide anything. Attempting is the status
    // quo ante, and the walk's own proof rules still govern the result.
    return true;
  }
}

/** Persist a snapshot the walk has decided to keep. */
export async function persist(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  snapshot: ChargeSnapshot,
): Promise<StoredCharge> {
  return deps.charges.create({
    merchant: ctx.merchant,
    reference: ctx.input.reference,
    snapshot,
    idempotencyKey: ctx.input.idempotencyKey,
  });
}
/**
 * Store a charge the provider has already created, converting a failure into
 * an error that still names the charge.
 *
 * A bare store error here would report "database unavailable" and say nothing
 * about the money that is already committed — which is the one fact whoever
 * reads the log actually needs.
 */
export async function persistCreated(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  snapshot: ChargeSnapshot,
  recorded: boolean,
): Promise<StoredCharge> {
  try {
    return await persist(deps, ctx, snapshot);
  } catch (error) {
    // A PaymentsError from the store is already a precise domain answer —
    // a charge id belonging to ANOTHER merchant, say. Wrapping it would
    // relabel a data-integrity violation as an infrastructure blip and hide
    // what actually went wrong. Only unexpected failures get the wrapper.
    if (error instanceof PaymentsError) throw error;
    throw new ChargeNotPersistedError(
      provider,
      snapshot.providerChargeId,
      ctx.input.reference,
      recorded,
      { cause: error },
    );
  }
}

