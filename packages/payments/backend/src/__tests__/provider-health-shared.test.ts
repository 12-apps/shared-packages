import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderRequestError } from "../core/errors";
import { createPaymentsGateway } from "../core/gateway";
import type { PaymentProviderAdapter } from "../core/provider";
import type { ProviderHealth } from "../core/provider-health";
import {
  createSharedProviderHealth,
  createStoreProviderHealth,
  type ProviderHealthStore as HealthStore,
} from "../core/provider-health-shared";
import { defineProviders } from "../core/registry";
import type { ChargeInput } from "../core/types";
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from "../memory";
import { createMemoryWebhookInbox } from "../memory-webhook-inbox";

/**
 * The outage breaker, shared by every instance over one store (FUT-4083).
 *
 * Two clients over ONE store stand for two web instances over one Redis. The
 * store is a double of the Redis text cache with the same semantics the
 * breaker leans on — a TTL'd value, and an atomic counter that expires with
 * its window — on the faked clock, so the cooldown can be walked through.
 */

/** The faked clock's reading — the time the breaker itself reads. */
const clock = (): number => vi.getMockedSystemTime()?.getTime() ?? 0;

/** A Redis text cache double: TTL'd values and windowed counters on the faked clock. */
function fakeRedis(): HealthStore {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt <= clock()) entries.delete(key);
    return entries.get(key) ?? null;
  };
  return {
    get: async (key) => live(key)?.value ?? null,
    set: async (key, value, ttlSeconds) => {
      entries.set(key, { value, expiresAt: clock() + ttlSeconds * 1000 });
    },
    del: async (key) => {
      entries.delete(key);
    },
    incrementWindow: async (key, windowMs) => {
      const hit = live(key);
      const count = Number(hit?.value ?? 0) + 1;
      entries.set(key, { value: String(count), expiresAt: hit?.expiresAt ?? clock() + windowMs });
      return count;
    },
  };
}

async function fail(health: ProviderHealth, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) await health.recordFailure("pagbank");
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-27T12:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("two instances over one Redis share the breaker", () => {
  it("OPEN: failures counted on either instance open the circuit for both", async () => {
    const redis = fakeRedis();
    const a = createStoreProviderHealth(redis);
    const b = createStoreProviderHealth(redis);

    await fail(a, 3);
    await fail(b, 1);
    expect(await b.isAvailable("pagbank")).toBe(true);

    await fail(a, 1);
    expect(await a.isAvailable("pagbank")).toBe(false);
    expect(await b.isAvailable("pagbank")).toBe(false);
    // Keyed by provider: the vendor is down, not every vendor.
    expect(await b.isAvailable("stone")).toBe(true);
  });

  it("HALF-OPEN: after the cooldown both let a trial through, counting from zero", async () => {
    const redis = fakeRedis();
    const a = createStoreProviderHealth(redis);
    const b = createStoreProviderHealth(redis);
    await fail(a, 5);

    vi.advanceTimersByTime(29_000);
    expect(await b.isAvailable("pagbank")).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(await a.isAvailable("pagbank")).toBe(true);
    expect(await b.isAvailable("pagbank")).toBe(true);

    // The failures before the opening are gone: one more does not re-open it.
    await fail(b, 1);
    expect(await a.isAvailable("pagbank")).toBe(true);
    // A trial that keeps failing does, for both.
    await fail(b, 4);
    expect(await a.isAvailable("pagbank")).toBe(false);
  });

  it("CLOSED: a success on one instance closes an open circuit for the other", async () => {
    const redis = fakeRedis();
    const a = createStoreProviderHealth(redis);
    const b = createStoreProviderHealth(redis);
    await fail(a, 5);

    await b.recordSuccess("pagbank");

    expect(await a.isAvailable("pagbank")).toBe(true);
  });

  it("a success resets the count another instance was building", async () => {
    const redis = fakeRedis();
    const a = createStoreProviderHealth(redis);
    const b = createStoreProviderHealth(redis);

    await fail(a, 4);
    await b.recordSuccess("pagbank");
    await fail(a, 1);

    expect(await b.isAvailable("pagbank")).toBe(true);
  });

  it("forgets failures that fall out of the window", async () => {
    const health = createStoreProviderHealth(fakeRedis());
    await fail(health, 4);

    vi.advanceTimersByTime(5 * 60_000);
    await fail(health, 1);

    expect(await health.isAvailable("pagbank")).toBe(true);
  });
});

