import { describe, expect, it } from 'vitest';

import {
  AmbiguousChargeError,
  ChargeDeclinedError,
  ChargeNotPersistedError,
  NoProviderSucceededError,
  ProviderRequestError,
} from '../core/errors';
import { classifyFailure } from '../core/failover';
import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import type { ChargeInput, ChargeSnapshot, PaymentMethodKind } from '../core/types';
import type { AttemptLedger } from '../core/ports';
import {
  createMemoryAttemptLedger,
  type MemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { TENANT, STUB_CREDS, pixInput } from './fixtures';

/**
 * The failover walk (FUT-303).
 *
 * These tests are written around one question: can the gateway PROVE the
 * previous provider created nothing before it charges somewhere else? Every
 * case below is a variation on that, because the ordering half of multi-
 * provider payments is easy and the not-double-charging half is not.
 */

// ── scriptable provider ─────────────────────────────────────────────────────

interface Script {
  /** What `createCharge` does. Defaults to succeeding. */
  charge?: (input: ChargeInput) => Promise<ChargeSnapshot>;
  /** What the reconciliation probe answers. Omit to make it UNSUPPORTED. */
  probe?: (reference: string) => Promise<ChargeSnapshot | null>;
  methods?: PaymentMethodKind[];
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
      methods: script.methods ?? ['PIX', 'CARD', 'BOLETO'],
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

/**
 * A failure that PROVABLY predates transmission — the connection was refused,
 * so nothing can exist on the other side.
 */
function preSendFailure(): Error {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });
}

/**
 * A failure that looks identical to the one above at the class level but is
 * NOT safe: the request was on the wire and only the response was lost.
 */
function timeoutFailure(): Error {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
  });
}

function world(
  chain: { adapter: PaymentProviderAdapter }[],
  policy?: 'TECHNICAL_AND_DECLINE',
  ledger?: AttemptLedger,
) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const attempts = ledger ?? createMemoryAttemptLedger();
  const registry: Record<string, PaymentProviderAdapter> = {};
  for (const { adapter } of chain) registry[adapter.name] = adapter;
  const gateway = createPaymentsGateway({
    providers: defineProviders(registry),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
    ...(policy ? { failoverPolicy: policy } : {}),
  });
  for (const { adapter } of chain) credentials.set(TENANT, adapter.name, STUB_CREDS);
  return { gateway, credentials, charges, attempts: attempts as MemoryAttemptLedger };
}

// ── failure classification ──────────────────────────────────────────────────

describe('classifyFailure', () => {
  it('separates a refused connection from a headers timeout', () => {
    // Both are `TypeError: fetch failed`. Treating them alike is precisely
    // the bug that double-charges a buyer.
    expect(classifyFailure(preSendFailure())).toBe('DEFINITELY_NOT_CHARGED');
    expect(classifyFailure(timeoutFailure())).toBe('AMBIGUOUS');
  });

  it('treats credential and validation rejections as safe, 5xx as ambiguous', () => {
    const of = (httpStatus: number) =>
      classifyFailure(new ProviderRequestError('p', 'x', { httpStatus }));
    expect(of(401)).toBe('DEFINITELY_NOT_CHARGED');
    expect(of(400)).toBe('DEFINITELY_NOT_CHARGED');
    expect(of(500)).toBe('AMBIGUOUS');
    expect(of(503)).toBe('AMBIGUOUS');
    // A duplicate/idempotency conflict is EVIDENCE a charge may exist.
    expect(of(409)).toBe('AMBIGUOUS');
  });

  it('defaults an unrecognized failure to AMBIGUOUS rather than safe', () => {
    expect(classifyFailure(new Error('who knows'))).toBe('AMBIGUOUS');
    // A bare TypeError with no cause code is NOT assumed pre-send.
    expect(classifyFailure(new TypeError('fetch failed'))).toBe('AMBIGUOUS');
  });
});

// ── the acceptance criteria ─────────────────────────────────────────────────

