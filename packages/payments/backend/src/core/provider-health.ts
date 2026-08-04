import { ProviderRequestError } from './errors';
import { isTransportError } from './failover';
import type { ProviderName } from './types';

/**
 * THE OUTAGE BREAKER — what keeps one provider being down from taking the
 * whole chain down with it.
 *
 * `failover.ts` decides, for ONE charge, whether advancing past a failure is
 * safe. That decision is correct and is not weakened here. But it is a
 * per-charge decision, and a sustained outage is not a per-charge event:
 *
 *   1. `createCharge` times out or answers 5xx  → AMBIGUOUS (a provider that
 *      broke while answering may still have created the charge).
 *   2. The walk probes, via `findChargeByReference` — against the SAME
 *      provider, which is still down. The probe throws → PROBE_FAILED.
 *   3. `AmbiguousChargeError`. The walk stops. The next provider, healthy and
 *      configured, is never reached.
 *
 * Every buyer repeats all three steps, so a store with a working second
 * acquirer takes NO money for the length of the outage — while paying a full
 * timeout per checkout to discover it.
 *
 * The way out is not to re-classify anything (that is how buyers get billed
 * twice) but to stop SENDING. A provider skipped before any request leaves the
 * process cannot have created a charge — `DEFINITELY_NOT_CHARGED` by
 * construction, not by inference — so the walk advances on exactly the same
 * proof it already demands.
 *
 * What this deliberately does NOT touch: the reconciliation paths. A walk that
 * must recover an unfinished charge, or settle one a previous walk stopped on,
 * runs before the chain loop and never consults health. Money that may already
 * exist is chased at a provider whether or not it is healthy.
 */

/** Whether a provider may be sent NEW work right now. */
export interface ProviderHealth {
  /**
   * False when the provider has proven itself down and the cooldown has not
   * yet elapsed. A `true` here is never a promise the call will succeed — only
   * that refusing to try is not currently justified.
   */
  isAvailable(provider: ProviderName): Promise<boolean>;
  /** The provider answered — a decline counts, it means the lights are on. */
  recordSuccess(provider: ProviderName): Promise<void>;
  /** The provider failed in a way that suggests IT is broken, not our request. */
  recordFailure(provider: ProviderName): Promise<void>;
}

/**
 * Is this failure evidence the PROVIDER is down, as opposed to evidence our
 * request was wrong?
 *
 * The distinction is the whole value of the breaker. Counting the wrong things
 * opens a circuit on a provider that is perfectly healthy and merely refusing
 * a malformed request, which would route live traffic away from a working
 * acquirer — a self-inflicted outage.
 *
 * Counted:
 *   - transport failures, either direction (never arrived / answer lost);
 *   - 5xx, which is the provider saying it broke.
 *
 * NOT counted, and each for its own reason:
 *   - 400/422 — our payload. Every merchant would trip it identically.
 *   - 401/403 — ONE merchant's credentials. Nothing to do with the vendor.
 *   - 404     — our route.
 *   - 429     — the provider is up and rate-limiting us. It already fails over
 *               cleanly (`DEFINITELY_NOT_CHARGED`), and treating throttling as
 *               death would trip the breaker exactly when traffic is highest.
 *   - 409     — an idempotency conflict, which is evidence a charge EXISTS.
 *   - declines — the provider worked. See `recordSuccess`.
 */
export function isOutageSignal(error: unknown): boolean {
  if (isTransportError(error)) return true;
  if (error instanceof ProviderRequestError) {
    const status = error.options.httpStatus;
    return typeof status === 'number' && status >= 500;
  }
  return false;
}

export interface BreakerOptions {
  /** Consecutive outage signals before the circuit opens. */
  threshold?: number;
  /** How long an open circuit stays open before one trial is allowed. */
  cooldownMs?: number;
  /** Injectable clock — the package has no ambient time dependency in tests. */
  now?: () => number;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;

interface Circuit {
  failures: number;
  openedAt: number | null;
}

/**
 * In-memory breaker, keyed by PROVIDER rather than by (merchant, provider).
 *
 * Both facts it counts — a transport failure and a 5xx — are properties of the
 * vendor, not of one store's account, so every merchant's traffic is evidence
 * about the same thing. Keying per merchant would divide that evidence by the
 * number of active stores and delay detection by exactly that factor, which on
 * a long tail of low-traffic stores means never detecting it at all. The
 * merchant-specific failures are precisely the ones `isOutageSignal` refuses
 * to count.
 *
 * Per-process, so each instance learns independently. That is a deliberate
 * limit rather than an oversight: the state is disposable (worst case an
 * instance pays a few extra timeouts before it catches up), and a shared store
 * would put a network round trip — and a new dependency that can itself fail —
 * on the checkout hot path in order to cache the fact that the network is
 * unreliable. A host that wants cross-instance detection implements
 * `ProviderHealth` over Redis; that is what the port is for.
 */
export function createMemoryProviderHealth(options: BreakerOptions = {}): ProviderHealth {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  const circuits = new Map<ProviderName, Circuit>();

  const circuitFor = (provider: ProviderName): Circuit => {
    const existing = circuits.get(provider);
    if (existing) return existing;
    const fresh: Circuit = { failures: 0, openedAt: null };
    circuits.set(provider, fresh);
    return fresh;
  };

  return {
    async isAvailable(provider) {
      const circuit = circuits.get(provider);
      if (!circuit?.openedAt) return true;
      // HALF-OPEN: once the cooldown elapses one trial is let through, and the
      // circuit is closed optimistically so the trial is the thing that
      // re-decides. Without this a provider that recovered would stay skipped
      // until something else happened to call it — and nothing would, because
      // being skipped is what stops it being called.
      if (now() - circuit.openedAt < cooldownMs) return false;
      circuit.openedAt = null;
      circuit.failures = 0;
      return true;
    },

    async recordSuccess(provider) {
      const circuit = circuitFor(provider);
      circuit.failures = 0;
      circuit.openedAt = null;
    },

    async recordFailure(provider) {
      const circuit = circuitFor(provider);
      circuit.failures += 1;
      if (circuit.failures >= threshold && !circuit.openedAt) {
        circuit.openedAt = now();
      }
    },
  };
}