describe("Redis is best-effort", () => {
  it("answers available when the circuit cannot be read, and counts nothing it cannot write", async () => {
    const outage: HealthStore = {
      get: async () => null,
      set: vi.fn(async () => undefined),
      del: async () => undefined,
      incrementWindow: async () => null,
    };
    const health = createStoreProviderHealth(outage);

    await fail(health, 10);

    expect(await health.isAvailable("pagbank")).toBe(true);
    expect(outage.set).not.toHaveBeenCalled();
  });

  it("falls back to the per-process memory breaker when there is no store", async () => {
    const a = createSharedProviderHealth(async () => null);
    const b = createSharedProviderHealth(async () => null);

    await fail(a, 5);

    expect(await a.isAvailable("pagbank")).toBe(false);
    // Per process: the other instance learns nothing.
    expect(await b.isAvailable("pagbank")).toBe(true);
  });

  it("resolves the store once, on first use", async () => {
    const store = vi.fn(async () => fakeRedis());
    const health = createSharedProviderHealth(store);

    await health.isAvailable("pagbank");
    await fail(health, 2);

    expect(store).toHaveBeenCalledOnce();
  });
});

describe("two gateway instances over one Redis", () => {
  const MERCHANT = { kind: "TENANT" as const, id: "store-1" };
  const CREDS = { environment: "SANDBOX" as const, fields: {} };

  /** A minimal card adapter; `down` answers every create 503 and every probe "no such charge". */
  function adapter(name: string, down: boolean): PaymentProviderAdapter {
    return {
      name,
      displayName: name,
      capabilities: {
        methods: ["PIX"],
        savedCards: false,
        refunds: false,
        partialRefunds: false,
        splits: false,
        webhooks: true,
        tokenization: "PUBLIC_KEY",
      },
      credentialSchema: [],
      verifyCredentials: async () => ({ ok: true }),
      createCharge: vi.fn(async (input: ChargeInput) => {
        if (down) throw new ProviderRequestError(name, `${name} 503`, { httpStatus: 503 });
        return {
          provider: name,
          providerChargeId: `${name}_${input.reference}`,
          reference: input.reference,
          status: "PENDING" as const,
          amount: input.amount,
          method: "PIX" as const,
        };
      }),
      findChargeByReference: async () => null,
      getCharge: async () => {
        throw new Error("not part of this test");
      },
      webhook: { verify: async () => true, parse: async () => [] },
      clientConfig: () => ({ provider: name, tokenization: "PUBLIC_KEY" }),
    } as PaymentProviderAdapter;
  }

  /** One web instance: its own process state, the shared store, the same chain. */
  function instance(redis: HealthStore, providers: ReturnType<typeof defineProviders>) {
    const credentials = createMemoryCredentialStore();
    credentials.set(MERCHANT, "pagbank", CREDS);
    credentials.set(MERCHANT, "stone", CREDS);
    return createPaymentsGateway({
      providers,
      credentials,
      charges: createMemoryChargeStore(),
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
      health: createSharedProviderHealth(async () => redis),
    });
  }

  const pix = (reference: string): ChargeInput => ({
    reference,
    amount: { amountCents: 1000, currency: "BRL" },
    method: "PIX",
    customer: { name: "Ana", email: "ana@example.com" },
  }) as ChargeInput;

  it("skips a provider the OTHER instance found down, before sending it anything", async () => {
    const pagbank = adapter("pagbank", true);
    const stone = adapter("stone", false);
    const providers = defineProviders({ pagbank, stone });
    const redis = fakeRedis();
    const a = instance(redis, providers);
    const b = instance(redis, providers);

    for (const n of [1, 2, 3, 4, 5]) await a.charge(MERCHANT, pix(`order-a${n}`));
    expect(pagbank.createCharge).toHaveBeenCalledTimes(5);

    const charged = await b.charge(MERCHANT, pix("order-b"));

    expect(charged.snapshot.provider).toBe("stone");
    // Instance B never sent the head of the chain anything.
    expect(pagbank.createCharge).toHaveBeenCalledTimes(5);
  });
});
