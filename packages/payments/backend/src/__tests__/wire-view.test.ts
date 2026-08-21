import { describe, expect, it, vi } from 'vitest';

import { createReceiptMailer, type PaymentsEmailMessage } from '../email/receipt';
import { LIBRARY_ROUTES } from '../http/route-table';
import { createWireMountPayments, type PaymentsWireRoute } from '../http/wire-view';
import type { MerchantRef } from '../core/types';
import type { PaymentsHttpHandlers } from '../http/handlers';

/**
 * The countable views and the receipt seam. The mounts' own behavior is
 * pinned by `router.test.ts` and the checkout suites (whose harness now
 * builds through the wire view, so every one of those assertions also runs
 * over it); what THIS file pins is the view's own claims — the row set
 * matches what the dispatcher serves, a descriptor reaches the same handler
 * the catch-all would, and the raw request is load-bearing.
 */

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 't1' };

const ok = (): Promise<Response> => Promise.resolve(Response.json({ ok: true }));

function fakeHttp(): PaymentsHttpHandlers {
  return {
    getClientConfig: vi.fn(ok),
    createCharge: vi.fn(ok),
    getCharge: vi.fn(ok),
    handleWebhook: vi.fn(ok),
    getSettings: vi.fn(ok),
    saveCredentials: vi.fn(ok),
    setEnabled: vi.fn(ok),
    setPriorities: vi.fn(ok),
    setFailoverPolicy: vi.fn(ok),
    verify: vi.fn(ok),
    getSetupGuide: vi.fn(ok),
    beginOAuth: vi.fn(ok),
    completeOAuth: vi.fn(ok),
    disconnectOAuth: vi.fn(ok),
    beginVault: vi.fn(ok),
    completeVault: vi.fn(ok),
    forgetVault: vi.fn(ok),
  };
}

function world(overrides: Record<string, unknown> = {}): {
  http: PaymentsHttpHandlers;
  routes: readonly PaymentsWireRoute[];
} {
  const http = fakeHttp();
  const { routes } = createWireMountPayments<{ user: string }>({
    gateway: http,
    requireAuth: () => ({ user: 'admin' }),
    resolveMerchant: () => MERCHANT,
    ...overrides,
  });
  return { http, routes };
}

function routeOf(routes: readonly PaymentsWireRoute[], key: string): PaymentsWireRoute {
  const found = routes.find((route) => `${route.method} ${route.path}` === key);
  if (!found) throw new Error(`no route ${key}`);
  return found;
}

const raw = (method: string): Request => new Request('http://payments.test/x', { method });

const wireRequest = (
  method: string,
  params: Record<string, string | undefined> = {},
): Parameters<PaymentsWireRoute['handle']>[0] => ({
  actor: undefined,
  params,
  query: {},
  request: raw(method),
});

describe('createWireMountPayments — the countable view', () => {
  it('counts exactly the rows the dispatcher serves, webhook marked as such', () => {
    const { routes } = world();
    expect(routes).toHaveLength(LIBRARY_ROUTES.length);
    const webhook = routeOf(routes, 'POST /webhooks/:provider');
    expect(webhook.kind).toBe('webhook');
    expect(routes.filter((route) => route.kind === 'webhook')).toHaveLength(1);
  });

  it('drops excluded kinds and counts host extensions, like the mount itself', () => {
    const extension = {
      kind: 'reconcile',
      method: 'POST' as const,
      pattern: ['reconcile'],
      handler: async () => Response.json({ ok: true }),
    };
    const { routes } = world({ exclude: ['completeOAuth'], extensions: [extension] });
    expect(routes).toHaveLength(LIBRARY_ROUTES.length); // one out, one in
    expect(routes.some((route) => route.path.includes('oauth/complete'))).toBe(false);
    expect(routeOf(routes, 'POST /reconcile').path).toBe('/reconcile');
  });

  it('dispatches a descriptor to the same handler the catch-all serves, captures filled', async () => {
    const { http, routes } = world();
    const answer = await routeOf(routes, 'GET /charges/:provider/:chargeId').handle(
      wireRequest('GET', { provider: 'stone', chargeId: 'ch_9' }),
    );
    expect(http.getCharge).toHaveBeenCalledWith({ merchant: MERCHANT }, 'stone', 'ch_9');
    if (!('response' in answer)) throw new Error('expected the raw half');
    expect(answer.response.status).toBe(200);
  });

  it('slices its own prefix so a deep-mounted host still reaches the row', async () => {
    const { http, routes } = world({ prefix: ['settings'] });
    await routeOf(routes, 'GET /settings').handle(wireRequest('GET'));
    expect(http.getSettings).toHaveBeenCalledWith({ merchant: MERCHANT });
  });

  it('refuses to guess when the adapter dropped the raw request', async () => {
    const { http, routes } = world();
    const answer = await routeOf(routes, 'GET /config').handle({
      actor: undefined,
      params: {},
      query: {},
    });
    expect(answer).toEqual({
      status: 500,
      body: { error: 'payments routes need the raw request' },
    });
    expect(http.getClientConfig).not.toHaveBeenCalled();
  });
});

describe('createReceiptMailer — the email seam', () => {
  it('renders through the host copy and delivers through the one port', async () => {
    const sent: { to: string; message: PaymentsEmailMessage }[] = [];
    const mailer = createReceiptMailer({
      deliver: {
        send: async (to, message) => {
          sent.push({ to, message });
        },
      },
      copy: {
        subject: (receipt) => `receipt ${receipt.reference}`,
        text: (receipt) => `${receipt.amountCents} ${receipt.currency} by ${receipt.method}`,
        html: (receipt) => `<p>${receipt.reference}</p>`,
      },
    });
    await mailer.sendReceipt('ana@example.com', {
      reference: 'inv_2024_0043',
      amountCents: 7500,
      currency: 'BRL',
      method: 'pix',
      paidAt: new Date('2026-08-21T12:00:00Z'),
    });
    expect(sent).toEqual([
      {
        to: 'ana@example.com',
        message: {
          subject: 'receipt inv_2024_0043',
          text: '7500 BRL by pix',
          html: '<p>inv_2024_0043</p>',
        },
      },
    ]);
  });

  it('refuses construction without the three-part copy — the words are the host\'s', () => {
    expect(() =>
      createReceiptMailer({ deliver: { send: async () => {} }, copy: {} as never }),
    ).toThrow(/the words are the host/);
  });
});
