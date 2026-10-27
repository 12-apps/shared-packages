import { createMemoryProviderHealth, type BreakerOptions, type ProviderHealth } from './provider-health';

/**
 * The outage breaker, shared by every process that reads one store (FUT-4083).
 *
 * A parked hosted link is handed back during a provider outage only while the
 * breaker still keeps the head of the chain out (FUT-4072). The memory breaker
 * made that a coin toss for a host running more than one instance: a re-tap
 * that landed on another instance, or came after a restart, found the breaker
 * closed, walked the chain, and superseded the parked link — the buyer got a
 * second link. Over a shared store every instance reads the same open,
 * half-open and closed.
 *
 * The same states as {@link createMemoryProviderHealth}, in two keys per
 * provider:
 *
 *  - `fail:{provider}` — the outage signals counted since the last success,
 *    an atomic counter. The memory breaker counts with no clock; here the
 *    count expires with `failureWindowMs`, so a handful of failures scattered
 *    across a day never adds up to an outage.
 *  - `open:{provider}` — present while the circuit is OPEN, written with the
 *    cooldown as its TTL, so it lapses on its own: its absence after an
 *    opening IS the half-open state. The counter is cleared when the circuit
 *    opens, so the trial starts from zero, as the memory breaker's does. A
 *    success clears both: CLOSED.
 *
 * The store is best-effort, the contract of a Redis text cache: an outage
 * reads as a miss (the circuit answers available — a fresh process's answer,
 * never refusing a provider on evidence nobody can read) and a counter outage
 * as `null` (the failure is not counted). When the host has no store at all
 * (`resolve` answers null), the memory breaker serves, per process.
 */

/** The four calls the breaker makes — the shape of a Redis text cache. */
export interface ProviderHealthStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomically count within a window that expires with it; `null` on outage. */
  incrementWindow(key: string, windowMs: number): Promise<number | null>;
}

export interface SharedBreakerOptions extends Omit<BreakerOptions, 'now'> {
  /** How long a counted outage signal stays counted. */
  failureWindowMs?: number;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_FAILURE_WINDOW_MS = 5 * 60_000;

const failKey = (provider: string): string => `fail:${provider}`;
const openKey = (provider: string): string => `open:${provider}`;

/** A breaker over `store`, shared by every process that reads the same store. */
export function createStoreProviderHealth(
  store: ProviderHealthStore,
  options: SharedBreakerOptions = {},
): ProviderHealth {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const cooldownSeconds = Math.ceil((options.cooldownMs ?? DEFAULT_COOLDOWN_MS) / 1000);
  const failureWindowMs = options.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
  return {
    async isAvailable(provider) {
      return (await store.get(openKey(provider))) === null;
    },
    async recordSuccess(provider) {
      await Promise.all([store.del(failKey(provider)), store.del(openKey(provider))]);
    },
    async recordFailure(provider) {
      const failures = await store.incrementWindow(failKey(provider), failureWindowMs);
      if (failures === null || failures < threshold) return;
      await store.set(openKey(provider), 'open', cooldownSeconds);
      await store.del(failKey(provider));
    },
  };
}

/**
 * The breaker a host hands the gateway: shared over the store `resolve`
 * answers, or the memory breaker when it answers null (no Redis configured).
 * `resolve` runs once, on first use, so building the gateway stays
 * synchronous and a host that never charges never connects.
 */
export function createSharedProviderHealth(
  resolve: () => Promise<ProviderHealthStore | null>,
  options: SharedBreakerOptions = {},
): ProviderHealth {
  let resolved: Promise<ProviderHealth> | null = null;
  const health = (): Promise<ProviderHealth> => {
    resolved ??= resolve().then((store) =>
      store ? createStoreProviderHealth(store, options) : createMemoryProviderHealth(options),
    );
    return resolved;
  };
  return {
    isAvailable: async (provider) => (await health()).isAvailable(provider),
    recordSuccess: async (provider) => (await health()).recordSuccess(provider),
    recordFailure: async (provider) => (await health()).recordFailure(provider),
  };
}
