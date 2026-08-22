import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyProviderCharge } from '../activation/verify-charge';
import { ownsVerificationReference } from '../activation/reference';
import { ProviderRequestError } from '../core/errors';
import { classifyFailure } from '../core/failover';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ActivationContext } from '../activation/context';
import { stripeProvider } from '../providers/stripe';
import { STUB_CHARGE_FAULT_FIELD } from '../providers/stub-fault';
import {
  ACME,
  activationContextFor,
  activationRegistry,
  connectedConfig,
  fakeSettings,
  type FakeSettings,
} from './activation-fixtures';
import { cardInput } from './fixtures';
import { PT_BR_STRIPE_COPY } from '../providers/pt-BR';

/**
 * Stripe's activation charge, driven entirely through the stub path (FUT-689).
 *
 * The pipeline was already stripe-capable — SDK tokenization, the generic CARD
 * branch, refund(), per-attempt references — but nothing exercised CARD
 * activation for an SDK provider until the adapter declared `activationCharge`.
 * These cases pin the whole loop with zero network: the stub approves, the
 * stub declines by token suffix, and the scripted charge fault (`stub-fault.ts`,
 * applied inside `stubCharge`) makes the failure classifiable.
 */

const VERIFY_INPUT = {
  token: 'pm_stub_ok',
  taxId: '12345678909',
  holderName: 'Ana Dona',
  email: 'dona@loja.exemplo',
};

/** The real adapter, with `createCharge` recorded — never replaced. */
function recordingStripe(): { adapter: PaymentProviderAdapter; references: string[] } {
  const stripe = stripeProvider(PT_BR_STRIPE_COPY);
  const references: string[] = [];
  const createCharge: PaymentProviderAdapter['createCharge'] = async (input, credentials) => {
    references.push(input.reference);
    return stripe.createCharge(input, credentials);
  };
  return { adapter: { ...stripe, createCharge }, references };
}

/** A stub SANDBOX connection, optionally scripted with a charge fault. */
function stubWorld(fields: Record<string, string> = {}): {
  ctx: ActivationContext;
  references: string[];
  /** The write-ahead row still outstanding for this connection, or null. */
  pendingRow: () => ReturnType<FakeSettings['pendingOf']>;
} {
  const { adapter, references } = recordingStripe();
  const rows = fakeSettings();
  const ctx: ActivationContext = {
    ...activationContextFor({
      providers: activationRegistry({ stripe: adapter }),
      config: connectedConfig({
        provider: 'stripe',
        environment: 'SANDBOX',
        stub: true,
        environments: { SANDBOX: { secretKey: 'sk_stub', ...fields }, PRODUCTION: {} },
      }),
      settings: rows,
    }),
    // The deployment's own yes — a stored stub row alone proves nothing.
    allowStubMode: true,
  };
  return { ctx, references, pendingRow: () => rows.pendingOf(ACME, 'stripe') };
}

describe('stripe activation charge, stub path (FUT-689)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-02-01T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('given a stub connection, when the owner pays the cent, then it is charged and refunded', async () => {
    const { ctx, references } = stubWorld();

    const result = await verifyProviderCharge(ctx, ACME, 'stripe', VERIFY_INPUT);

    // The cent comes back: the stub refund settles REFUNDED, and `refunded`
    // is read off that snapshot (FUT-680), not off "the call did not throw".
    expect(result).toEqual({ ok: true, refunded: true });
    expect(references).toHaveLength(1);
    expect(ownsVerificationReference(references[0]!, 'stripe', ACME.id)).toBe(true);
  });

  it('given a card the stub declines, then the refusal names the reason', async () => {
    const { ctx } = stubWorld();

    const result = await verifyProviderCharge(ctx, ACME, 'stripe', {
      ...VERIFY_INPUT,
      token: 'pm_stub-declined',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('CARD_DECLINED');
  });

  it('given a decline, when the owner retries, then a fresh attempt is minted, not the old refusal', async () => {
    const { ctx, references, pendingRow } = stubWorld();

    const declined = await verifyProviderCharge(ctx, ACME, 'stripe', {
      ...VERIFY_INPUT,
      token: 'pm_stub-declined',
    });
    expect(declined.ok).toBe(false);
    // A settled answer clears the write-ahead row — nothing blocks the retry.
    expect(pendingRow()).toBeNull();

    // The attempt id is time-derived; a retry in the same millisecond would
    // otherwise collide, so the injected clock moves between attempts.
    vi.advanceTimersByTime(50);
    const retried = await verifyProviderCharge(ctx, ACME, 'stripe', VERIFY_INPUT);

    expect(retried).toEqual({ ok: true, refunded: true });
    expect(references).toHaveLength(2);
    // A NEW charge at the provider: same derivation, different attempt.
    expect(references[1]).not.toBe(references[0]);
    expect(ownsVerificationReference(references[1]!, 'stripe', ACME.id)).toBe(true);
  });

  it('given a scripted not-charged fault, then the stub throws the classifiable refusal', async () => {
    // The chain fixtures' charge-fault hook (`stub-fault.ts`) runs inside
    // stripe's stub `createCharge` — the decline-then-retry story needs no
    // network and no vendor account.
    const credentials = {
      environment: 'SANDBOX' as const,
      fields: { [STUB_CHARGE_FAULT_FIELD]: 'not-charged' },
      stub: true,
    };

    const error: unknown = await stripeProvider(PT_BR_STRIPE_COPY)
      .createCharge(cardInput('verify-stripe-client-1'), credentials)
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ProviderRequestError);
    // HTTP 400: the provider answered and created nothing — the one failure
    // class the failover walk may advance past.
    expect(classifyFailure(error)).toBe('DEFINITELY_NOT_CHARGED');
  });

  it('given a scripted fault, when verification runs, then the attempt settles instead of stranding', async () => {
    const { ctx, pendingRow } = stubWorld({ [STUB_CHARGE_FAULT_FIELD]: 'not-charged' });

    const result = await verifyProviderCharge(ctx, ACME, 'stripe', VERIFY_INPUT);

    expect(result.ok).toBe(false);
    // DEFINITELY_NOT_CHARGED settles the write-ahead record: no cent exists,
    // so nothing may sit there blocking the owner's next attempt.
    expect(pendingRow()).toBeNull();
  });
});
