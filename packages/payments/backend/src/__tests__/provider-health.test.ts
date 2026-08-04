import { describe, expect, it } from 'vitest';

import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  ProviderRequestError,
} from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import { createMemoryProviderHealth, isOutageSignal, type ProviderHealth } from '../core/provider-health';
import { defineProviders } from '../core/registry';
import type { ChargeInput, ChargeSnapshot } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  type MemoryAttemptLedger,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { TENANT, STUB_CREDS, pixInput } from './fixtures';

/**
 * THE OUTAGE BREAKER.
 *
 * `failover.test.ts` covers whether ONE charge may advance past ONE failure.
 * These cover the thing that only shows up across MANY charges: a provider
 * that is down stays down, and the per-charge rules — correct in isolation —
 * compose into a store that cannot take money at all.
 *
 * The first test states the defect explicitly, because it is the reason the
 * rest of this file exists and it is not a bug in any single rule.
 */

// ── harness ─────────────────────────────────────────────────────────────────

interface Script {
  charge?: (input: ChargeInput) => Promise<ChargeSnapshot>;
  probe?: (reference: string) => Promise<ChargeSnapshot | null>;
}

interface Spy {
  chargeCalls: string[];
  probeCalls: string[];
}

function snapshotOf(name: string, input: ChargeInput, over: Partial<ChargeSnapshot> = {}): ChargeSnapshot {
  return {
    provider: name,
    providerChargeId: `${name}_${input.reference}`,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
    ...over,
  };
}

function scripted(name: string, script: Script = {}): { adapter: PaymentProviderAdapter; spy: Spy } {
  const spy: Spy = { chargeCalls: [], probeCalls: [] };
  const adapter: PaymentProviderAdapter = {
    name,
    displayName: name,
    capabilities: {
      methods: ['PIX', 'CARD', 'BOLETO'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'NONE',
    },
    credentialSchema: [],
    verifyCredentials: async () => ({ ok: true }),
    createCharge: async (input) => {
      spy.chargeCalls.push(input.reference);
      if (script.charge) return script.charge(input);
      return snapshotOf(name, input);
    },
    getCharge: async (id) => snapshotOf(name, pixInput(), { providerChargeId: id }),
    webhook: { verify: async () => true, parse: async () => [] },
    clientConfig: () => ({ provider: name, tokenization: 'NONE' }),
  };
  if (script.probe) {
    adapter.findChargeByReference = async (reference) => {
      spy.probeCalls.push(reference);
      return script.probe!(reference);
    };
  }
  return { adapter, spy };
}

/** A 503 — the provider broke while answering. Classifies AMBIGUOUS. */
function outage503(): Error {
  return new ProviderRequestError('p', 'Service Unavailable', { httpStatus: 503 });
}

function world(chain: { adapter: PaymentProviderAdapter }[], health?: ProviderHealth) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const attempts = createMemoryAttemptLedger();
  const registry: Record<string, PaymentProviderAdapter> = {};
  for (const { adapter } of chain) registry[adapter.name] = adapter;
  const gateway = createPaymentsGateway({
    providers: defineProviders(registry),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
    ...(health ? { health } : {}),
  });
  for (const { adapter } of chain) credentials.set(TENANT, adapter.name, STUB_CREDS);
  return { gateway, credentials, charges, attempts: attempts as MemoryAttemptLedger };
}

/** A provider that is down: 503s, and whose probe is down with it. */
function downProvider(name: string) {
  return scripted(name, {
    charge: async () => {
      throw outage503();
    },
    probe: async () => {
      throw outage503();
    },
  });
}

// ── the defect ──────────────────────────────────────────────────────────────

describe('a sustained outage at the head of the chain', () => {
  it('strands every charge when nothing tracks provider health', async () => {
    // The composition that costs a store its revenue, with no rule broken:
    // 503 → AMBIGUOUS → probe the SAME dead provider → PROBE_FAILED → stop.
    // The healthy second provider is never reached, on any charge.
    const stone = downProvider('stone');
    const backup = scripted('backup');
    const w = world([stone, backup]);

    for (const reference of ['order-1', 'order-2', 'order-3']) {
      await expect(w.gateway.charge(TENANT, pixInput(reference))).rejects.toBeInstanceOf(
        AmbiguousChargeError,
      );
    }

    expect(stone.spy.chargeCalls).toHaveLength(3);
    // The whole point: a working acquirer sat there and was never asked.
    expect(backup.spy.chargeCalls).toEqual([]);
  });

  it('routes past the dead provider once the breaker has seen enough', async () => {
    const stone = downProvider('stone');
    const backup = scripted('backup');
    const w = world([stone, backup], createMemoryProviderHealth({ threshold: 2 }));

    // The first two charges still pay the full price of discovery — they are
    // what teaches the breaker. Neither is silently lost: both raise.
    for (const reference of ['order-1', 'order-2']) {
      await expect(w.gateway.charge(TENANT, pixInput(reference))).rejects.toBeInstanceOf(
        AmbiguousChargeError,
      );
    }
    expect(stone.spy.chargeCalls).toHaveLength(2);

    // From here the circuit is open: Stone is not sent anything, so the walk
    // advances on proof rather than inference and the store takes money again.
    const charge = await w.gateway.charge(TENANT, pixInput('order-3'));
    expect(charge.provider).toBe('backup');
    expect(stone.spy.chargeCalls).toHaveLength(2);
  });

  it('ledgers the skip as SKIPPED / DEFINITELY_NOT_CHARGED', async () => {
    // The bucket is the safety claim, and it is true by construction here:
    // nothing was sent, so nothing can have been charged.
    const stone = downProvider('stone');
    const w = world([stone, scripted('backup')], createMemoryProviderHealth({ threshold: 1 }));

    await expect(w.gateway.charge(TENANT, pixInput('order-1'))).rejects.toBeInstanceOf(
      AmbiguousChargeError,
    );
    await w.gateway.charge(TENANT, pixInput('order-2'));

    const skipped = w.attempts
      .all()
      .find((row) => row.provider === 'stone' && row.outcome === 'SKIPPED');
    expect(skipped?.failureBucket).toBe('DEFINITELY_NOT_CHARGED');
    expect(skipped?.error).toContain('outage');
  });
});

