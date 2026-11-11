import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError, UnsupportedOperationError } from '../../core/errors';
import { createPaymentsGateway } from '../../core/gateway';
import { defineProviders } from '../../core/registry';
import { classifyReversalEvent } from '../../core/reversal';
import type { ChargeSnapshot, MerchantRef, ResolvedCredentials } from '../../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../../memory';
import { createMemoryWebhookInbox } from '../../memory-webhook-inbox';
import { infinitePayProvider } from '../infinitepay';
import { pagbankProvider } from '../pagbank';
import { PT_BR_INFINITEPAY_COPY, PT_BR_PAGBANK_COPY, PT_BR_STRIPE_COPY } from '../pt-BR';
import { stripeProvider } from '../stripe';

/**
 * FUT-4571 — PagBank partial refunds, so a discount on a paid order refunds
 * itself. The contract this file pins, one `it` per row:
 * `agent-as10a-contract/contract.md` of the bd:aliment-sabor burn-down.
 *
 * PagBank's `POST /charges/{id}/cancel` with `amount.value` below the charge
 * refunds PART of a CREDIT_CARD charge: the answer keeps `status: "PAID"` and
 * moves `amount.summary.refunded` (CUMULATIVE). A cancel that returns the rest
 * answers `CANCELED`. Card goes automatic; Pix stays manual (owner,
 * 2026-11-11) until a sandbox run proves it.
 *
 * Capability shape (additive): `partialRefunds: boolean` keeps meaning "every
 * method", PagBank keeps `false` there so no consumer that has not upgraded
 * sees a wider claim than before, and a new optional
 * `partialRefundMethods: readonly PaymentMethodKind[]` names the methods a
 * provider refunds in part beyond that claim. `supportsPartialRefund(caps,
 * method)` (package root) is the one reader.
 */

const CREDS: ResolvedCredentials = { environment: 'SANDBOX', fields: { token: 'tok' } };
const STUB: ResolvedCredentials = { environment: 'SANDBOX', fields: {}, stub: true };
const API = 'https://sandbox.api.pagseguro.com';
const TENANT: MerchantRef = { kind: 'TENANT', id: 'tenant-1' };
const brl = (amountCents: number) => ({ amountCents, currency: 'BRL' as const });

type Reply = { status?: number; body?: unknown } | Error;

/**
 * Stub `fetch` BY VERB: every GET (the read-back) gets `replies[0]`, every
 * POST (the cancel) gets the LAST reply; an Error rejects. Routed rather than
 * queued so a run that skips the read-back still meets the cancel's answer.
 */
function mockFetchQueue(replies: Reply[]) {
  const calls: Array<[string, RequestInit]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push([String(url), init]);
      const reply = (init.method === 'POST' ? replies[replies.length - 1] : replies[0])!;
      if (reply instanceof Error) throw reply;
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'ERR',
        json: async () => reply.body,
        text: async () => JSON.stringify(reply.body ?? ''),
      } as unknown as Response;
    }),
  );
  return calls;
}

const posts = (calls: Array<[string, RequestInit]>) =>
  calls.filter(([, init]) => init.method === 'POST');
const bodyOf = (call: [string, RequestInit] | undefined) =>
  JSON.parse(String(call?.[1]?.body)) as unknown;

/** A PagBank charge as an order or the charge endpoint reports it. */
function charge(opts: {
  id?: string;
  status?: string;
  value?: number;
  refunded?: number;
  type?: 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX';
}) {
  const value = opts.value ?? 1000;
  return {
    id: opts.id ?? 'CHAR_1',
    status: opts.status ?? 'PAID',
    amount: {
      value,
      ...(opts.refunded !== undefined
        ? { summary: { total: value, paid: value, refunded: opts.refunded } }
        : {}),
    },
    payment_method: { type: opts.type ?? 'CREDIT_CARD' },
  };
}

const order = (...charges: unknown[]) => ({ id: 'ORDE_1', reference_id: 'order-1', charges });
const adapter = () => pagbankProvider(PT_BR_PAGBANK_COPY);

