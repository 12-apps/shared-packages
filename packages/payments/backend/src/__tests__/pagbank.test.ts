import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import { pagbankProvider } from '../providers/pagbank';
import { cardInput, pixInput } from './fixtures';

/**
 * Contract tests for the ported PagBank client. These pin the request shapes
 * that were proven against the real API in `apps/web/lib/payments/pagbank.ts`
 * — the port is only trustworthy if the wire format is identical.
 */

const LIVE = { environment: 'SANDBOX' as const, fields: { token: 'tok_live', webhookToken: 'wh' } };

function mockFetch(response: unknown, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank adapter — charges', () => {
  /**
   * The webhook destination rides in the ORDER PAYLOAD. PagBank's Orders API
   * has no dashboard-registered fallback for it, so an order sent without
   * `notification_urls` can never be notified about — which is precisely what
   * shipped: nothing populated `notificationUrl` for a tenant, so every store's
   * confirmation quietly depended on the client polling instead.
   */
  it.each(['pix', 'card'] as const)('announces the store webhook URL on a %s order', async (kind) => {
    const spy = mockFetch({
      id: 'ORDE_1',
      charges: [{ id: 'CHAR_1', status: 'PAID', payment_response: { code: '20000' } }],
      qr_codes: [{ text: 'emv', expiration_date: '2030-01-01T00:00:00Z' }],
    });

    await pagbankProvider().createCharge(kind === 'pix' ? pixInput() : cardInput(), {
      ...LIVE,
      fields: { ...LIVE.fields, notificationUrl: 'https://paladira.com/api/webhooks/pagseguro/acme/notifications' },
    });

    const sent = JSON.parse((spy.mock.calls[0]?.[1] as { body: string }).body) as {
      notification_urls?: string[];
    };
    expect(sent.notification_urls).toEqual([
      'https://paladira.com/api/webhooks/pagseguro/acme/notifications',
    ]);
  });

  it('sends the proven PIX order shape and maps the QR back', async () => {
    const spy = mockFetch({
      id: 'ORDE_1',
      charges: [{ id: 'CHAR_1' }],
      qr_codes: [{ text: '00020126-emv', expiration_date: '2030-01-01T00:00:00Z' }],
    });
    const snapshot = await pagbankProvider().createCharge(
      { ...pixInput('order-1'), idempotencyKey: 'order-1:1' },
      LIVE,
    );

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.api.pagseguro.com/orders');
    // The provider-side double-charge guard.
    expect((init.headers as Record<string, string>)['x-idempotency-key']).toBe('order-1:1');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok_live');
    const body = JSON.parse(init.body as string) as {
      reference_id: string;
      customer: { tax_id?: string };
      qr_codes: Array<{ amount: { value: number } }>;
    };
    expect(body.reference_id).toBe('order-1');
    // CPF must go as bare digits — PagBank rejects punctuation.
    expect(body.customer.tax_id).toBe('12345678909');
    expect(body.qr_codes[0]?.amount.value).toBe(12_50);

    expect(snapshot).toMatchObject({
      provider: 'pagbank',
      providerChargeId: 'CHAR_1',
      status: 'PENDING',
      pix: { qrText: '00020126-emv' },
    });
  });

  it('routes PRODUCTION credentials at the live host, sandbox by default', async () => {
    const spy = mockFetch({ id: 'O', charges: [{ id: 'C' }], qr_codes: [{ text: 'q' }] });
    await pagbankProvider().createCharge(pixInput(), {
      environment: 'PRODUCTION',
      fields: { token: 't' },
    });
    expect((spy.mock.calls[0] as [string])[0]).toBe('https://api.pagseguro.com/orders');
  });

  it('sends a fresh card as an encrypted blob and a saved card by vault id', async () => {
    const spy = mockFetch({ id: 'ORDE_2', charges: [{ id: 'CHAR_2', status: 'PAID' }] });
    const adapter = pagbankProvider();

    await adapter.createCharge(cardInput('order-2', 'ENCRYPTED_BLOB'), LIVE);
    let body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ payment_method: { card: Record<string, unknown> } }>;
    };
    expect(body.charges[0]?.payment_method.card).toEqual({
      encrypted: 'ENCRYPTED_BLOB',
      store: true,
    });

    await adapter.createCharge(
      { ...cardInput('order-3'), card: { savedCardToken: 'CARD_9' } },
      LIVE,
    );
    body = JSON.parse((spy.mock.calls[1] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ payment_method: { card: Record<string, unknown> } }>;
    };
    // A stored card must charge by id — never re-send an encrypted blob.
    expect(body.charges[0]?.payment_method.card).toEqual({ id: 'CARD_9' });
  });

  it('treats a card decline as a DECLINED snapshot, not an exception', async () => {
    mockFetch({ id: 'ORDE_3', charges: [{ id: 'CHAR_3', status: 'DECLINED' }] });
    const snapshot = await pagbankProvider().createCharge(cardInput('order-4'), LIVE);
    expect(snapshot.status).toBe('DECLINED');
    expect(snapshot.declineReason).toBe('CARD_DECLINED');
  });

  it('declares a subsequent recurring charge to the issuer (FUT-340)', async () => {
    // Without `recurring.type` the issuer sees an unauthenticated card charge
    // with no stored-credential agreement behind it, and is entitled to
    // decline for exactly that reason.
    const spy = mockFetch({ id: 'ORDE_R', charges: [{ id: 'CHAR_R', status: 'PAID' }] });
    await pagbankProvider().createCharge(
      {
        ...cardInput('sub-cycle-1'),
        card: { savedCardToken: 'CARD_9', tokenProvider: 'pagbank', merchantInitiated: true },
      },
      LIVE,
    );

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ recurring?: { type?: string }; payment_method: { card: { id?: string } } }>;
    };
    expect(body.charges[0]?.recurring).toEqual({ type: 'SUBSEQUENT' });
    expect(body.charges[0]?.payment_method.card).toEqual({ id: 'CARD_9' });
  });

  it('omits the recurring flag on an ordinary storefront charge', async () => {
    const spy = mockFetch({ id: 'ORDE_S', charges: [{ id: 'CHAR_S', status: 'PAID' }] });
    await pagbankProvider().createCharge(cardInput('order-s'), LIVE);

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ recurring?: unknown }>;
    };
    expect(body.charges[0]).not.toHaveProperty('recurring');
  });

  /**
   * The decline map (FUT-340). A subscription is charged on a timer with
   * nobody watching, so the only thing standing between "the issuer was
   * briefly down" and "stop billing this card forever" is whether these two
   * fields differ — before the map they did not, and every refusal read as a
   * plain CARD_DECLINED.
   */
  it.each([
    ['20003', 'INSUFFICIENT_FUNDS', true, 'no funds — real, and worth another cycle'],
    ['20019', 'PROVIDER_ERROR', true, 'issuer offline — the textbook backoff case'],
    ['20007', 'INVALID_CARD', false, 'bad card data — a repeat cannot fix it'],
    ['20159', 'FRAUD_SUSPECTED', false, 'needs authentication an off-session charge cannot do'],
    ['20118', 'CARD_DECLINED', false, 'the holder cancelled the recurring mandate'],
    ['10003', 'PROVIDER_ERROR', false, 'OUR request was malformed, not their card'],
  ])('maps payment_response %s to %s (retriable=%s) — %s', async (code, reason, retriable) => {
    mockFetch({
      id: 'ORDE_D',
      charges: [{ id: 'CHAR_D', status: 'DECLINED', payment_response: { code } }],
    });
    const snapshot = await pagbankProvider().createCharge(cardInput('order-d'), LIVE);

    expect(snapshot.status).toBe('DECLINED');
    expect(snapshot.declineReason).toBe(reason);
    expect(snapshot.declineRetriable).toBe(retriable);
  });

  /**
   * FUT-475: the code is only half the answer, and the other half has to
   * survive the trip through the adapter. `pagbank-declines.test.ts` owns the
   * table; what this pins is that `payment_response.raw_data` is READ at all —
   * the field existed in PagBank's payload and in nothing we parsed, so an
   * expired card reached the tenant as "check the card number".
   */
  it('tells an expired card from a mistyped one via raw_data.reason_code', async () => {
    mockFetch({
      id: 'ORDE_E',
      charges: [
        {
          id: 'CHAR_E',
          status: 'DECLINED',
          payment_response: {
            code: '20007',
            message: 'VERIFIQUE OS DADOS DO CARTAO',
            raw_data: { reason_code: '54', merchant_advice_code: '03' },
          },
        },
      ],
    });
    const snapshot = await pagbankProvider().createCharge(cardInput('order-e'), LIVE);

    expect(snapshot.declineReason).toBe('EXPIRED_CARD');
    // PagBank's own verdict for the whole 20007 block, unchanged by the row.
    expect(snapshot.declineRetriable).toBe(false);
  });

  it('calls an unknown decline code retriable rather than cancelling silently', async () => {
    // A code PagBank adds tomorrow must not stop us collecting from a tenant
    // whose card is fine. One wasted attempt, bounded by the caller's cap, is
    // the cheaper direction to be wrong in.
    mockFetch({
      id: 'ORDE_U',
      charges: [{ id: 'CHAR_U', status: 'DECLINED', payment_response: { code: '29999' } }],
    });
    const snapshot = await pagbankProvider().createCharge(cardInput('order-u'), LIVE);

    expect(snapshot.declineReason).toBe('CARD_DECLINED');
    expect(snapshot.declineRetriable).toBe(true);
  });

  it('does not report a paid charge as retriable-anything', async () => {
    mockFetch({
      id: 'ORDE_P',
      charges: [{ id: 'CHAR_P', status: 'PAID', payment_response: { code: '20000' } }],
    });
    const snapshot = await pagbankProvider().createCharge(cardInput('order-p'), LIVE);

    expect(snapshot.status).toBe('PAID');
    expect(snapshot.declineReason).toBeUndefined();
    expect(snapshot.declineRetriable).toBeUndefined();
  });

  it('surfaces an HTTP error as a ProviderRequestError', async () => {
    mockFetch({ error: 'bad token' }, 401);
    await expect(pagbankProvider().createCharge(pixInput(), LIVE)).rejects.toThrow(
      ProviderRequestError,
    );
  });

  /**
   * FUT-489: a failure has to carry BOTH halves of the exchange. PagBank
   * support asks for the request and the response; only the response was ever
   * kept, so answering meant reconstructing the payload from source and
   * labelling it a reconstruction.
   */
  describe('the failure carries the request that caused it', () => {
    async function failedCardCharge(): Promise<ProviderRequestError> {
      mockFetch({ error_messages: [{ code: '40002', description: 'x'.repeat(400) }] }, 400);
      try {
        await pagbankProvider().createCharge(cardInput('order-f'), LIVE);
      } catch (error) {
        return error as ProviderRequestError;
      }
      throw new Error('the charge was expected to fail');
    }

    it('captures the method, url and body it sent', async () => {
      const request = (await failedCardCharge()).options.request;

      expect(request?.method).toBe('POST');
      expect(request?.url).toBe('https://sandbox.api.pagseguro.com/orders');
      expect(request?.body).toMatchObject({ reference_id: 'order-f' });
    });

    it('redacts the card and never reads the token at all', async () => {
      const request = (await failedCardCharge()).options.request;
      const serialized = JSON.stringify(request);

      // The encrypted PAN blob is enough to charge with. So is a vault id.
      expect(serialized).not.toContain('tok_ok');
      expect(serialized).not.toContain('tok_live');
      expect(request?.headers['Authorization']).toBe('Bearer ***REDACTED***');
      const charges = (request?.body as { charges: Array<{ payment_method: { card: unknown } }> })
        .charges;
      // Redacted IN PLACE: the pair must still show the field was sent.
      expect(charges[0]?.payment_method.card).toEqual({
        encrypted: '***REDACTED***',
        store: true,
      });
    });

    it('keeps the response untruncated, unlike the message', async () => {
      const error = await failedCardCharge();

      // The 300-char cap on the message is what made an HTTP 502 undiagnosable.
      expect(error.message.length).toBeLessThan(400);
      const body = error.options.body as { error_messages: Array<{ description: string }> };
      expect(body.error_messages[0]?.description).toHaveLength(400);
    });
  });

  it('never retries a charge on an HTTP response (no double charge)', async () => {
    const spy = mockFetch({ error: 'boom' }, 500);
    await expect(pagbankProvider().createCharge(pixInput(), LIVE)).rejects.toThrow();
    // One POST only: retrying a request that REACHED PagBank could charge twice.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/**
 * FUT-488. The ticket said `customer.phones` is "documented required"; it is
 * not — `reference/criar-pedido` lists only `customer.tax_id` in the object's
 * `required`. What the schema DOES require is conditional: the phones item
 * requires `["country","area","number"]`, so a half-filled entry is worse than
 * none. These pin both halves of that.
 */
describe('pagbank adapter — customer.phones', () => {
  /** The `customer` block as it went over the wire. */
  async function sentCustomer(phone?: string) {
    const spy = mockFetch({ id: 'ORDE_1', charges: [{ id: 'CHAR_1' }], qr_codes: [{ text: 'emv' }] });
    const input = pixInput();
    await pagbankProvider().createCharge(
      { ...input, customer: { ...input.customer, phone } },
      LIVE,
    );
    const body = JSON.parse((spy.mock.calls[0]?.[1] as { body: string }).body) as {
      customer: { phones?: Array<{ country: string; area: string; number: string }> };
    };
    return body.customer;
  }

  it('splits a typed Brazilian mobile into country/area/number', async () => {
    // The shape a checkout form actually produces, punctuation and all.
    expect((await sentCustomer('(11) 98888-7777')).phones).toEqual([
      { country: '55', area: '11', number: '988887777' },
    ]);
  });

  it('accepts an already-prefixed number without eating the DDD', async () => {
    // DDD 55 is Santa Maria/RS — a naive "strip a leading 55" loses it.
    expect((await sentCustomer('+55 (55) 99999-8888')).phones).toEqual([
      { country: '55', area: '55', number: '999998888' },
    ]);
    // ...and the same digits WITHOUT a country code are a DDD-55 number.
    expect((await sentCustomer('55999998888')).phones).toEqual([
      { country: '55', area: '55', number: '999998888' },
    ]);
  });

  it('sends an 8-digit landline as readily as a 9-digit mobile', async () => {
    expect((await sentCustomer('(31) 3222-1100')).phones).toEqual([
      { country: '55', area: '31', number: '32221100' },
    ]);
  });

  it('omits phones entirely rather than sending a partial entry', async () => {
    // All three sub-fields are required together, so anything unsplittable
    // must produce no array at all — never `{area, number}` without a country.
    for (const unusable of [undefined, '', '   ', '12345', '+1 415 555 0100', '5511988887777123']) {
      expect((await sentCustomer(unusable)).phones).toBeUndefined();
    }
  });

  it('still sends the fields that were already proven', async () => {
    // The customer block was factored into one builder; nothing may regress.
    const customer = await sentCustomer('11988887777');
    expect(customer).toMatchObject({
      name: 'Ana Buyer',
      email: 'ana@example.com',
      tax_id: '12345678909',
    });
  });
});

describe('pagbank adapter — order snapshots', () => {
  const CREDS = { environment: 'SANDBOX' as const, fields: { token: 'tok' } };

  it('reports the amount PagBank captured, not a fabricated one', async () => {
    mockFetch({ id: 'ORDE_9', charges: [{ id: 'CHAR_9', status: 'PAID', amount: { value: 1234 } }] });
    const snapshot = await pagbankProvider().getCharge('ORDE_9', CREDS);
    expect(snapshot).toMatchObject({ status: 'PAID', amount: { amountCents: 1234 } });
  });

  it('REFUSES a PAID charge with no amount instead of normalizing it to zero', async () => {
    // Zero is not "we captured nothing", it is "we do not know" — and settling
    // an order for an amount nobody reported is the worst available outcome.
    // Throwing makes the poll retry and the webhook delivery replay.
    mockFetch({ id: 'ORDE_10', charges: [{ id: 'CHAR_10', status: 'PAID' }] });
    await expect(pagbankProvider().getCharge('ORDE_10', CREDS)).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('still answers PENDING for an unpaid PIX order with no charges at all', async () => {
    // The refusal above must NOT fire here: a PIX order nobody has paid yet
    // carries no charge (and so no amount) on every single status poll, and
    // throwing would break both the buyer's screen and the reconciliation walk.
    mockFetch({ id: 'ORDE_11', qr_codes: [{ text: '00020126-emv' }] });
    const snapshot = await pagbankProvider().getCharge('ORDE_11', CREDS);
    expect(snapshot).toMatchObject({
      status: 'PENDING',
      providerChargeId: 'ORDE_11',
      amount: { amountCents: 0 },
    });
  });

  it('rejects a webhook delivery whose PAID charge carries no amount', async () => {
    const missing = JSON.stringify({ id: 'ORDE_12', charges: [{ id: 'CHAR_12', status: 'PAID' }] });
    await expect(
      pagbankProvider().webhook.parse(
        { provider: 'pagbank', rawBody: missing, headers: {} },
        LIVE,
      ),
    ).rejects.toThrow(ProviderRequestError);
  });
});

describe('pagbank adapter — webhooks', () => {
  // A real PagBank PAID charge always carries an amount; a fixture without one
  // is now (correctly) refused, so the fixture gains the field rather than the
  // guard being weakened.
  const body = JSON.stringify({
    id: 'ORDE_5',
    charges: [{ id: 'CHAR_5', status: 'PAID', amount: { value: 12_50 } }],
  });
  const token = 'wh_secret';
  const signature = createHash('sha256').update(`${token}-${body}`).digest('hex');

  it('accepts a delivery signed with SHA-256(token-body)', async () => {
    const ok = await pagbankProvider().webhook.verify(
      { provider: 'pagbank', rawBody: body, headers: { 'x-authenticity-token': signature } },
      { environment: 'PRODUCTION', fields: { webhookToken: token } },
    );
    expect(ok).toBe(true);
  });

  it('rejects a tampered body, a wrong token, and a missing header', async () => {
    const adapter = pagbankProvider();
    const creds = { environment: 'PRODUCTION' as const, fields: { webhookToken: token } };
    await expect(
      adapter.webhook.verify(
        { provider: 'pagbank', rawBody: `${body} `, headers: { 'x-authenticity-token': signature } },
        creds,
      ),
    ).resolves.toBe(false);
    await expect(
      adapter.webhook.verify(
        { provider: 'pagbank', rawBody: body, headers: { 'x-authenticity-token': 'nope' } },
        creds,
      ),
    ).resolves.toBe(false);
    await expect(
      adapter.webhook.verify({ provider: 'pagbank', rawBody: body, headers: {} }, creds),
    ).resolves.toBe(false);
  });

  it('fails closed in live mode when no webhook token is configured', async () => {
    await expect(
      pagbankProvider().webhook.verify(
        { provider: 'pagbank', rawBody: body, headers: { 'x-authenticity-token': signature } },
        { environment: 'PRODUCTION', fields: {} },
      ),
    ).resolves.toBe(false);
  });

  it('parses the order payload into a PAID charge event', async () => {
    const [event] = await pagbankProvider().webhook.parse(
      { provider: 'pagbank', rawBody: body, headers: {} },
      LIVE,
    );
    expect(event).toMatchObject({
      provider: 'pagbank',
      type: 'CHARGE_UPDATED',
      charge: { providerChargeId: 'CHAR_5', status: 'PAID' },
    });
    // No delivery id from PagBank → body hash keeps redeliveries idempotent.
    expect(event?.eventId).toHaveLength(64);
  });

  /**
   * FUT-477. `reference/webhooks` sends post-transaction events (chargebacks,
   * cancelamentos, disponibilização de saldo) to the SAME URL in a different,
   * form-encoded format. `JSON.parse` throws on it, so the pipeline marked the
   * row FAILED and PagBank redelivered a body a retry could never fix.
   */
  describe('post-transaction events', () => {
    const POSTED = 'notificationCode=093C100E7FA87FA8C0B664B79F8359773B96&notificationType=transaction';

    async function parse(rawBody: string) {
      return pagbankProvider().webhook.parse({ provider: 'pagbank', rawBody, headers: {} }, LIVE);
    }

    it('parses the form-encoded delivery instead of throwing on it', async () => {
      const [event] = await parse(POSTED);

      expect(event).toMatchObject({
        provider: 'pagbank',
        // UNKNOWN on purpose: the body says something happened to a
        // transaction and never what, so CHARGE_UPDATED would invent a state
        // — and on this provider that state settles money.
        type: 'UNKNOWN',
        raw: {
          notificationCode: '093C100E7FA87FA8C0B664B79F8359773B96',
          notificationType: 'transaction',
        },
      });
      // The code is the only thing that makes the event resolvable later, so
      // it has to survive onto the inbox row.
      expect(event?.charge).toBeUndefined();
      expect(event?.eventId).toHaveLength(64);
    });

    it('reports a missing notificationType as null rather than guessing', async () => {
      const [event] = await parse('notificationCode=ABC123');
      expect(event?.raw).toEqual({ notificationCode: 'ABC123', notificationType: null });
    });

    it('still routes an ordinary JSON order body down the order path', async () => {
      // A JSON body parses as a query string without complaint, so the two
      // formats must be told apart by shape, not by parse success.
      const [event] = await parse(body);
      expect(event?.type).toBe('CHARGE_UPDATED');
    });

    it('leaves a body that is neither format on the existing failure path', async () => {
      // Deliberately unchanged: only the DOCUMENTED second format is claimed
      // here. Inventing a policy for arbitrary junk is a separate decision.
      await expect(parse('<?xml version="1.0"?><transaction/>')).rejects.toThrow();
    });
  });
});
