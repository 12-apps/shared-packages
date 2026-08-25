import { describe, expect, it, vi } from 'vitest';

import {
  createReceiptMailer,
  type PaymentsEmailMessage,
  type PaymentsReceipt,
} from '../email/receipt';
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

  /**
   * The buyer's language, not the deployment's and not the caller's.
   *
   * A receipt is read by whoever paid, in their own inbox. The send is often a
   * webhook or a reconciliation sweep, where there is no caller with an
   * `Accept-Language` at all — so the tag rides on the receipt.
   */
  const packs = {
    'pt-BR': {
      subject: (r: PaymentsReceipt) => `Recibo ${r.reference}`,
      text: (r: PaymentsReceipt) => `Pago: ${r.amountCents}`,
      html: (r: PaymentsReceipt) => `<p>Recibo ${r.reference}</p>`,
    },
    'en-US': {
      subject: (r: PaymentsReceipt) => `Receipt ${r.reference}`,
      text: (r: PaymentsReceipt) => `Paid: ${r.amountCents}`,
      html: (r: PaymentsReceipt) => `<p>Receipt ${r.reference}</p>`,
    },
  };

  const receipt = (locale?: string): PaymentsReceipt => ({
    reference: 'inv_1',
    amountCents: 100,
    currency: 'BRL',
    method: 'pix',
    paidAt: new Date('2026-08-21T12:00:00Z'),
    ...(locale ? { locale } : {}),
  });

  function recordingMailer(copy: Parameters<typeof createReceiptMailer>[0]['copy']) {
    const sent: { to: string; message: PaymentsEmailMessage }[] = [];
    const mailer = createReceiptMailer({
      deliver: {
        send: async (to, message) => {
          sent.push({ to, message });
        },
      },
      copy,
    });
    return { mailer, sent };
  }

  it('writes each receipt in the language of the buyer who paid', async () => {
    const h = recordingMailer(({ locale }) =>
      locale === 'en-US' ? packs['en-US'] : packs['pt-BR'],
    );

    await h.mailer.sendReceipt('ana@example.com', receipt('pt-BR'));
    await h.mailer.sendReceipt('bob@example.com', receipt('en-US'));

    expect(h.sent.map((entry) => entry.message.subject)).toEqual([
      'Recibo inv_1',
      'Receipt inv_1',
    ]);
  });

  it('resolves per RECEIPT, not once at the mount', async () => {
    /**
     * The regression a single-locale host could never see: a mailer built once
     * per process and closed over one pack writes every receipt that
     * deployment ever sends in the same language, and nothing fails.
     */
    const seen = { asked: [] as Array<string | null | undefined> };
    const h = recordingMailer(({ locale }) => {
      seen.asked.push(locale);
      return packs['pt-BR'];
    });

    // The mount asks once with NO locale — that is the construction check.
    expect(seen.asked).toEqual([undefined]);

    await h.mailer.sendReceipt('ana@example.com', receipt('pt-BR'));
    await h.mailer.sendReceipt('bob@example.com', receipt('en-US'));
    expect(seen.asked).toEqual([undefined, 'pt-BR', 'en-US']);
  });

  it('treats a buyer with no stored language as "nobody said"', async () => {
    const seen = { asked: [] as Array<string | null | undefined> };
    const h = recordingMailer(({ locale }) => {
      seen.asked.push(locale);
      return packs['pt-BR'];
    });

    await h.mailer.sendReceipt('ana@example.com', receipt());
    expect(seen.asked).toEqual([undefined, undefined]);
  });

  it('still takes a plain pack, so a single-audience host changes nothing', async () => {
    const h = recordingMailer(packs['pt-BR']);

    await h.mailer.sendReceipt('ana@example.com', receipt('en-US'));
    expect(h.sent[0]?.message.subject).toBe('Recibo inv_1');
  });

  it('refuses a resolver whose DEFAULT rendering is half-built, at the mount', () => {
    // A receipt that throws mid-webhook is a mail the buyer never gets and a
    // retry loop nobody asked for. The check belongs where the host wires it.
    expect(() =>
      createReceiptMailer({
        deliver: { send: async () => {} },
        copy: () => ({ subject: (r: PaymentsReceipt) => r.reference }) as never,
      }),
    ).toThrow(/the words are the host/);
  });

  it('keeps the AMOUNT and the reference fixed while the words move', async () => {
    /**
     * Rule H on the half that must never follow a reader. `amountCents`, the
     * currency code and the host's own reference are what a buyer quotes back
     * and what reconciliation matches on — a language may change how they are
     * introduced, never what they are.
     */
    const h = recordingMailer(({ locale }) =>
      locale === 'en-US' ? packs['en-US'] : packs['pt-BR'],
    );

    await h.mailer.sendReceipt('ana@example.com', receipt('pt-BR'));
    await h.mailer.sendReceipt('bob@example.com', receipt('en-US'));

    expect(h.sent[0]?.message.text).toContain('100');
    expect(h.sent[1]?.message.text).toContain('100');
    expect(h.sent[0]?.message.html).toContain('inv_1');
    expect(h.sent[1]?.message.html).toContain('inv_1');
  });
});