/** Refund `cents` of CHAR_1 through its stored order hint, the shape every new row has. */
function partial(cents: number) {
  return adapter().refund!({ providerChargeId: 'CHAR_1', amount: brl(cents) }, CREDS, {
    orderId: 'ORDE_1',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PagBank capability: card refunds in part, Pix does not (FUT-4571)', () => {
  it('C1 keeps partialRefunds false and names CARD alone in partialRefundMethods', () => {
    const caps: { partialRefunds: boolean; partialRefundMethods?: readonly string[] } =
      adapter().capabilities;
    // `false` stays: a consumer that reads only the boolean keeps today's
    // answer (manual), never a wider claim it cannot narrow by method.
    expect(caps.partialRefunds).toBe(false);
    expect(caps.partialRefundMethods).toEqual(['CARD']);
  });

  it('C2 answers supportsPartialRefund per method from the package root', async () => {
    const root = (await import('../../index')) as Record<string, unknown>;
    const supports = root['supportsPartialRefund'] as
      | ((caps: unknown, method: 'PIX' | 'CARD' | 'BOLETO') => boolean)
      | undefined;
    expect(typeof supports).toBe('function');
    const pagbank = adapter().capabilities;
    expect(supports!(pagbank, 'CARD')).toBe(true);
    expect(supports!(pagbank, 'PIX')).toBe(false);
    // A provider whose boolean already says yes answers yes for every method,
    // and one that says no and names nothing answers no — both unchanged.
    expect(supports!(stripeProvider(PT_BR_STRIPE_COPY).capabilities, 'PIX')).toBe(true);
    expect(supports!(infinitePayProvider(PT_BR_INFINITEPAY_COPY).capabilities, 'CARD')).toBe(false);
  });

  it('C3 leaves every other provider without partialRefundMethods', () => {
    for (const provider of [stripeProvider(PT_BR_STRIPE_COPY), infinitePayProvider(PT_BR_INFINITEPAY_COPY)]) {
      expect(provider.capabilities).not.toHaveProperty('partialRefundMethods');
    }
  });
});

describe('PagBank refund through the API (FUT-4571)', () => {
  it('R1 refunds a never-refunded card charge in full exactly as main does', async () => {
    const calls = mockFetchQueue([
      { body: order(charge({ refunded: 0 })) },
      { body: charge({ status: 'CANCELED', refunded: 1000 }) },
    ]);
    const refund = await adapter().refund!({ providerChargeId: 'CHAR_1' }, CREDS, { orderId: 'ORDE_1' });

    expect(calls.map(([url]) => url)).toEqual([`${API}/orders/ORDE_1`, `${API}/charges/CHAR_1/cancel`]);
    expect(bodyOf(calls[1])).toEqual({ amount: { value: 1000 } });
    expect(refund).toMatchObject({
      providerChargeId: 'CHAR_1',
      providerRefundId: 'CHAR_1',
      status: 'REFUNDED',
      amount: brl(1000),
    });
  });

  it('R1b reports only what a full refund after a partial returned, not the charge total', async () => {
    mockFetchQueue([
      { body: order(charge({ refunded: 500 })) },
      { body: charge({ status: 'CANCELED', refunded: 1000 }) },
    ]);
    const refund = await adapter().refund!({ providerChargeId: 'CHAR_1' }, CREDS, { orderId: 'ORDE_1' });
    expect(refund.status).toBe('REFUNDED');
    expect(refund.amount).toEqual(brl(500));
  });

  it('R2 a first partial on a card charge is REFUNDED when PagBank answers PAID with refunded grown by it', async () => {
    const calls = mockFetchQueue([
      { body: order(charge({ refunded: 0 })) },
      { body: charge({ status: 'PAID', refunded: 500 }) },
    ]);
    const refund = await partial(500);

    // Read back BEFORE the cancel: the remainder, the method and the
    // refunded-so-far are what prove the answer.
    expect(calls.map(([url]) => url)).toEqual([`${API}/orders/ORDE_1`, `${API}/charges/CHAR_1/cancel`]);
    expect(bodyOf(calls[1])).toEqual({ amount: { value: 500 } });
    expect(refund).toMatchObject({ providerChargeId: 'CHAR_1', status: 'REFUNDED', amount: brl(500) });
  });

  it('R3 a second partial reads the cumulative summary as THIS refund’s share, under its own refund id', async () => {
    mockFetchQueue([
      { body: order(charge({ refunded: 0 })) },
      { body: charge({ status: 'PAID', refunded: 500 }) },
    ]);
    const first = await partial(500);

    mockFetchQueue([
      { body: order(charge({ refunded: 500 })) },
      { body: charge({ status: 'PAID', refunded: 800 }) },
    ]);
    const second = await partial(300);

    expect(second.status).toBe('REFUNDED');
    expect(second.amount).toEqual(brl(300));
    // Two refunds on one charge are two ledger facts: one id would let a host
    // that keys refunds by it drop the second as a duplicate.
    expect(second.providerRefundId).not.toBe(first.providerRefundId);
  });

  it('R4 a partial equal to the remainder is REFUNDED when PagBank answers CANCELED', async () => {
    const calls = mockFetchQueue([
      { body: order(charge({ refunded: 500 })) },
      { body: charge({ status: 'CANCELED', refunded: 1000 }) },
    ]);
    const refund = await partial(500);
    expect(bodyOf(posts(calls)[0])).toEqual({ amount: { value: 500 } });
    expect(refund.status).toBe('REFUNDED');
    expect(refund.amount).toEqual(brl(500));
  });

  it('R5 refuses a partial above the remainder and sends nothing', async () => {
    const calls = mockFetchQueue([{ body: order(charge({ refunded: 500 })) }]);
    const error = await partial(600).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).retriable).toBe(false);
    expect(posts(calls)).toHaveLength(0);
  });

  it('R5b refuses a partial above the whole charge and sends nothing', async () => {
    const calls = mockFetchQueue([{ body: order(charge({ refunded: 0 })) }]);
    await expect(partial(1001)).rejects.toThrow(ProviderRequestError);
    expect(posts(calls)).toHaveLength(0);
  });

  it('R6 refuses a partial on a Pix charge with UnsupportedOperationError and sends no cancel', async () => {
    const calls = mockFetchQueue([{ body: order(charge({ type: 'PIX', refunded: 0 })) }]);
    await expect(partial(500)).rejects.toThrow(UnsupportedOperationError);
    expect(posts(calls)).toHaveLength(0);
  });

  it('R7 refuses a partial handed a Pix ORDER id once it resolves the paid Pix charge', async () => {
    const calls = mockFetchQueue([{ body: order(charge({ type: 'PIX', refunded: 0 })) }]);
    await expect(
      adapter().refund!({ providerChargeId: 'ORDE_1', amount: brl(500) }, CREDS),
    ).rejects.toThrow(UnsupportedOperationError);
    expect(posts(calls)).toHaveLength(0);
  });

  it('R7b refuses a partial on an ORDER nobody paid, as main does', async () => {
    const calls = mockFetchQueue([{ body: { id: 'ORDE_1', qr_codes: [{ text: 'emv' }] } }]);
    await expect(
      adapter().refund!({ providerChargeId: 'ORDE_1', amount: brl(500) }, CREDS),
    ).rejects.toThrow(ProviderRequestError);
    expect(posts(calls)).toHaveLength(0);
  });

  it('R7c resolves a card ORDER id to its charge and cancels part of it', async () => {
    const calls = mockFetchQueue([
      { body: order(charge({ refunded: 0 })) },
      { body: charge({ status: 'PAID', refunded: 500 }) },
    ]);
    const refund = await adapter().refund!({ providerChargeId: 'ORDE_1', amount: brl(500) }, CREDS);
    expect(posts(calls)[0]![0]).toBe(`${API}/charges/CHAR_1/cancel`);
    expect(refund.status).toBe('REFUNDED');
    expect(refund.amount).toEqual(brl(500));
  });

  it('R8 reads PAID with refunded unchanged as FAILED: the cancel did not take', async () => {
    mockFetchQueue([
      { body: order(charge({ refunded: 500 })) },
      { body: charge({ status: 'PAID', refunded: 500 }) },
    ]);
    expect((await partial(300)).status).toBe('FAILED');
  });

  it('R8b never reads REFUNDED when refunded grew by other than the requested amount', async () => {
    mockFetchQueue([
      { body: order(charge({ refunded: 0 })) },
      { body: charge({ status: 'PAID', refunded: 300 }) },
    ]);
    expect((await partial(500)).status).not.toBe('REFUNDED');
  });

  it('R8c reads PAID with no summary at all as FAILED', async () => {
    mockFetchQueue([{ body: order(charge({ refunded: 0 })) }, { body: charge({ status: 'PAID' }) }]);
    expect((await partial(500)).status).toBe('FAILED');
  });

  it('R9 refuses a partial whose read-back fails, sending no cancel it could not judge', async () => {
    const calls = mockFetchQueue([{ status: 500, body: { error: 'boom' } }]);
    await expect(partial(500)).rejects.toThrow(ProviderRequestError);
    expect(posts(calls)).toHaveLength(0);
  });

  it('R10 a response lost after the cancel was sent throws, once, and reports nothing refunded', async () => {
    const lost = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'UND_ERR_HEADERS_TIMEOUT' },
    });
    const calls = mockFetchQueue([{ body: order(charge({ refunded: 0 })) }, lost]);
    await expect(partial(500)).rejects.toThrow();
    // Never retried: the cancel may have reached PagBank, and a second one
    // refunds the buyer twice.
    expect(posts(calls)).toHaveLength(1);
  });

  it('R11 stub credentials refund the requested part with no HTTP call', async () => {
    const calls = mockFetchQueue([{ body: {} }]);
    const refund = await adapter().refund!({ providerChargeId: 'CHAR_1', amount: brl(500) }, STUB);
    expect(calls).toHaveLength(0);
    expect(refund).toMatchObject({ status: 'REFUNDED', amount: brl(500) });
  });
});