describe('charge failover', () => {
  it('fails over on a pre-send network error and ledgers both attempts', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    expect(charge.provider).toBe('beta');
    expect(second.spy.chargeCalls).toHaveLength(1);
    // Nothing to probe: the failure was proven safe on its own.
    expect(first.spy.probeCalls).toHaveLength(0);

    const ledger = w.attempts.all();
    expect(ledger.map((a) => [a.provider, a.outcome])).toEqual([
      ['alpha', 'FAILED_OVER'],
      ['beta', 'SUCCEEDED'],
    ]);
    expect(ledger[0]?.failureBucket).toBe('DEFINITELY_NOT_CHARGED');
    expect(ledger.map((a) => a.attemptNo)).toEqual([1, 2]);
  });

  it('adopts the charge a probe finds and never calls the second provider', async () => {
    const orphan = snapshotOf('alpha', pixInput(), {
      providerChargeId: 'alpha_orphan',
      status: 'PENDING',
    });
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => orphan,
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    // The buyer is charged ONCE, on the provider that actually holds it.
    expect(charge.provider).toBe('alpha');
    expect(charge.providerChargeId).toBe('alpha_orphan');
    expect(first.spy.probeCalls).toEqual(['order-1']);
    expect(second.spy.chargeCalls).toHaveLength(0);

    const ledger = w.attempts.all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      provider: 'alpha',
      outcome: 'ADOPTED',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'CHARGE_FOUND',
    });
  });

  it('fails over when the probe PROVES no charge exists', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => null,
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    expect(charge.provider).toBe('beta');
    expect(first.spy.probeCalls).toEqual(['order-1']);
    expect(w.attempts.all()[0]).toMatchObject({
      outcome: 'FAILED_OVER',
      probeResult: 'NOT_CHARGED',
    });
  });

  it('STOPS when the probe itself fails — no second provider, no second charge', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        throw new ProviderRequestError('alpha', 'probe unavailable', { httpStatus: 503 });
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toThrow(AmbiguousChargeError);

    expect(second.spy.chargeCalls).toHaveLength(0);
    expect(w.charges.all()).toHaveLength(0);
    expect(w.attempts.all()[0]).toMatchObject({
      outcome: 'STOPPED',
      failureBucket: 'AMBIGUOUS',
      probeResult: 'PROBE_FAILED',
    });
  });

  it('STOPS when the adapter implements no probe at all', async () => {
    // No `probe` in the script → no `findChargeByReference` on the adapter.
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toMatchObject({
      name: 'AmbiguousChargeError',
      probeResult: 'UNSUPPORTED',
    });
    expect(second.spy.chargeCalls).toHaveLength(0);
  });

  it('does NOT cascade a decline under the default policy', async () => {
    const first = scripted('alpha', {
      charge: async (input) =>
        snapshotOf('alpha', input, { status: 'DECLINED', declineReason: 'INSUFFICIENT_FUNDS' }),
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    // The decline is the ANSWER, returned as a stored charge rather than
    // thrown — and the second acquirer never sees the card.
    expect(charge.snapshot.status).toBe('DECLINED');
    expect(second.spy.chargeCalls).toHaveLength(0);
    expect(w.attempts.all()[0]).toMatchObject({
      outcome: 'DECLINED',
      failureBucket: 'BUSINESS_OUTCOME',
    });
  });

  it('keeps the reason when the adapter THREW the decline (FUT-340)', async () => {
    // The one path where the snapshot is absent and the error is everything a
    // caller has. It used to arrive as a literal CARD_DECLINED no matter what
    // the adapter said, which makes "never retry a no-funds charge on a timer"
    // undecidable for anyone downstream of the walk.
    const first = scripted('alpha', {
      charge: async () => {
        throw new ChargeDeclinedError('alpha', 'INSUFFICIENT_FUNDS', 'sem saldo');
      },
    });
    const w = world([first]);

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toMatchObject({
      name: 'ChargeDeclinedError',
      reason: 'INSUFFICIENT_FUNDS',
    });
  });

  it('still defaults the reason when a decline carried none', async () => {
    // A bare 402 that escaped adapter normalization has no reason to preserve,
    // and inventing a specific one would be worse than the honest generic.
    const first = scripted('alpha', {
      charge: async () => {
        throw new ProviderRequestError('alpha', 'payment required', { httpStatus: 402 });
      },
    });
    const w = world([first]);

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toMatchObject({
      name: 'ChargeDeclinedError',
      reason: 'CARD_DECLINED',
    });
  });

  it('cascades a decline only when the merchant opted in', async () => {
    const first = scripted('alpha', {
      charge: async (input) => snapshotOf('alpha', input, { status: 'DECLINED' }),
    });
    const second = scripted('beta');
    const w = world([first, second], 'TECHNICAL_AND_DECLINE');

    const charge = await w.gateway.charge(TENANT, pixInput());

    expect(charge.provider).toBe('beta');
    expect(charge.snapshot.status).toBe('PENDING');
    // The declined attempt was NOT persisted — doing so would have consumed
    // the idempotency key that the successful provider needs.
    expect(w.charges.all()).toHaveLength(1);
  });

  it('falls through a provider that cannot do the method instead of failing', async () => {
    const first = scripted('alpha', { methods: ['PIX'] });
    const second = scripted('beta', { methods: ['PIX', 'BOLETO'] });
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, { ...pixInput(), method: 'BOLETO' });

    expect(charge.provider).toBe('beta');
    expect(first.spy.chargeCalls).toHaveLength(0);
    expect(w.attempts.all()[0]).toMatchObject({ provider: 'alpha', outcome: 'SKIPPED' });
  });

  it('pins to options.provider and never fails over', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    await expect(
      w.gateway.charge(TENANT, pixInput(), { provider: 'alpha' }),
    ).rejects.toThrow(NoProviderSucceededError);

    // A caller that named a provider never gets a silent substitution.
    expect(second.spy.chargeCalls).toHaveLength(0);
  });

  it('reports the precise reason when a PINNED provider cannot do the method', async () => {
    const only = scripted('alpha', { methods: ['PIX'] });
    const w = world([only]);
    await expect(
      w.gateway.charge(TENANT, { ...pixInput(), method: 'BOLETO' }, { provider: 'alpha' }),
    ).rejects.toThrow(/does not support method BOLETO/);
  });

  it('throws when every provider in the chain fails', async () => {
    const fail = () => async () => {
      throw preSendFailure();
    };
    const w = world([
      scripted('alpha', { charge: fail() }),
      scripted('beta', { charge: fail() }),
    ]);
    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toThrow(NoProviderSucceededError);
    expect(w.attempts.all().map((a) => a.outcome)).toEqual(['FAILED_OVER', 'FAILED_OVER']);
  });
});

