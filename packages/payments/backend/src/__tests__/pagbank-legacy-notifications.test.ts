import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import type { ResolvedCredentials } from '../core/types';
import { resolvePagbankNotification } from '../providers/pagbank-legacy-notifications';

/**
 * FUT-477, second half — resolving a legacy `notificationCode` delivery.
 *
 * The form-encoded post-transaction shape carries only an opaque code;
 * `webhook.parse` parks it as UNKNOWN with the code on `raw`, and THIS is the
 * follow-up query that turns the code into events a host can act on. The
 * ticket's floor: a chargeback must not leave the order reading PAID.
 */

const CREDS: ResolvedCredentials = {
  environment: 'PRODUCTION',
  fields: { email: 'loja@example.com', token: 'legacy-api-token' },
};

const CODE = '093C100E7FA87FA8C0B664B79F8359773B96';

/** The v3 XML response, realistic shape — nested paymentMethod included. */
function transactionXml(overrides: { status: string; grossAmount?: string; methodType?: string }) {
  return `<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>
<transaction>
  <date>2026-08-07T15:46:23.000-03:00</date>
  <code>9E884542-81B3-4419-9A75-BCC6FB495EF1</code>
  <reference>order-42</reference>
  <type>1</type>
  <status>${overrides.status}</status>
  <lastEventDate>2026-08-08T10:12:00.000-03:00</lastEventDate>
  <paymentMethod>
    <type>${overrides.methodType ?? '1'}</type>
    <code>101</code>
  </paymentMethod>
  ${overrides.grossAmount === undefined ? '<grossAmount>459.50</grossAmount>' : overrides.grossAmount}
  <discountAmount>0.00</discountAmount>
  <netAmount>445.72</netAmount>
  <extraAmount>0.00</extraAmount>
  <installmentCount>1</installmentCount>
  <itemCount>1</itemCount>
</transaction>`;
}

