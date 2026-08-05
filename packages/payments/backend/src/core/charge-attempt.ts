import { chargeInputFor, hasInstrument } from './card-instrument';
import {
  type AttemptContext,
  type ChargeWalkDeps,
  type FailoverPolicy,
  breakerAllows,
  noteHealth,
  persist,
  persistCreated,
  recordAttempt,
} from './charge-context';
import { gateCustomerRequirements } from './customer-gate';
import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  CredentialsError,
  UnknownProviderError,
  UnsupportedOperationError,
} from './errors';
import { type ProbeResult, classifyFailure, describeFailure } from './failover';
import type { StoredCharge } from './ports';
import { isOutageSignal } from './provider-health';
import type { PaymentProviderAdapter } from './provider';
import type {
  ChargeInput,
  ChargeSnapshot,
  DeclineReason,
  MerchantRef,
  ProviderName,
  ResolvedCredentials,
} from './types';

export type { AttemptContext, ChargeWalkDeps, FailoverPolicy };
export { persistCreated, recordAttempt };

/**
 * Statuses that mean the provider is holding — or has held — the buyer's
 * money. Finding one of these during a probe ends the walk: the charge
 * exists, so creating a second one elsewhere would bill the buyer twice.
 */
const LIVE_STATUSES: ReadonlySet<ChargeSnapshot['status']> = new Set([
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);


/**
 * ONE PROVIDER'S TURN in a failover walk: attempt the charge, classify what
 * came back, and — when the answer is ambiguous — probe before letting the
 * walk move on. `charge-walk.ts` owns the loop; this module owns what happens
 * inside a single iteration.
 *
 * Three things are deliberately never done here:
 *   - advance past an unproven failure (that is a double charge)
 *   - persist a charge from an attempt we intend to abandon (that would burn
 *     the idempotency key the next provider needs)
 *   - cascade a decline unless the merchant explicitly asked for it
 */


/** One provider's turn, reduced to what the walk needs to decide next. */
type StepResult =
  | { kind: 'DONE'; charge: StoredCharge }
  | { kind: 'ADVANCE'; failure: { provider: ProviderName; message: string } };

/** Why a provider could not even be attempted. */
type SkipReason = 'UNKNOWN_PROVIDER' | 'UNSUPPORTED_METHOD' | 'NOT_CONNECTED';

interface Skipped {
  skip: string;
  reason: SkipReason;
}


/**
 * The reconciliation probe: ask the provider whether the charge we could not
 * confirm actually exists.
 *
 * A thrown probe error is NOT converted to "no charge". That distinction is
 * the whole safety property — an unanswerable question must stop the walk,
 * never quietly authorize a second attempt elsewhere.
 */
export async function probe(
  adapter: PaymentProviderAdapter,
  reference: string,
  creds: ResolvedCredentials,
): Promise<{ result: ProbeResult; snapshot?: ChargeSnapshot; error?: unknown }> {
  if (!adapter.findChargeByReference) return { result: 'UNSUPPORTED' };
  try {
    const found = await adapter.findChargeByReference(reference, creds);
    if (!found) return { result: 'NOT_CHARGED' };
    // A charge that was canceled or expired never took the buyer's money and
    // never will, so it is not a reason to stop: the next provider can
    // safely be tried. Anything else is live money.
    if (!LIVE_STATUSES.has(found.status) && found.status !== 'DECLINED') {
      return { result: 'NOT_CHARGED', snapshot: found };
    }
    return { result: 'CHARGE_FOUND', snapshot: found };
  } catch (error) {
    return { result: 'PROBE_FAILED', error };
  }
}

/**
 * Handle a provider that worked and said no. Under the default policy a
 * decline is a RESULT: it is persisted and returned, and the chain stops —
 * a second acquirer must not silently see the same card. Only an explicit
 * cascade policy advances, and then the declined snapshot is deliberately
 * NOT persisted, because doing so would consume the idempotency key that the
 * next provider's success needs.
 */
async function handleDecline(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  policy: FailoverPolicy,
  snapshot: ChargeSnapshot | null,
  message: string,
  /**
   * The reason the ADAPTER gave, when the decline arrived as a throw. Without
   * it every thrown decline reached the host as `CARD_DECLINED`: the reason
   * was normalized correctly, carried on the error correctly, and then
   * overwritten here by a literal — so a caller deciding whether to retry
   * could not tell no-funds from a stolen card on the one path where the
   * snapshot is absent and the error is all it has.
   */
  reason: DeclineReason = 'CARD_DECLINED',
): Promise<StepResult> {
  await recordAttempt(deps, ctx, provider, {
    outcome: 'DECLINED',
    failureBucket: 'BUSINESS_OUTCOME',
    providerChargeId: snapshot?.providerChargeId ?? null,
    error: message,
  });
  if (policy === 'TECHNICAL_AND_DECLINE') {
    return { kind: 'ADVANCE', failure: { provider, message } };
  }
  if (snapshot) return { kind: 'DONE', charge: await persist(deps, ctx, snapshot) };
  // The adapter threw rather than returning a DECLINED snapshot, so there is
  // nothing to persist; surface it as the typed decline the host expects.
  throw new ChargeDeclinedError(provider, reason, message);
}

/** Resolve the adapter + credentials for one provider, or explain why not. */
export async function resolveProvider(
  deps: ChargeWalkDeps,
  merchant: MerchantRef,
  provider: ProviderName,
  method: ChargeInput['method'],
): Promise<{ adapter: PaymentProviderAdapter; creds: ResolvedCredentials } | Skipped> {
  if (!deps.providers.has(provider)) {
    return { skip: `provider ${provider} is not registered`, reason: 'UNKNOWN_PROVIDER' };
  }
  const adapter = deps.providers.get(provider);
  // Capability gating PARTICIPATES in failover rather than ending it: a chain
  // whose first provider cannot do boleto should fall through to one that
  // can, not fail the charge outright. A PINNED call keeps the old, precise
  // error — see `skipError`.
  if (!adapter.capabilities.methods.includes(method)) {
    return {
      skip: `provider ${provider} does not support method ${method}`,
      reason: 'UNSUPPORTED_METHOD',
    };
  }
  try {
    const creds = await deps.credentials.getCredentials(merchant, provider);
    if (!creds) return { skip: `provider ${provider} is not connected`, reason: 'NOT_CONNECTED' };
    return { adapter, creds };
  } catch (error) {
    // A configured-but-disabled row throws; that is a skip, not a failure —
    // nothing was sent anywhere.
    if (error instanceof CredentialsError) {
      return { skip: error.message, reason: 'NOT_CONNECTED' };
    }
    throw error;
  }
}

/**
 * The typed error a PINNED call gets when its one provider cannot be used.
 * Failover would swallow these into "nothing succeeded", which is the right
 * answer when there were alternatives and the wrong one when the caller named
 * a single provider and deserves to know exactly what was wrong with it.
 */
function skipError(provider: ProviderName, skipped: Skipped, method: ChargeInput['method']): Error {
  if (skipped.reason === 'UNKNOWN_PROVIDER') return new UnknownProviderError(provider);
  if (skipped.reason === 'UNSUPPORTED_METHOD') {
    return new UnsupportedOperationError(provider, `method ${method}`);
  }
  return new CredentialsError(provider, skipped.skip);
}

/** The AMBIGUOUS branch: probe, then decide whether the walk may continue. */
async function afterAmbiguous(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  policy: FailoverPolicy,
  adapter: PaymentProviderAdapter,
  creds: ResolvedCredentials,
  error: unknown,
  message: string,
): Promise<StepResult> {
  const outcome = await probe(adapter, ctx.input.reference, creds);

  if (outcome.result === 'NOT_CHARGED') {
    await recordAttempt(deps, ctx, provider, {
      outcome: 'FAILED_OVER',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'NOT_CHARGED',
      error: message,
    });
    return { kind: 'ADVANCE', failure: { provider, message } };
  }

  if (outcome.result === 'CHARGE_FOUND' && outcome.snapshot) {
    const found = outcome.snapshot;
    if (found.status === 'DECLINED') {
      return handleDecline(deps, ctx, provider, policy, found, message);
    }
    // Same ordering rule as the success path: the charge is known to exist,
    // so record that before any write that could fail and lose it.
    const adoptedRecorded = await recordAttempt(deps, ctx, provider, {
      outcome: 'ADOPTED',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'CHARGE_FOUND',
      providerChargeId: found.providerChargeId,
      error: message,
    });
    return {
      kind: 'DONE',
      charge: await persistCreated(deps, ctx, provider, found, adoptedRecorded),
    };
  }

  // UNSUPPORTED or PROBE_FAILED: the question is unanswerable, so the walk
  // ends here. An unresolved charge is a support ticket; a double charge is a
  // chargeback.
  const probeResult = outcome.result === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'PROBE_FAILED';
  // Load-bearing, not audit: without this row a retry cannot know to re-probe
  // this provider. Carry whether it landed into the error so the host can
  // tell "unresolved" from "unresolved and unrecorded" — the latter needs a
  // human before ANY retry, because nothing will stop the next one.
  const recorded = await recordAttempt(deps, ctx, provider, {
    outcome: 'STOPPED',
    failureBucket: 'AMBIGUOUS',
    probeResult,
    error: message,
  });
  throw new AmbiguousChargeError(provider, ctx.input.reference, probeResult, recorded, {
    cause: outcome.error ?? error,
  });
}

/** The failure half of a step, split out to keep each function shallow. */
async function stepFailed(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  policy: FailoverPolicy,
  adapter: PaymentProviderAdapter,
  creds: ResolvedCredentials,
  error: unknown,
): Promise<StepResult> {
  const bucket = classifyFailure(error);
  const message = describeFailure(error);

  // Before any of the walk's own decisions, and never in place of them: the
  // breaker changes where the NEXT charge starts, not what happens to this one.
  if (isOutageSignal(error)) await noteHealth(deps, provider, 'OUTAGE');
  else if (bucket === 'BUSINESS_OUTCOME') await noteHealth(deps, provider, 'ANSWERED');

  if (bucket === 'BUSINESS_OUTCOME') {
    // Only a ChargeDeclinedError carries a normalized reason; a bare 402 that
    // escaped adapter normalization genuinely has none, and the default stands.
    const reason = error instanceof ChargeDeclinedError ? error.reason : undefined;
    return handleDecline(deps, ctx, provider, policy, null, message, reason);
  }

  if (bucket === 'DEFINITELY_NOT_CHARGED') {
    await recordAttempt(deps, ctx, provider, {
      outcome: 'FAILED_OVER',
      failureBucket: bucket,
      error: message,
    });
    return { kind: 'ADVANCE', failure: { provider, message } };
  }

  return afterAmbiguous(deps, ctx, provider, policy, adapter, creds, error, message);
}

/** One provider's full turn: charge, classify, probe, decide. */
export async function step(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  policy: FailoverPolicy,
  pinned: boolean,
  chainHead?: ProviderName,
): Promise<StepResult> {
  const resolved = await resolveProvider(deps, ctx.merchant, provider, ctx.input.method);
  if ('skip' in resolved) {
    await recordAttempt(deps, ctx, provider, {
      outcome: 'SKIPPED',
      failureBucket: 'DEFINITELY_NOT_CHARGED',
      error: resolved.skip,
    });
    if (pinned) throw skipError(provider, resolved, ctx.input.method);
    return { kind: 'ADVANCE', failure: { provider, message: resolved.skip } };
  }
  const { adapter, creds } = resolved;

  // Buyer requirements the charge does not meet (FUT-595) — `customer-gate.ts`.
  const unmet = await gateCustomerRequirements(deps, ctx, provider, adapter, pinned);
  if (unmet) return { kind: 'ADVANCE', failure: unmet };

  // The outage breaker. This skip is what stops one dead provider ending every
  // walk that starts at it: nothing is sent, so nothing can have been charged,
  // and the chain advances on proof rather than on inference.
  if (!(await breakerAllows(deps, provider, pinned))) {
    const message = `provider ${provider} skipped: recent failures indicate an outage`;
    await recordAttempt(deps, ctx, provider, {
      outcome: 'SKIPPED',
      failureBucket: 'DEFINITELY_NOT_CHARGED',
      error: message,
    });
    return { kind: 'ADVANCE', failure: { provider, message } };
  }

  // A card instrument belongs to the provider that minted it. Sending this
  // provider someone else's token is not a degraded attempt, it is a
  // guaranteed validation error that would classify as DEFINITELY_NOT_CHARGED
  // and burn the rest of the chain on the same unusable token.
  const forProvider = chargeInputFor(ctx.input, provider, chainHead);
  if (!hasInstrument(forProvider)) {
    await recordAttempt(deps, ctx, provider, {
      outcome: 'SKIPPED',
      failureBucket: 'DEFINITELY_NOT_CHARGED',
      error: forProvider.reason,
    });
    if (pinned) throw new UnsupportedOperationError(provider, forProvider.reason);
    return { kind: 'ADVANCE', failure: { provider, message: forProvider.reason } };
  }

  let snapshot: ChargeSnapshot;
  try {
    snapshot = await adapter.createCharge(forProvider, creds);
  } catch (error) {
    return stepFailed(deps, ctx, provider, policy, adapter, creds, error);
  }

  // The provider answered, so it is up — whatever the answer was.
  await noteHealth(deps, provider, 'ANSWERED');

  // A decline that arrives as a RESULT rather than an exception — the house
  // rule every adapter here follows.
  if (snapshot.status === 'DECLINED') {
    return handleDecline(deps, ctx, provider, policy, snapshot, snapshot.declineReason ?? 'declined');
  }

  // Record BEFORE persisting, not after. The provider has just told us a
  // charge exists; that is the moment it must become durable. Persisting
  // first means a charge-store failure exits with the external charge
  // recorded nowhere, and the retry walks from the top and creates a second
  // one — two payable checkout links for one order, on any provider without
  // native idempotency.
  const recorded = await recordAttempt(deps, ctx, provider, {
    outcome: 'SUCCEEDED',
    providerChargeId: snapshot.providerChargeId,
  });
  return { kind: 'DONE', charge: await persistCreated(deps, ctx, provider, snapshot, recorded) };
}