describe('card instruments are provider-bound', () => {
  const cardFor = (over: Partial<NonNullable<ChargeInput['card']>> = {}): ChargeInput => ({
    ...pixInput(),
    method: 'CARD',
    card: { token: 'tok_minted_for_alpha', ...over },
  });

  it('does NOT hand the second provider a token minted for the first', async () => {
    // The whole point: a blob encrypted with alpha's key is noise to beta.
    // Sending it would be a guaranteed validation error that reads as a
    // decline, so beta is skipped instead.
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    await expect(w.gateway.charge(TENANT, cardFor())).rejects.toThrow(NoProviderSucceededError);

    expect(second.spy.chargeCalls).toHaveLength(0);
    const skipped = w.attempts.all().find((a) => a.provider === 'beta');
    expect(skipped?.outcome).toBe('SKIPPED');
    expect(skipped?.error).toMatch(/no card instrument minted for beta/);
  });

  it('DOES fail over when the checkout minted an instrument per provider', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(
      TENANT,
      cardFor({ tokensByProvider: { alpha: 'tok_alpha', beta: 'tok_beta' } }),
    );

    expect(charge.provider).toBe('beta');
    expect(second.spy.chargeCalls).toHaveLength(1);
  });

  it('sends each provider ITS OWN instrument, never the other one', async () => {
    const seen: Record<string, string | undefined> = {};
    const capture = (name: string) =>
      scripted(name, {
        charge: async (input) => {
          seen[name] = input.card?.token;
          if (name === 'alpha') throw preSendFailure();
          return snapshotOf(name, input);
        },
      });
    const first = capture('alpha');
    const second = capture('beta');
    const w = world([first, second]);

    await w.gateway.charge(
      TENANT,
      cardFor({ tokensByProvider: { alpha: 'tok_alpha', beta: 'tok_beta' } }),
    );

    expect(seen['alpha']).toBe('tok_alpha');
    expect(seen['beta']).toBe('tok_beta');
  });

  it('honours an explicit tokenProvider over the chain head', async () => {
    const first = scripted('alpha');
    const second = scripted('beta');
    const w = world([first, second]);

    // The instrument says it belongs to beta, so alpha must be skipped even
    // though alpha heads the chain.
    const charge = await w.gateway.charge(TENANT, cardFor({ tokenProvider: 'beta' }));

    expect(charge.provider).toBe('beta');
    expect(first.spy.chargeCalls).toHaveLength(0);
  });

  it('never assumes a SAVED card belongs to the chain head', async () => {
    // A vault token names a card in whichever provider held it when the buyer
    // saved it — possibly long before this chain existed. Attributing it to
    // the head would hand the head a foreign token AND skip the provider that
    // can actually charge it, breaking a saved-card payment that used to work.
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, {
      ...pixInput(),
      method: 'CARD',
      card: { savedCardToken: 'vault_tok_from_beta' },
    });

    // beta — the real owner — still gets its turn.
    expect(charge.provider).toBe('beta');
    expect(second.spy.chargeCalls).toHaveLength(1);
  });

  it('still routes a saved card precisely when its owner IS recorded', async () => {
    const first = scripted('alpha');
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, {
      ...pixInput(),
      method: 'CARD',
      card: { savedCardToken: 'vault_tok', tokenProvider: 'beta' },
    });

    expect(charge.provider).toBe('beta');
    expect(first.spy.chargeCalls).toHaveLength(0);
  });

  it('leaves PIX alone — it carries no instrument, which is why it fails over', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    expect(charge.provider).toBe('beta');
    expect(second.spy.chargeCalls).toHaveLength(1);
  });
});