// ── what counts as an outage ────────────────────────────────────────────────

describe('isOutageSignal', () => {
  it('counts 5xx and transport failures', () => {
    expect(isOutageSignal(outage503())).toBe(true);
    expect(isOutageSignal(new ProviderRequestError('p', 'x', { httpStatus: 500 }))).toBe(true);
    const timeout = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    });
    expect(isOutageSignal(timeout)).toBe(true);
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    });
    expect(isOutageSignal(refused)).toBe(true);
  });

  it('does not count failures that are ours, one merchant’s, or a decision', () => {
    // Each of these would open the circuit on a HEALTHY provider — routing
    // live traffic away from a working acquirer over our own bad request.
    const of = (httpStatus: number) =>
      isOutageSignal(new ProviderRequestError('p', 'x', { httpStatus }));
    expect(of(400)).toBe(false);
    expect(of(401)).toBe(false);
    expect(of(404)).toBe(false);
    // Throttling means the provider is up, and it already fails over cleanly.
    expect(of(429)).toBe(false);
    // A conflict is evidence a charge EXISTS, not that the vendor is down.
    expect(of(409)).toBe(false);
    expect(isOutageSignal(new ChargeDeclinedError('p', 'CARD_DECLINED', 'no funds'))).toBe(false);
    expect(isOutageSignal(new Error('a plain bug in our own code'))).toBe(false);
  });
});

// ── the breaker itself ──────────────────────────────────────────────────────

describe('createMemoryProviderHealth', () => {
  it('opens only at the threshold, and a success resets the count', async () => {
    const health = createMemoryProviderHealth({ threshold: 3 });
    await health.recordFailure('stone');
    await health.recordFailure('stone');
    expect(await health.isAvailable('stone')).toBe(true);

    // A provider that answers in between is not trending toward death.
    await health.recordSuccess('stone');
    await health.recordFailure('stone');
    await health.recordFailure('stone');
    expect(await health.isAvailable('stone')).toBe(true);

    await health.recordFailure('stone');
    expect(await health.isAvailable('stone')).toBe(false);
  });

  it('half-opens after the cooldown so a recovered provider is used again', async () => {
    let clock = 1_000;
    const health = createMemoryProviderHealth({
      threshold: 1,
      cooldownMs: 30_000,
      now: () => clock,
    });
    await health.recordFailure('stone');
    expect(await health.isAvailable('stone')).toBe(false);

    clock += 29_999;
    expect(await health.isAvailable('stone')).toBe(false);

    // Without this the skip is self-perpetuating: being skipped is exactly
    // what stops anything discovering the provider came back.
    clock += 2;
    expect(await health.isAvailable('stone')).toBe(true);
  });

  it('keeps providers independent', async () => {
    const health = createMemoryProviderHealth({ threshold: 1 });
    await health.recordFailure('stone');
    expect(await health.isAvailable('stone')).toBe(false);
    expect(await health.isAvailable('backup')).toBe(true);
  });
});

// ── what the breaker must never do ──────────────────────────────────────────

describe('the breaker never overrides the walk', () => {
  it('does not skip a PINNED provider', async () => {
    // The caller named this provider. Refusing on the strength of other
    // charges' failures would substitute our inference for an instruction.
    const stone = downProvider('stone');
    const w = world([stone, scripted('backup')], createMemoryProviderHealth({ threshold: 1 }));

    await expect(w.gateway.charge(TENANT, pixInput('order-1'))).rejects.toBeInstanceOf(
      AmbiguousChargeError,
    );
    await expect(
      w.gateway.charge(TENANT, pixInput('order-2'), { provider: 'stone' }),
    ).rejects.toBeInstanceOf(AmbiguousChargeError);
    // It really was attempted, rather than short-circuited.
    expect(stone.spy.chargeCalls).toEqual(['order-1', 'order-2']);
  });

  it('treats a decline as proof the provider is alive', async () => {
    // A busy evening of declined cards must not read as an outage and route
    // every subsequent buyer away from a perfectly healthy acquirer.
    const decliner = scripted('stone', {
      charge: async (input) => snapshotOf('stone', input, { status: 'DECLINED' }),
    });
    const w = world([decliner, scripted('backup')], createMemoryProviderHealth({ threshold: 2 }));

    for (const reference of ['order-1', 'order-2', 'order-3']) {
      await w.gateway.charge(TENANT, pixInput(reference));
    }
    expect(decliner.spy.chargeCalls).toHaveLength(3);
  });

  it('never lets a broken health store fail a charge', async () => {
    // Health decides where the NEXT charge goes; it has no authority over
    // this one. A throwing breaker must cost nothing.
    const exploding: ProviderHealth = {
      isAvailable: async () => {
        throw new Error('redis is down');
      },
      recordSuccess: async () => {
        throw new Error('redis is down');
      },
      recordFailure: async () => {
        throw new Error('redis is down');
      },
    };
    const w = world([scripted('stone')], exploding);
    const charge = await w.gateway.charge(TENANT, pixInput('order-1'));
    expect(charge.provider).toBe('stone');
  });
});
