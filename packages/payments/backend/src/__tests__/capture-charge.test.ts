import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnsupportedOperationError } from '../core/errors';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ChargeSnapshot, ResolvedCredentials } from '../core/types';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import {
  PT_BR_INFINITEPAY_COPY,
  PT_BR_PAGBANK_COPY,
  PT_BR_STONE_COPY,
  PT_BR_STRIPE_COPY,
} from '../providers/pt-BR';
import { STUB_CREDS, TENANT, cardInput, setupGatewayWorld } from './fixtures';
import { setupCapturingWorld } from './fixtures-capture';

/**
 * Capturing an AUTHORIZED charge (FUT-4082).
 *
 * An authorization only holds the buyer's money; the host now captures it
 * before settling a pedido with it. These pin the request each adapter builds
 * and the snapshot it makes of the answer, and the gateway's gate and
 * persistence around them. `fetch` is stubbed, as in `live-adapters.test.ts`.
 */

type Call = [string, RequestInit];

/** Answer each call with the next queued body (the last repeats); record what was sent. */
function stubFetch(bodies: unknown[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push([String(url), init]);
      const body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

const bodyOf = (call: Call | undefined): unknown => JSON.parse(String(call?.[1].body ?? '{}'));

const PAGBANK: ResolvedCredentials = { environment: 'SANDBOX', fields: { token: 'tok' } };
const LIVE: ResolvedCredentials = {
  environment: 'PRODUCTION',
  fields: { secretKey: 'sk_live_x', publicKey: 'pk_live_x' },
};
const BRL = (amountCents: number) => ({ amountCents, currency: 'BRL' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank captureCharge', () => {
  const capture = pagbankProvider(PT_BR_PAGBANK_COPY).captureCharge!;

  it('captures a charge id at the amount it is handed, and answers PAID', async () => {
    const calls = stubFetch([{ id: 'CHAR_1', status: 'PAID', amount: { value: 4590 } }]);
    const snapshot = await capture({ providerChargeId: 'CHAR_1', amount: BRL(4590) }, PAGBANK, {
      orderId: 'ORDE_1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('https://sandbox.api.pagseguro.com/charges/CHAR_1/capture');
    expect(calls[0]![1].method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ amount: { value: 4590 } });
    expect(snapshot).toMatchObject({ providerChargeId: 'CHAR_1', status: 'PAID', amount: { amountCents: 4590 } });
    // The persisted row keeps the order its later reads go through.
    expect(snapshot.settlementHints).toEqual({ orderId: 'ORDE_1' });
  });

  it('reads the amount through the stored order when the caller names none', async () => {
    const calls = stubFetch([
      { id: 'ORDE_2', charges: [{ id: 'CHAR_2', status: 'AUTHORIZED', amount: { value: 1200 } }] },
      { id: 'CHAR_2', status: 'PAID', amount: { value: 1200 } },
    ]);
    await capture({ providerChargeId: 'CHAR_2' }, PAGBANK, { orderId: 'ORDE_2' });
    expect(calls[0]![0]).toBe('https://sandbox.api.pagseguro.com/orders/ORDE_2');
    expect(calls[1]![0]).toBe('https://sandbox.api.pagseguro.com/charges/CHAR_2/capture');
    expect(bodyOf(calls[1])).toEqual({ amount: { value: 1200 } });
  });

  it('resolves an order id to its AUTHORIZED charge', async () => {
    const calls = stubFetch([
      { id: 'ORDE_3', charges: [{ id: 'CHAR_3', status: 'AUTHORIZED', amount: { value: 700 } }] },
      { id: 'CHAR_3', status: 'PAID', amount: { value: 700 } },
    ]);
    const snapshot = await capture({ providerChargeId: 'ORDE_3', amount: BRL(700) }, PAGBANK);
    expect(calls[1]![0]).toBe('https://sandbox.api.pagseguro.com/charges/CHAR_3/capture');
    expect(snapshot.providerChargeId).toBe('CHAR_3');
  });

  it('refuses an order holding no authorized charge, without calling capture', async () => {
    const calls = stubFetch([{ id: 'ORDE_4', charges: [{ id: 'CHAR_4', status: 'PAID', amount: { value: 1 } }] }]);
    await expect(capture({ providerChargeId: 'ORDE_4' }, PAGBANK)).rejects.toThrow(/no authorized charge/);
    expect(calls).toHaveLength(1);
  });

  it('answers the charge as PagBank reports it — a capture that did not take is not PAID', async () => {
    stubFetch([{ id: 'CHAR_5', status: 'AUTHORIZED', amount: { value: 300 } }]);
    const snapshot = await capture({ providerChargeId: 'CHAR_5', amount: BRL(300) }, PAGBANK);
    expect(snapshot.status).toBe('AUTHORIZED');
  });
});

describe('stone captureCharge (pagar.me v5)', () => {
  it('posts to the charge’s capture endpoint and maps the paid charge', async () => {
    const calls = stubFetch([{ id: 'ch_1', status: 'paid', amount: 2500, paid_amount: 2500 }]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).captureCharge!(
      { providerChargeId: 'ch_1', amount: BRL(2500) },
      LIVE,
    );
    expect(calls[0]![0]).toBe('https://api.pagar.me/core/v5/charges/ch_1/capture');
    expect(calls[0]![1].method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ amount: 2500 });
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_1', status: 'PAID' });
  });
});

describe('stripe captureCharge', () => {
  it('captures the payment intent and maps the succeeded intent', async () => {
    const calls = stubFetch([
      { id: 'pi_1', status: 'succeeded', amount: 990, amount_received: 990, currency: 'brl' },
    ]);
    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).captureCharge!({ providerChargeId: 'pi_1' }, LIVE);
    expect(calls[0]![0]).toBe('https://api.stripe.com/v1/payment_intents/pi_1/capture');
    expect(calls[0]![1].method).toBe('POST');
    expect(snapshot).toMatchObject({ providerChargeId: 'pi_1', status: 'PAID' });
  });
});

describe('the capture capability', () => {
  it('is offered by every adapter that can report AUTHORIZED, and by no PIX-only one', () => {
    expect(pagbankProvider(PT_BR_PAGBANK_COPY).captureCharge).toBeTypeOf('function');
    expect(stoneProvider(PT_BR_STONE_COPY).captureCharge).toBeTypeOf('function');
    expect(stripeProvider(PT_BR_STRIPE_COPY).captureCharge).toBeTypeOf('function');
    // InfinitePay's checkout never authorizes without capturing.
    expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).captureCharge).toBeUndefined();
  });

  it('answers PAID in stub mode, at the amount asked, with no request', async () => {
    const calls = stubFetch([{}]);
    const snapshot = await pagbankProvider(PT_BR_PAGBANK_COPY).captureCharge!(
      { providerChargeId: 'CHAR_S', amount: BRL(100) },
      { ...PAGBANK, stub: true },
    );
    expect(snapshot).toMatchObject({ status: 'PAID', amount: { amountCents: 100 } });
    expect(calls).toHaveLength(0);
  });
});