function mockFetch(body: string, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolvePagbankNotification — the wire call', () => {
  it('GETs the documented legacy lookup with the account e-mail and API token', async () => {
    const spy = mockFetch(transactionXml({ status: '3' }));
    await resolvePagbankNotification(CODE, CREDS);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://ws.pagseguro.uol.com.br');
    expect(parsed.pathname).toBe(`/v3/transactions/notifications/${CODE}`);
    expect(parsed.searchParams.get('email')).toBe('loja@example.com');
    expect(parsed.searchParams.get('token')).toBe('legacy-api-token');
    expect(init.method).toBe('GET');
  });

  it('uses the sandbox legacy host for SANDBOX credentials', async () => {
    const spy = mockFetch(transactionXml({ status: '3' }));
    await resolvePagbankNotification(CODE, { ...CREDS, environment: 'SANDBOX' });
    expect((spy.mock.calls[0] as [string])[0]).toContain('https://ws.sandbox.pagseguro.uol.com.br/');
  });

  it('prefers a dedicated legacy pair over the Connect-shared fields', async () => {
    // A Connect store's `token` is an OAuth access token the legacy host does
    // not accept, so a host that stores the legacy pair apart must win.
    const spy = mockFetch(transactionXml({ status: '3' }));
    await resolvePagbankNotification(CODE, {
      environment: 'PRODUCTION',
      fields: {
        token: 'oauth-access-token',
        legacyEmail: 'conta@example.com',
        legacyToken: 'token-api-antigo',
      },
    });
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain('email=conta%40example.com');
    expect(url).toContain('token=token-api-antigo');
  });

  it('refuses to call at all without the legacy credential pair', async () => {
    const spy = mockFetch(transactionXml({ status: '3' }));
    await expect(
      resolvePagbankNotification(CODE, { environment: 'PRODUCTION', fields: { token: 't' } }),
    ).rejects.toThrow(ProviderRequestError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces an HTTP refusal as a ProviderRequestError with its status', async () => {
    mockFetch('Not Found', 404);
    await expect(resolvePagbankNotification(CODE, CREDS)).rejects.toMatchObject({
      options: { httpStatus: 404 },
    });
  });

  it('resolves nothing in stub mode, with no network call', async () => {
    const spy = mockFetch(transactionXml({ status: '3' }));
    await expect(
      resolvePagbankNotification(CODE, { ...CREDS, stub: true }),
    ).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('resolvePagbankNotification — event mapping per transaction status', () => {
  async function resolve(status: string, extra: { grossAmount?: string; methodType?: string } = {}) {
    mockFetch(transactionXml({ status, ...extra }));
    return resolvePagbankNotification(CODE, CREDS);
  }

  it('Given a chargeback (Devolvida), the order can be taken out of PAID', async () => {
    const events = await resolve('6');

    // The charge event is what moves the row: REFUNDED outranks PAID.
    expect(events[0]).toMatchObject({
      type: 'CHARGE_UPDATED',
      charge: {
        provider: 'pagbank',
        providerChargeId: '9E884542-81B3-4419-9A75-BCC6FB495EF1',
        reference: 'order-42',
        status: 'REFUNDED',
        amount: { amountCents: 45950, currency: 'BRL' },
      },
    });
    // ...and the refund ledger fact rides alongside, reference included.
    expect(events[1]).toMatchObject({
      type: 'REFUND_UPDATED',
      refund: {
        provider: 'pagbank',
        providerRefundId: CODE,
        reference: 'order-42',
        status: 'REFUNDED',
        amount: { amountCents: 45950, currency: 'BRL' },
      },
    });
    expect(events[1]!.eventId).not.toBe(events[0]!.eventId);
  });

  it('maps a debited chargeback (Debitado) the same way', async () => {
    const events = await resolve('8');
    expect(events.map((event) => event.type)).toEqual(['CHARGE_UPDATED', 'REFUND_UPDATED']);
    expect(events[0]!.charge?.status).toBe('REFUNDED');
  });

  it('maps a dispute (Em disputa) to DISPUTE_UPDATED with no snapshot', async () => {
    // Money HELD, not moved: a charge status would assert an outcome the
    // dispute has not reached. The raw detail still names the order.
    const events = await resolve('5');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'DISPUTE_UPDATED',
      raw: { reference: 'order-42', statusCode: '5', notificationCode: CODE },
    });
    expect(events[0]!.charge).toBeUndefined();
    expect(events[0]!.refund).toBeUndefined();
  });

  it('maps a contestation hold (Retenção temporária) as a dispute too', async () => {
    const events = await resolve('9');
    expect(events[0]!.type).toBe('DISPUTE_UPDATED');
  });

  it('maps a cancellation (Cancelada) to a CANCELED charge', async () => {
    const events = await resolve('7');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'CHARGE_UPDATED',
      charge: { status: 'CANCELED', reference: 'order-42' },
    });
  });

  it('maps a settlement (Disponível) to a PAID charge with the real amount', async () => {
    const events = await resolve('4');
    expect(events[0]).toMatchObject({
      type: 'CHARGE_UPDATED',
      charge: { status: 'PAID', amount: { amountCents: 45950 } },
    });
  });

  it('maps Paga to PAID and the waiting statuses to PENDING', async () => {
    expect((await resolve('3'))[0]!.charge?.status).toBe('PAID');
    expect((await resolve('1'))[0]!.charge?.status).toBe('PENDING');
    expect((await resolve('2'))[0]!.charge?.status).toBe('PENDING');
  });

  it('leaves an unpublished status code UNKNOWN with the detail preserved', async () => {
    const events = await resolve('42');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'UNKNOWN',
      raw: { statusCode: '42', transactionCode: '9E884542-81B3-4419-9A75-BCC6FB495EF1' },
    });
  });

  it('REFUSES a paid resolution with no grossAmount instead of settling for zero', async () => {
    await expect(resolve('3', { grossAmount: '<grossAmount></grossAmount>' })).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('keeps event ids stable per notification so re-resolution dedups in the inbox', async () => {
    const first = await resolve('6');
    const second = await resolve('6');
    expect(second.map((event) => event.eventId)).toEqual(first.map((event) => event.eventId));
  });

  it('reads the transaction code, not the nested paymentMethod code', async () => {
    const events = await resolve('3');
    expect(events[0]!.charge?.providerChargeId).toBe('9E884542-81B3-4419-9A75-BCC6FB495EF1');
    expect(events[0]!.charge?.providerChargeId).not.toBe('101');
  });

  it('normalizes the payment method: card, boleto, and PIX as the default', async () => {
    expect((await resolve('3', { methodType: '1' }))[0]!.charge?.method).toBe('CARD');
    expect((await resolve('3', { methodType: '2' }))[0]!.charge?.method).toBe('BOLETO');
    expect((await resolve('3', { methodType: '11' }))[0]!.charge?.method).toBe('PIX');
  });

  it('converts decimal reais to integer cents without float drift', async () => {
    const events = await resolve('3', { grossAmount: '<grossAmount>0.19</grossAmount>' });
    // 0.19 * 100 is 19.000000000000004 in floats; string math must say 19.
    expect(events[0]!.charge?.amount.amountCents).toBe(19);
  });

  it('refuses a resolution missing its transaction code or status', async () => {
    mockFetch('<?xml version="1.0"?><transaction><reference>order-42</reference></transaction>');
    await expect(resolvePagbankNotification(CODE, CREDS)).rejects.toThrow(
      ProviderRequestError,
    );
  });
});