describe('PagBank refund through the gateway (FUT-4571)', () => {
  function world(snapshot?: Partial<ChargeSnapshot>, creds: ResolvedCredentials = STUB) {
    const credentials = createMemoryCredentialStore();
    const charges = createMemoryChargeStore();
    const gateway = createPaymentsGateway({
      providers: defineProviders({ pagbank: adapter() } as const),
      credentials,
      charges,
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
      onWebhookEvent: async () => undefined,
    });
    credentials.set(TENANT, 'pagbank', creds);
    const stored = snapshot
      ? charges.create({
          merchant: TENANT,
          reference: 'order-1',
          snapshot: {
            provider: 'pagbank',
            providerChargeId: 'CHAR_1',
            status: 'PAID',
            amount: brl(1000),
            method: 'CARD',
            settlementHints: { orderId: 'ORDE_1' },
            ...snapshot,
          } as ChargeSnapshot,
        })
      : Promise.resolve();
    return { gateway, ready: stored };
  }

  it('G1 lets a partial through for a stored CARD charge', async () => {
    const { gateway, ready } = world({ method: 'CARD' });
    await ready;
    const refund = await gateway.refund(TENANT, 'pagbank', { providerChargeId: 'CHAR_1', amount: brl(500) });
    expect(refund).toMatchObject({ status: 'REFUNDED', amount: brl(500) });
  });

  it('G2 refuses a partial for a stored PIX charge before any HTTP call', async () => {
    const calls = mockFetchQueue([{ body: {} }]);
    const { gateway, ready } = world({ method: 'PIX' }, CREDS);
    await ready;
    await expect(
      gateway.refund(TENANT, 'pagbank', { providerChargeId: 'CHAR_1', amount: brl(500) }),
    ).rejects.toThrow(UnsupportedOperationError);
    expect(calls).toHaveLength(0);
  });

  it('G3 with no stored row, defers to the adapter, which reads the method back', async () => {
    const calls = mockFetchQueue([
      { body: charge({ refunded: 0 }) },
      { body: charge({ status: 'PAID', refunded: 500 }) },
    ]);
    const { gateway } = world(undefined, CREDS);
    const refund = await gateway.refund(TENANT, 'pagbank', { providerChargeId: 'CHAR_1', amount: brl(500) });
    expect(calls.map(([url]) => url)).toEqual([`${API}/charges/CHAR_1`, `${API}/charges/CHAR_1/cancel`]);
    expect(refund.status).toBe('REFUNDED');
  });

  it('G4 still lets a FULL refund of a stored PIX charge through, as main does', async () => {
    const { gateway, ready } = world({ method: 'PIX' });
    await ready;
    await expect(gateway.refund(TENANT, 'pagbank', { providerChargeId: 'CHAR_1' })).resolves.toMatchObject({
      status: 'REFUNDED',
    });
  });
});