describe('gateway.captureCharge', () => {
  /** A provider that captures, answering PAID at the amount it was handed. */
  function captured(): NonNullable<PaymentProviderAdapter['captureCharge']> {
    return vi.fn(
      async (input): Promise<ChargeSnapshot> => ({
        provider: 'capturing',
        providerChargeId: input.providerChargeId,
        status: 'PAID',
        amount: input.amount ?? BRL(0),
        method: 'CARD',
      }),
    );
  }

  it('hands the adapter the stored amount and hints, and PERSISTS what it answers', async () => {
    const capture = captured();
    const world = setupCapturingWorld(capture);
    world.credentials.set(TENANT, 'capturing', STUB_CREDS);
    const raised = await world.gateway.charge(TENANT, cardInput('order-cap'), { provider: 'capturing' });
    expect(raised.snapshot.status).toBe('AUTHORIZED');

    const snapshot = await world.gateway.captureCharge(TENANT, 'capturing', raised.snapshot.providerChargeId);

    expect(capture).toHaveBeenCalledWith(
      { providerChargeId: raised.snapshot.providerChargeId, amount: raised.snapshot.amount },
      STUB_CREDS,
      { orderId: 'ORDE_order-cap' },
    );
    expect(snapshot.status).toBe('PAID');
    expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
  });

  it('refuses on a provider with no capture, rather than reporting success', async () => {
    const world = setupGatewayWorld();
    await expect(world.gateway.captureCharge(TENANT, 'stone', 'CH_1')).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });
});