describe('per-merchant failover policy', () => {
  it('asks the merchant\'s own setting rather than a build-time constant', async () => {
    const first = scripted('alpha', {
      charge: async (input) => snapshotOf('alpha', input, { status: 'DECLINED' }),
    });
    const second = scripted('beta');
    const creds = createMemoryCredentialStore();
    const merchantGateway = createPaymentsGateway({
      providers: defineProviders({ alpha: first.adapter, beta: second.adapter }),
      credentials: creds,
      charges: createMemoryChargeStore(),
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
      // The gateway-wide default says do not cascade...
      failoverPolicy: 'TECHNICAL',
      // ...but THIS merchant opted in, and the merchant wins.
      failoverPolicyFor: async () => 'TECHNICAL_AND_DECLINE',
    });
    creds.set(TENANT, 'alpha', STUB_CREDS);
    creds.set(TENANT, 'beta', STUB_CREDS);

    const charge = await merchantGateway.charge(TENANT, pixInput());

    expect(charge.provider).toBe('beta');
  });
});

describe('failover and idempotency', () => {
  it('returns the SAME charge for a repeated idempotency key after a failover', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-1' };

    const one = await w.gateway.charge(TENANT, input);
    const two = await w.gateway.charge(TENANT, input);

    expect(two.id).toBe(one.id);
    // The second call short-circuits on the stored charge; `beta` is not
    // called again.
    expect(second.spy.chargeCalls).toHaveLength(1);
    expect(w.charges.all()).toHaveLength(1);
  });

  it('coalesces concurrent calls onto ONE walk, not one walk each', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-2' };

    const [a, b] = await Promise.all([
      w.gateway.charge(TENANT, input),
      w.gateway.charge(TENANT, input),
    ]);

    expect(a.id).toBe(b.id);
    // One walk: alpha attempted once, beta charged once. The spies ARE the
    // call counters — a separate mutable tally would just be a second source
    // of truth to keep in step.
    expect(first.spy.chargeCalls).toHaveLength(1);
    expect(second.spy.chargeCalls).toHaveLength(1);
  });

  it('a retry RESUMES the chain instead of re-attempting a provider that already failed', async () => {
    // alpha fails safely, beta stops the walk ambiguously.
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta', {
      charge: async () => {
        throw timeoutFailure();
      },
      // Beta's probe proves it created nothing, so the walk continues.
      probe: async () => null,
    });
    const third = scripted('gamma');
    const w = world([first, second, third]);
    const input = { ...pixInput(), idempotencyKey: 'key-3' };

    // First walk: alpha fails over, beta's probe says "no charge", gamma wins.
    await w.gateway.charge(TENANT, input);
    expect(third.spy.chargeCalls).toHaveLength(1);

    const providersTried = w.attempts.all().map((a) => a.provider);
    expect(providersTried).toEqual(['alpha', 'beta', 'gamma']);
    // alpha was attempted exactly once across the whole walk.
    expect(first.spy.chargeCalls).toHaveLength(1);
  });

  it('re-probes on retry after a walk that STOPPED, and adopts what it finds', async () => {
    let probeWorks = false;
    const found = snapshotOf('alpha', pixInput(), { providerChargeId: 'alpha_late' });
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        if (!probeWorks) throw new ProviderRequestError('alpha', 'down', { httpStatus: 503 });
        return found;
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-4' };

    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(AmbiguousChargeError);

    // The provider recovers; the retry asks again rather than either giving
    // up forever or blindly charging someone else.
    probeWorks = true;
    const charge = await w.gateway.charge(TENANT, input);

    expect(charge.provider).toBe('alpha');
    expect(charge.providerChargeId).toBe('alpha_late');
    expect(second.spy.chargeCalls).toHaveLength(0);
  });

  it('FAILS CLOSED when the ledger cannot be read, rather than restarting the walk', async () => {
    // The regression this guards: a walk that STOPPED ambiguously is only
    // remembered in the ledger. If a read failure were swallowed and treated
    // as "no history", the retry would restart at the top of the chain and
    // could charge a second provider while the first may still hold the
    // buyer's money — the exact double charge this design exists to prevent.
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        throw new ProviderRequestError('alpha', 'down', { httpStatus: 503 });
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-6' };

    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(AmbiguousChargeError);

    // The ledger goes dark before the retry.
    w.attempts.listByIdempotencyKey = async () => {
      throw new Error('ledger unavailable');
    };

    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(/ledger unavailable/);
    // Nothing was charged anywhere: no silent restart onto beta.
    expect(second.spy.chargeCalls).toHaveLength(0);
    expect(w.charges.all()).toHaveLength(0);
  });

  it('a PINNED retry still reconciles a prior STOPPED attempt before charging', async () => {
    // Pinning narrows which provider may be charged; it does not make an
    // unresolved charge disappear. Skipping reconciliation here would call
    // createCharge a second time while the first may already have taken the
    // buyer's money — and only some providers have native idempotency to
    // catch it.
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        throw new ProviderRequestError('alpha', 'down', { httpStatus: 503 });
      },
    });
    const w = world([first]);
    const input = { ...pixInput(), idempotencyKey: 'key-7' };

    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(AmbiguousChargeError);
    expect(first.spy.chargeCalls).toHaveLength(1);

    // Retry PINNED to the same provider, whose probe is still broken.
    await expect(
      w.gateway.charge(TENANT, input, { provider: 'alpha' }),
    ).rejects.toThrow(AmbiguousChargeError);

    // The decisive assertion: createCharge was NOT called a second time.
    expect(first.spy.chargeCalls).toHaveLength(1);
    expect(w.charges.all()).toHaveLength(0);
  });

  it('a PINNED retry adopts the charge the probe finds, even on another provider', async () => {
    const orphan = snapshotOf('alpha', pixInput(), { providerChargeId: 'alpha_orphan' });
    let probeWorks = false;
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        if (!probeWorks) throw new ProviderRequestError('alpha', 'down', { httpStatus: 503 });
        return orphan;
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-8' };

    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(AmbiguousChargeError);
    probeWorks = true;

    // Pinned to BETA, but alpha's unresolved charge is settled first — and
    // adopting a charge that already exists beats creating a second one.
    const charge = await w.gateway.charge(TENANT, input, { provider: 'beta' });

    expect(charge.provider).toBe('alpha');
    expect(charge.providerChargeId).toBe('alpha_orphan');
    expect(second.spy.chargeCalls).toHaveLength(0);
  });

  it('a PINNED call may re-attempt a provider whose earlier failure was proven safe', async () => {
    // The one thing pinning does override: `tried` is not a reason to refuse
    // an explicit instruction when nothing was ever charged.
    const first = scripted('alpha', {
      charge: async () => {
        throw preSendFailure();
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-9' };

    await w.gateway.charge(TENANT, input);
    expect(second.spy.chargeCalls).toHaveLength(1);

    // A different reference/key, pinned to alpha, must still reach alpha.
    const pinnedInput = { ...pixInput('order-2'), idempotencyKey: 'key-9b' };
    await expect(
      w.gateway.charge(TENANT, pinnedInput, { provider: 'alpha' }),
    ).rejects.toThrow(NoProviderSucceededError);
    expect(first.spy.chargeCalls).toHaveLength(2);
  });

  it('reports an unresolved charge whose STOPPED row could NOT be written', async () => {
    // The ledger write is load-bearing here, not audit: it is the only
    // durable evidence that alpha may hold a charge. If it is lost, a retry
    // has nothing to re-probe — so the caller has to be told the difference
    // between "unresolved" and "unresolved and unrecorded".
    const failingLedger: AttemptLedger = {
      record: async (attempt) => {
        if (attempt.outcome === 'STOPPED') throw new Error('ledger insert failed');
      },
      listByIdempotencyKey: async () => [],
    };
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        throw new ProviderRequestError('alpha', 'down', { httpStatus: 503 });
      },
    });
    const w = world([first, scripted('beta')], undefined, failingLedger);

    const error = await w.gateway
      .charge(TENANT, { ...pixInput(), idempotencyKey: 'key-10' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AmbiguousChargeError);
    expect((error as AmbiguousChargeError).recorded).toBe(false);
    expect((error as AmbiguousChargeError).message).toMatch(/do not retry/i);
  });

  it('marks the STOPPED outcome as recorded when the ledger write lands', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        throw new ProviderRequestError('alpha', 'down', { httpStatus: 503 });
      },
    });
    const w = world([first, scripted('beta')]);

    const error = await w.gateway
      .charge(TENANT, { ...pixInput(), idempotencyKey: 'key-11' })
      .catch((e: unknown) => e);

    expect((error as AmbiguousChargeError).recorded).toBe(true);
    expect((error as AmbiguousChargeError).message).not.toMatch(/do not retry/i);
    expect(w.attempts.all()[0]?.outcome).toBe('STOPPED');
  });

  it('recovers a charge the provider created but the store failed to save', async () => {
    // The InfinitePay shape: the provider mints a payable checkout link, then
    // the local write dies. Nothing in the charge store records it, so a
    // naive retry walks from the top and mints a SECOND payable link for the
    // same order — and the buyer can pay both.
    const only = scripted('alpha');
    const w = world([only]);
    const input = { ...pixInput(), idempotencyKey: 'key-12' };

    // Break the charge store for the first call only. The call log IS the
    // counter — a separate mutable flag would just be a second source of
    // truth to keep in step.
    const realCreate = w.charges.create.bind(w.charges);
    const createCalls: string[] = [];
    w.charges.create = async (args) => {
      createCalls.push(args.reference);
      if (createCalls.length === 1) throw new Error('charge store unavailable');
      return realCreate(args);
    };

    // The error names the charge that DOES exist, rather than reporting a
    // bare database failure and losing the one fact that matters.
    const err = await w.gateway.charge(TENANT, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChargeNotPersistedError);
    expect((err as ChargeNotPersistedError).providerChargeId).toBe('alpha_order-1');
    expect((err as ChargeNotPersistedError).recorded).toBe(true);
    // The provider was called and DID create a charge.
    expect(only.spy.chargeCalls).toHaveLength(1);
    expect(w.attempts.all()[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      providerChargeId: 'alpha_order-1',
    });

    // The retry must recover that charge, not create another.
    const charge = await w.gateway.charge(TENANT, input);

    expect(charge.providerChargeId).toBe('alpha_order-1');
    expect(only.spy.chargeCalls).toHaveLength(1);
    expect(w.charges.all()).toHaveLength(1);
  });

  it('names the charge when RECOVERY hits a store failure too', async () => {
    // The recovery paths already know the charge id — they got it from the
    // ledger. A store failure there must carry that id for the same reason
    // the initial-success path does, or the operator is left with a bare
    // database error and no way to find the charge.
    const only = scripted('alpha');
    const w = world([only]);
    const input = { ...pixInput(), idempotencyKey: 'key-13' };

    const realCreate = w.charges.create.bind(w.charges);
    const createCalls: string[] = [];
    w.charges.create = async (args) => {
      createCalls.push(args.reference);
      // Fail the first (initial success) AND the second (recovery) writes.
      if (createCalls.length <= 2) throw new Error('charge store unavailable');
      return realCreate(args);
    };

    await expect(w.gateway.charge(TENANT, input)).rejects.toBeInstanceOf(ChargeNotPersistedError);

    // The retry recovers from the ledger, hits the store failure again, and
    // STILL reports which charge exists.
    const err = await w.gateway.charge(TENANT, input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChargeNotPersistedError);
    expect((err as ChargeNotPersistedError).providerChargeId).toBe('alpha_order-1');
    // Never a second charge, across both failures.
    expect(only.spy.chargeCalls).toHaveLength(1);
  });

  it('keeps refusing to advance while the stopped provider still cannot answer', async () => {
    const first = scripted('alpha', {
      charge: async () => {
        throw timeoutFailure();
      },
      probe: async () => {
        throw new ProviderRequestError('alpha', 'still down', { httpStatus: 503 });
      },
    });
    const second = scripted('beta');
    const w = world([first, second]);
    const input = { ...pixInput(), idempotencyKey: 'key-5' };

    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(AmbiguousChargeError);
    await expect(w.gateway.charge(TENANT, input)).rejects.toThrow(AmbiguousChargeError);

    // Two attempts, still zero charges anywhere.
    expect(second.spy.chargeCalls).toHaveLength(0);
    expect(w.charges.all()).toHaveLength(0);
  });
});