describe('PagBank webhook and poll of a partially refunded charge (FUT-4571)', () => {
  const LIVE: ResolvedCredentials = { environment: 'SANDBOX', fields: { token: 'tok', webhookToken: 'wh' } };
  const parse = (body: unknown) =>
    adapter().webhook.parse({ provider: 'pagbank', rawBody: JSON.stringify(body), headers: {} }, LIVE);

  it('W1 reads PAID with refunded > 0 as PARTIALLY_REFUNDED, keeping the captured amount', async () => {
    const events = await parse(order(charge({ status: 'PAID', refunded: 500 })));
    expect(events[0]).toMatchObject({
      type: 'CHARGE_UPDATED',
      charge: { providerChargeId: 'CHAR_1', status: 'PARTIALLY_REFUNDED', amount: brl(1000) },
    });
  });

  it('W2 never hands the host a reversal for a partial: the order must stay PAID', async () => {
    // `classifyReversalEvent` answering REFUND is what makes a host take the
    // order out of PAID — for 500 cents of a 1000-cent charge.
    const events = await parse(order(charge({ status: 'PAID', refunded: 500 })));
    for (const event of events) expect(classifyReversalEvent(event)).toBeNull();
  });

  it('W3 a replay of the same partial delivery carries the same event ids', async () => {
    const body = order(charge({ status: 'PAID', refunded: 500 }));
    const first = (await parse(body)).map((e) => e.eventId);
    const again = (await parse(body)).map((e) => e.eventId);
    expect(again).toEqual(first);
  });

  it('W4 a second partial is news, never a duplicate of the first', async () => {
    const first = (await parse(order(charge({ status: 'PAID', refunded: 500 })))).map((e) => e.eventId);
    const second = (await parse(order(charge({ status: 'PAID', refunded: 800 })))).map((e) => e.eventId);
    for (const id of second) expect(first).not.toContain(id);
  });

  it('W5 the cancel that returns the rest is a full reversal of the charge total, as main does', async () => {
    const events = await parse(order(charge({ status: 'CANCELED', refunded: 1000 })));
    expect(events[0]!.charge?.status).toBe('REFUNDED');
    const refund = events.find((e) => e.type === 'REFUND_UPDATED');
    expect(refund?.refund).toMatchObject({ status: 'REFUNDED', amount: brl(1000) });
    expect(classifyReversalEvent(refund!)).toMatchObject({ kind: 'REFUND', refundedCents: 1000 });
  });

  it('P1 a poll of a partially refunded charge answers PARTIALLY_REFUNDED', async () => {
    mockFetchQueue([{ body: order(charge({ status: 'PAID', refunded: 500 })) }]);
    const snapshot = await adapter().getCharge('CHAR_1', CREDS, { orderId: 'ORDE_1' });
    expect(snapshot.status).toBe('PARTIALLY_REFUNDED');
  });

  it('M1 a card order polled or delivered names CARD, so a stored row keeps its method', async () => {
    // `mergeRefreshedSnapshot` takes the refreshed method once the status is
    // terminal, so an order mapping that always says PIX turns a stored card
    // row into a Pix one — and the gateway's per-method gate would then
    // refuse every card partial refund after the first webhook.
    mockFetchQueue([{ body: order(charge({ status: 'PAID' })) }]);
    const polled = await adapter().getCharge('CHAR_1', CREDS, { orderId: 'ORDE_1' });
    expect(polled.method).toBe('CARD');
    const [event] = await parse(order(charge({ status: 'PAID' })));
    expect(event!.charge?.method).toBe('CARD');
  });
});
