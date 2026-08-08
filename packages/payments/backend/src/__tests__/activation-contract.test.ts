import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activationFlowOf } from '../activation/flow';
import { settleActivationCharge } from '../activation/webhook';
import { startRedirectVerification, pollRedirectVerification } from '../activation/verify-redirect';
import { verifyProviderCharge } from '../activation/verify-charge';
import type { MerchantRef } from '../core/types';
import {
  ACME,
  activationAdapter,
  activationContextFor,
  activationRegistry,
  connectedConfig,
} from './activation-fixtures';

/**
 * FUT-558's contract: a REDIRECT adapter and a CARD adapter each drive the
 * correct activation branch from CAPABILITIES alone — no provider name is
 * consulted anywhere. The two fakes below differ in nothing but their
 * declared tokenization.
 */

const h = {
  createCharge: vi.fn(),
  refund: vi.fn(),
  findChargeByReference: vi.fn(),
};

const cardAdapter = () =>
  activationAdapter('cardpay', {
    createCharge: h.createCharge as never,
    refund: h.refund as never,
  });

const redirectAdapter = () =>
  activationAdapter('linkpay', {
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'REDIRECT',
    },
    createCharge: h.createCharge as never,
    findChargeByReference: h.findChargeByReference as never,
  });

describe('activation branch, from capabilities alone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a PUBLIC_KEY adapter is the card branch; a REDIRECT adapter the link branch', () => {
    expect(activationFlowOf(cardAdapter())).toBe('CARD');
    expect(activationFlowOf(redirectAdapter())).toBe('REDIRECT');
  });

  it('the card branch proves with a synchronous charge-and-refund', async () => {
    const ctx = activationContextFor({
      providers: activationRegistry({ cardpay: cardAdapter() }),
      config: connectedConfig({ provider: 'cardpay' }),
    });
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'CH_1' });
    // A real snapshot: `refunded` is read off its status (FUT-680), so a bare
    // resolve no longer counts as "the cent came back".
    h.refund.mockResolvedValue({ status: 'REFUNDED' });

    const result = await verifyProviderCharge(ctx, ACME, 'cardpay', {
      token: 'tok',
      taxId: '12345678909',
      holderName: 'Ana',
      email: 'a@x.com',
    });

    expect(result).toEqual({ ok: true, refunded: true });
    const [input] = h.createCharge.mock.calls[0] as [{ method: string }];
    expect(input.method).toBe('CARD');
  });

  it('the redirect branch proves with a hosted link, settled by re-asking the provider', async () => {
    const ctx = activationContextFor({
      providers: activationRegistry({ linkpay: redirectAdapter() }),
      config: connectedConfig({ provider: 'linkpay' }),
    });
    h.createCharge.mockResolvedValue({
      status: 'PENDING',
      hostedCheckoutUrl: 'https://pay.example/x',
    });

    const started = await startRedirectVerification(ctx, ACME, 'linkpay');
    expect(started).toEqual({ ok: true, checkoutUrl: 'https://pay.example/x' });
    const [input] = h.createCharge.mock.calls[0] as [{ method: string }];
    expect(input.method).toBe('PIX');

    h.findChargeByReference.mockResolvedValue({ status: 'PAID' });
    await expect(pollRedirectVerification(ctx, ACME, 'linkpay')).resolves.toMatchObject({
      ok: true,
    });
  });
});

/**
 * The webhook settle's guards (FUT-463): the reference arrives INSIDE an
 * anonymous payload, so both of its halves are checked against facts the
 * payload cannot forge — the VERIFIED merchant, and the adapter that actually
 * verified the delivery. A proof is only a proof of the rail it rode on.
 */
describe('settleActivationCharge', () => {
  const applied: Array<{ merchant: MerchantRef; provider: string }> = [];
  const settings = {
    applyChargeVerification: async (merchant: MerchantRef, provider: string) => {
      applied.push({ merchant, provider });
      return {} as never;
    },
  };

  beforeEach(() => {
    applied.length = 0;
  });

  it('settles the merchant’s own reference, delivered on its own rail', async () => {
    const handled = await settleActivationCharge(
      settings,
      'verify-infinitepay-client-1--k9x',
      ACME,
      'infinitepay',
    );
    expect(handled).toBe(true);
    expect(applied).toEqual([{ merchant: ACME, provider: 'infinitepay' }]);
  });

  it('refuses a reference naming a provider no charge rode through', async () => {
    // A REAL payment through InfinitePay must not stamp PAGBANK as proven.
    const handled = await settleActivationCharge(
      settings,
      'verify-pagbank-client-1',
      ACME,
      'infinitepay',
    );
    expect(handled).toBe(false);
    expect(applied).toHaveLength(0);
  });

  it("refuses a reference naming another merchant's connection", async () => {
    const handled = await settleActivationCharge(
      settings,
      'verify-infinitepay-someone-else',
      ACME,
      'infinitepay',
    );
    expect(handled).toBe(false);
  });

  it('ignores a reference that is not an activation charge at all', async () => {
    expect(await settleActivationCharge(settings, 'order-42', ACME, 'infinitepay')).toBe(false);
  });
});
