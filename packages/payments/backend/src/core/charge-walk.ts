import {
  type AttemptContext,
  type ChargeWalkDeps,
  type FailoverPolicy,
  persistCreated,
  probe,
  recordAttempt,
  resolveProvider,
  step,
} from './charge-attempt';
import { AmbiguousChargeError, CredentialsError, NoProviderSucceededError } from './errors';
import type { StoredCharge } from './ports';
import type { ChargeInput, MerchantRef, ProviderName } from './types';

/**
 * THE FAILOVER WALK.
 *
 * Given a merchant's ordered provider chain, try each in turn until one
 * produces a charge — but only ever advance past a provider whose failure we
 * can PROVE created nothing. `failover.ts` classifies failures,
 * `charge-attempt.ts` runs a single provider's turn, and this module is the
 * loop plus the resume logic that makes a retry continue where the last walk
 * stopped instead of starting over at the top.
 */

export type { ChargeWalkDeps, FailoverPolicy };

interface ChargeWalkOptions {
  /** Pin one provider: the chain is that provider alone, with no failover. */
  provider?: ProviderName;
  failoverPolicy?: FailoverPolicy;
}

/** What earlier attempts under this idempotency key already established. */
interface History {
  tried: Set<ProviderName>;
  lastAttemptNo: number;
  stopped: ProviderName | null;
  /**
   * A charge a previous walk KNOWS was created but never got into the charge
   * store — the provider said yes and the local write failed after it. The
   * ledger is the only trace, and without recovering from it the retry would
   * create a second charge for the same order.
   */
  unfinished: { provider: ProviderName; providerChargeId: string } | null;
}

const NO_HISTORY: History = {
  tried: new Set(),
  lastAttemptNo: 0,
  stopped: null,
  unfinished: null,
};

/**
 * Prior attempts for this idempotency key, so a retry RESUMES rather than
 * restarting. Restarting would re-hit a provider that already refused — and,
 * after an ambiguous failure, re-hit the one provider that might already hold
 * the buyer's money.
 */
async function loadHistory(
  deps: ChargeWalkDeps,
  merchant: MerchantRef,
  key: string | undefined,
): Promise<History> {
  if (!key) return NO_HISTORY;
  // A ledger read failure deliberately PROPAGATES rather than degrading to
  // "no history".
  //
  // Resuming is not an optimization — for a walk that previously STOPPED on
  // an ambiguous outcome, this read is the only record that some provider may
  // be holding the buyer's money. Swallowing the error erases that fact and
  // restarts the walk at the top, which is precisely the double charge the
  // whole design exists to prevent. If we cannot read what was already tried,
  // we cannot prove anything is safe, so the charge fails and can be retried.
  const rows = await deps.attempts.listByIdempotencyKey(merchant, key);
  const tried = new Set<ProviderName>();
  let lastAttemptNo = 0;
  let stopped: ProviderName | null = null;
  let unfinished: History['unfinished'] = null;
  for (const row of rows) {
    tried.add(row.provider);
    lastAttemptNo = Math.max(lastAttemptNo, row.attemptNo);
    if (row.outcome === 'STOPPED') stopped = row.provider;
    // Reaching this function at all means the charge store had no row for
    // this key, so a recorded SUCCEEDED/ADOPTED means the local write failed
    // after the provider had already created the charge.
    if ((row.outcome === 'SUCCEEDED' || row.outcome === 'ADOPTED') && row.providerChargeId) {
      unfinished = { provider: row.provider, providerChargeId: row.providerChargeId };
    }
  }
  return { tried, lastAttemptNo, stopped, unfinished };
}

/**
 * Re-probe a provider whose previous walk stopped on an ambiguous failure.
 * Time may have resolved what it could not: the provider may now answer, and
 * either hand us the charge it created or confirm it created none. Only if it
 * STILL cannot answer does the walk refuse to move.
 */
async function settleStopped(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
): Promise<StoredCharge | null> {
  const resolved = await resolveProvider(deps, ctx.merchant, provider, ctx.input.method);
  // The provider is gone from the chain or unusable; we still cannot prove
  // what it did, so the charge stays unresolved rather than being retried.
  if ('skip' in resolved) {
    throw new AmbiguousChargeError(provider, ctx.input.reference, 'PROBE_FAILED');
  }
  const outcome = await probe(resolved.adapter, ctx.input.reference, resolved.creds);

  if (outcome.result === 'NOT_CHARGED') {
    await recordAttempt(deps, ctx, provider, {
      outcome: 'FAILED_OVER',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'NOT_CHARGED',
      error: 're-probe on retry proved no charge exists',
    });
    return null;
  }

  if (outcome.result === 'CHARGE_FOUND' && outcome.snapshot) {
    // Record before persisting, and persist through `persistCreated` — the
    // same two rules the initial-success path follows, for the same reason:
    // the charge is KNOWN to exist, so a store failure here must not throw
    // away its id.
    const recorded = await recordAttempt(deps, ctx, provider, {
      outcome: 'ADOPTED',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'CHARGE_FOUND',
      providerChargeId: outcome.snapshot.providerChargeId,
      error: 're-probe on retry found the charge',
    });
    return persistCreated(deps, ctx, provider, outcome.snapshot, recorded);
  }

  const probeResult = outcome.result === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'PROBE_FAILED';
  // `recorded: true` — we got here BECAUSE a durable STOPPED row exists; the
  // re-probe simply could not settle it either. The evidence a later retry
  // needs is still on disk.
  throw new AmbiguousChargeError(provider, ctx.input.reference, probeResult, true, {
    cause: outcome.error,
  });
}

/**
 * Re-fetch and store a charge a previous walk created but failed to persist.
 *
 * Unlike `settleStopped` there is no question of WHETHER a charge exists —
 * the ledger says it does, and its provider id is known — so this is a direct
 * `getCharge` rather than a probe by reference. If either the fetch or the
 * store fails again the error propagates: the caller learns the system is
 * still broken, and the one outcome that must never happen — creating a
 * second charge for the same order — does not.
 */
async function recoverUnfinished(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  unfinished: NonNullable<History['unfinished']>,
): Promise<StoredCharge> {
  const resolved = await resolveProvider(deps, ctx.merchant, unfinished.provider, ctx.input.method);
  if ('skip' in resolved) {
    // The provider is unusable, so its charge cannot be fetched — but it
    // still exists. Refuse to charge anywhere else.
    throw new AmbiguousChargeError(
      unfinished.provider,
      ctx.input.reference,
      'PROBE_FAILED',
      true,
    );
  }
  const snapshot = await resolved.adapter.getCharge(unfinished.providerChargeId, resolved.creds);
  // `recorded: true` — reaching here means a durable ledger row already names
  // this charge, so if the store fails again the evidence still survives.
  return persistCreated(deps, ctx, unfinished.provider, snapshot, true);
}

/**
 * An explicit per-call policy wins; otherwise ask the MERCHANT's own setting,
 * and only fall back to the gateway-wide default. Without the middle step the
 * option is a build-time constant no store owner can reach.
 */
async function resolvePolicy(
  deps: ChargeWalkDeps,
  merchant: MerchantRef,
  options: ChargeWalkOptions,
): Promise<FailoverPolicy> {
  if (options.failoverPolicy) return options.failoverPolicy;
  if (deps.failoverPolicyFor) return deps.failoverPolicyFor(merchant);
  return deps.failoverPolicy;
}

/** The providers this call will consider, in order. */
async function resolveChain(
  deps: ChargeWalkDeps,
  merchant: MerchantRef,
  options: ChargeWalkOptions,
): Promise<ProviderName[]> {
  if (options.provider) return [options.provider];
  const chain = await deps.credentials.providerChain(merchant);
  if (chain.length === 0) {
    throw new CredentialsError(
      'none',
      `No payment provider configured for ${merchant.kind}:${merchant.id}`,
    );
  }
  return chain;
}

/** Attempt number carried across the resume step and the chain loop. */
interface Cursor {
  attemptNo: number;
}

interface RunContext {
  chain: ProviderName[];
  /**
   * Head of the merchant's chain — who a bare card instrument belongs to when
   * the caller did not say. `clientConfig()` describes this provider to the
   * browser, so this is who the browser tokenized for.
   */
  chainHead: ProviderName | undefined;
  history: History;
  cursor: Cursor;
  ctxFor: () => AttemptContext;
  policy: FailoverPolicy;
  pinned: boolean;
}

/** Try each remaining provider in order until one produces a charge. */
async function runChain(deps: ChargeWalkDeps, run: RunContext): Promise<StoredCharge> {
  const failures: { provider: ProviderName; message: string }[] = [];
  for (const provider of run.chain) {
    if (run.history.tried.has(provider)) continue;
    run.cursor.attemptNo += 1;
    const result = await step(deps, run.ctxFor(), provider, run.policy, run.pinned, run.chainHead);
    if (result.kind === 'DONE') return result.charge;
    failures.push(result.failure);
    // A pinned call has nowhere to advance to; report its one failure.
    if (run.pinned) break;
  }
  throw new NoProviderSucceededError(failures);
}

/**
 * Walk the merchant's chain until a provider produces a charge.
 *
 * `options.provider` pins a single provider and disables failover entirely —
 * a caller that named a provider gets that provider or an error, never a
 * silent substitution onto someone else's account.
 *
 * Pinning does NOT switch off reconciliation. An unresolved charge from a
 * previous attempt is settled first either way; the safety rule is about
 * whether money may already be in flight, which no caller instruction can
 * change.
 */
export async function walkChargeChain(
  deps: ChargeWalkDeps,
  merchant: MerchantRef,
  input: ChargeInput,
  options: ChargeWalkOptions = {},
): Promise<StoredCharge> {
  const existing = input.idempotencyKey
    ? await deps.charges.findByIdempotencyKey(merchant, input.idempotencyKey)
    : null;
  if (existing) return existing;

  const pinned = Boolean(options.provider);
  const chain = await resolveChain(deps, merchant, options);
  // A pinned call names its own provider, so a bare instrument belongs to it.
  const chainHead = pinned ? options.provider : chain[0];
  const policy = await resolvePolicy(deps, merchant, options);

  // History is loaded whether or not the call is pinned. Pinning narrows
  // WHICH providers may be charged; it does not make an unresolved charge
  // disappear. Skipping the reconciliation below for a pinned retry would
  // call createCharge again while a previous attempt might already have
  // taken the buyer's money — and native provider idempotency saves only the
  // providers that happen to implement it.
  const history = await loadHistory(deps, merchant, input.idempotencyKey);
  // The one thing pinning DOES override: a caller naming a provider may
  // re-attempt one already tried, since a proven-safe failure is no reason to
  // refuse an explicit instruction.
  const tried = pinned ? new Set<ProviderName>() : history.tried;

  const cursor: Cursor = { attemptNo: history.lastAttemptNo };
  const ctxFor = (): AttemptContext => ({ merchant, input, attemptNo: cursor.attemptNo });

  // A charge we KNOW exists outranks everything else: recover it before any
  // probing or charging, or this walk creates its duplicate.
  if (history.unfinished) {
    return recoverUnfinished(deps, ctxFor(), history.unfinished);
  }

  if (history.stopped) {
    cursor.attemptNo += 1;
    // Note this can return a charge on a DIFFERENT provider than the pinned
    // one. That is correct and not a substitution: adopting a charge that
    // already exists always beats creating a second one.
    const adopted = await settleStopped(deps, ctxFor(), history.stopped);
    if (adopted) return adopted;
  }

  return runChain(deps, {
    chain,
    chainHead,
    history: { ...history, tried },
    cursor,
    ctxFor,
    policy,
    pinned,
  });
}
