import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import { createMemoryChargeStore } from '../memory';
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
    // Each kind gets its REAL response shape: an unpaid PIX order carries no
    // charges[] (PagBank mints the charge only when the buyer pays), a card
    // order settles synchronously and does.
    const spy = mockFetch(
      kind === 'pix'
        ? { id: 'ORDE_1', qr_codes: [{ text: 'emv', expiration_date: '2030-01-01T00:00:00Z' }] }
        : {
            id: 'ORDE_1',
            charges: [{ id: 'CHAR_1', status: 'PAID', payment_response: { code: '20000' } }],
          },
    );

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
    // The REAL create response for an unpaid PIX: no charges[] — the charge
    // does not exist until the buyer pays (FUT-681). The old fixture invented
    // a CHAR_1 entry, which is exactly what hid the identity bug.
    const spy = mockFetch({
      id: 'ORDE_1',
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
      // The order id is the only identity an unpaid PIX has; the hint labels
      // it as an ORDER id so later reads can re-key the row (FUT-681).
      providerChargeId: 'ORDE_1',
      reference: 'order-1',
      status: 'PENDING',
      pix: { qrText: '00020126-emv' },
      settlementHints: { orderId: 'ORDE_1' },
    });
  });

  it('routes PRODUCTION credentials at the live host, sandbox by default', async () => {
    const spy = mockFetch({ id: 'O', qr_codes: [{ text: 'q' }] });
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

  /**
   * FUT-471 — the wallet branch of the card charge, per PagBank's "Pagando com
   * Google Pay" guide: `payment_method.card` becomes `{ wallet: { type, key }}`,
   * both fields mandatory, `key` being the token Google handed the browser
   * (`paymentData.paymentMethodData.tokenizationData.token`) verbatim.
   */
  it('sends a Google Pay charge as payment_method.card.wallet (FUT-471)', async () => {
    const spy = mockFetch({ id: 'ORDE_W', charges: [{ id: 'CHAR_W', status: 'PAID' }] });
    await pagbankProvider().createCharge(
      { ...cardInput('order-w'), card: { wallet: { type: 'GOOGLE_PAY', key: 'gp_tok_123' } } },
      LIVE,
    );

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ payment_method: Record<string, unknown> }>;
    };
    expect(body.charges[0]?.payment_method).toEqual({
      type: 'CREDIT_CARD',
      installments: 1,
      capture: true,
      card: { wallet: { type: 'GOOGLE_PAY', key: 'gp_tok_123' } },
    });
  });

  it('a wallet wins over any other instrument — one instrument per charge', async () => {
    // A body carrying both a wallet key and a vault id must not send two
    // instruments; the wallet is the one the buyer just authorized.
    const spy = mockFetch({ id: 'ORDE_W2', charges: [{ id: 'CHAR_W2', status: 'PAID' }] });
    await pagbankProvider().createCharge(
      {
        ...cardInput('order-w2'),
        card: {
          wallet: { type: 'GOOGLE_PAY', key: 'gp_tok' },
          savedCardToken: 'CARD_9',
          token: 'ENCRYPTED_BLOB',
        },
      },
      LIVE,
    );

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ payment_method: { card: Record<string, unknown> } }>;
    };
    expect(body.charges[0]?.payment_method.card).toEqual({
      wallet: { type: 'GOOGLE_PAY', key: 'gp_tok' },
    });
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
    const spy = mockFetch({ id: 'ORDE_1', qr_codes: [{ text: 'emv' }] });
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

  it('fails closed in live mode when no secret of any kind is configured', async () => {
    await expect(
      pagbankProvider().webhook.verify(
        { provider: 'pagbank', rawBody: body, headers: { 'x-authenticity-token': signature } },
        { environment: 'PRODUCTION', fields: {} },
      ),
    ).resolves.toBe(false);
  });

  /**
   * FUT-678 — the signing secret under Connect. PagBank documents the
   * signature as SHA-256 of `{account token}-{payload}`, so the API token is
   * the DEFAULT secret; `webhookToken` is only the platform's explicit
   * override. Requiring `webhookToken` alone rejected every delivery of every
   * OAuth-connected store BEFORE the durable inbox whenever the env-var copy
   * was absent.
   */
  describe('the signing secret under Connect (FUT-678)', () => {
    it('accepts a delivery signed with the account token when no webhook token is set', async () => {
      const accountToken = 'acct_tok';
      const signed = createHash('sha256').update(`${accountToken}-${body}`).digest('hex');
      await expect(
        pagbankProvider().webhook.verify(
          { provider: 'pagbank', rawBody: body, headers: { 'x-authenticity-token': signed } },
          { environment: 'PRODUCTION', fields: { token: accountToken } },
        ),
      ).resolves.toBe(true);
    });

    it('keeps an explicitly configured webhook token authoritative', async () => {
      const creds = {
        environment: 'PRODUCTION' as const,
        fields: { token: 'acct_tok', webhookToken: 'dedicated' },
      };
      const signedWithDedicated = createHash('sha256').update(`dedicated-${body}`).digest('hex');
      const signedWithAccount = createHash('sha256').update(`acct_tok-${body}`).digest('hex');

      await expect(
        pagbankProvider().webhook.verify(
          {
            provider: 'pagbank',
            rawBody: body,
            headers: { 'x-authenticity-token': signedWithDedicated },
          },
          creds,
        ),
      ).resolves.toBe(true);
      // The override REPLACES the default rather than widening it: two live
      // secrets at once is a bigger surface than the configuration asked for.
      await expect(
        pagbankProvider().webhook.verify(
          {
            provider: 'pagbank',
            rawBody: body,
            headers: { 'x-authenticity-token': signedWithAccount },
          },
          creds,
        ),
      ).resolves.toBe(false);
    });

    it('verifies a legacy form-encoded notification body the same way', async () => {
      // The FUT-477 post-transaction shape rides the same URL and the same
      // `x-authenticity-token` scheme; this pins that the verify layer does
      // not reopen the redelivery loop one step above the parse fix.
      const legacyBody =
        'notificationCode=093C100E7FA87FA8C0B664B79F8359773B96&notificationType=transaction';
      const signed = createHash('sha256').update(`acct_tok-${legacyBody}`).digest('hex');
      await expect(
        pagbankProvider().webhook.verify(
          {
            provider: 'pagbank',
            rawBody: legacyBody,
            headers: { 'x-authenticity-token': signed },
          },
          { environment: 'PRODUCTION', fields: { token: 'acct_tok' } },
        ),
      ).resolves.toBe(true);
    });
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

/**
 * FUT-681 — one charge identity across create, webhook, poll and refund.
 *
 * PIX create used to record the ORDER id as `providerChargeId` (an unpaid PIX
 * has no charge), the paid webhook then presented the CHARGE id, and the two
 * never met: `upsertByProviderChargeId` updated nothing, `payment_charges`
 * stayed PENDING, and only the reference rescue settled the order.
 */
describe('pagbank adapter — charge identity (FUT-681)', () => {
  const CREDS = { environment: 'SANDBOX' as const, fields: { token: 'tok' } };

  /** Stub `fetch` with a QUEUE of responses (the last one repeats). */
  function mockFetchQueue(responses: unknown[]) {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([String(url), init]);
        const body = responses[Math.min(calls.length - 1, responses.length - 1)];
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

  it('Given a PIX order, When the paid webhook arrives, Then the charge row reflects PAID', async () => {
    const store = createMemoryChargeStore();
    const merchant = { kind: 'TENANT', id: 'acme' } as const;
    // The row PIX create writes: keyed by the ORDER id, labeled as such.
    mockFetch({ id: 'ORDE_7', qr_codes: [{ text: 'emv' }] });
    const created = await pagbankProvider().createCharge(pixInput('order-7'), LIVE);
    await store.create({ merchant, reference: 'order-7', snapshot: created });

    // The paid webhook names the charge PagBank minted at payment time.
    const [event] = await pagbankProvider().webhook.parse(
      {
        provider: 'pagbank',
        rawBody: JSON.stringify({
          id: 'ORDE_7',
          reference_id: 'order-7',
          charges: [{ id: 'CHAR_7', status: 'PAID', amount: { value: 12_50 } }],
        }),
        headers: {},
      },
      LIVE,
    );
    const updated = await store.upsertByProviderChargeId(merchant, event!.charge!);

    // The row itself moved — not merely the order via the reference rescue.
    expect(updated).not.toBeNull();
    expect(updated?.snapshot.status).toBe('PAID');
    // ...and it is RE-KEYED to the charge id every later caller will present.
    expect(updated?.providerChargeId).toBe('CHAR_7');
    await expect(store.findByProviderChargeId('pagbank', 'CHAR_7')).resolves.toBe(updated);
  });

  describe('getCharge works for card and PIX', () => {
    it('polls /orders/{orderId} for a card charge via the order hint', async () => {
      const spy = mockFetch({
        id: 'ORDE_2',
        charges: [{ id: 'CHAR_2', status: 'PAID', amount: { value: 99_90 } }],
      });
      const snapshot = await pagbankProvider().getCharge('CHAR_2', CREDS, { orderId: 'ORDE_2' });
      expect((spy.mock.calls[0] as [string])[0]).toBe(
        'https://sandbox.api.pagseguro.com/orders/ORDE_2',
      );
      expect(snapshot).toMatchObject({ providerChargeId: 'CHAR_2', status: 'PAID' });
    });

    it('polls /charges/{id} for a card row stored before the hint existed', async () => {
      // `/orders/{CHAR_…}` is the 404 the ticket names; the charge endpoint is
      // the read that answers for a bare charge id.
      const spy = mockFetch({
        id: 'CHAR_3',
        reference_id: 'order-3',
        status: 'PAID',
        amount: { value: 99_90 },
      });
      const snapshot = await pagbankProvider().getCharge('CHAR_3', CREDS);
      expect((spy.mock.calls[0] as [string])[0]).toBe(
        'https://sandbox.api.pagseguro.com/charges/CHAR_3',
      );
      expect(snapshot).toMatchObject({
        providerChargeId: 'CHAR_3',
        reference: 'order-3',
        status: 'PAID',
        amount: { amountCents: 99_90 },
      });
    });

    it('polls /orders/{id} for a PIX row keyed by its order id', async () => {
      const spy = mockFetch({ id: 'ORDE_4', qr_codes: [{ text: 'emv' }] });
      const snapshot = await pagbankProvider().getCharge('ORDE_4', CREDS);
      expect((spy.mock.calls[0] as [string])[0]).toBe(
        'https://sandbox.api.pagseguro.com/orders/ORDE_4',
      );
      expect(snapshot.status).toBe('PENDING');
    });
  });

  describe('refund works for a charge created as PIX', () => {
    it('resolves the order to its paid charge before cancelling', async () => {
      const calls = mockFetchQueue([
        { id: 'ORDE_5', charges: [{ id: 'CHAR_5', status: 'PAID', amount: { value: 12_50 } }] },
        { id: 'CHAR_5', status: 'CANCELED' },
      ]);
      const refund = await pagbankProvider().refund!({ providerChargeId: 'ORDE_5' }, CREDS);

      expect(calls[0]![0]).toBe('https://sandbox.api.pagseguro.com/orders/ORDE_5');
      expect(calls[1]![0]).toBe('https://sandbox.api.pagseguro.com/charges/CHAR_5/cancel');
      expect(refund.providerRefundId).toBe('CHAR_5');
    });

    it('cancels a charge id directly, with no order read', async () => {
      const calls = mockFetchQueue([{ id: 'CHAR_6', status: 'CANCELED' }]);
      await pagbankProvider().refund!({ providerChargeId: 'CHAR_6' }, CREDS);
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toBe('https://sandbox.api.pagseguro.com/charges/CHAR_6/cancel');
    });

    it('refuses to refund an order nobody paid instead of 404-ing blind', async () => {
      mockFetch({ id: 'ORDE_6', qr_codes: [{ text: 'emv' }] });
      await expect(
        pagbankProvider().refund!({ providerChargeId: 'ORDE_6' }, CREDS),
      ).rejects.toThrow(ProviderRequestError);
    });
  });

  describe('When PagBank expires a PIX, the charge stops reading as waiting', () => {
    it('answers EXPIRED once every QR is past its deadline plus the grace', async () => {
      mockFetch({
        id: 'ORDE_8',
        qr_codes: [{ text: 'emv', expiration_date: '2020-01-01T00:00:00Z' }],
      });
      const snapshot = await pagbankProvider().getCharge('ORDE_8', CREDS);
      expect(snapshot.status).toBe('EXPIRED');
    });

    it('stays PENDING inside the grace window, where a straggler can still settle', async () => {
      // EXPIRED and PAID are contradictory outcomes the status ranks refuse to
      // reorder, so the mapping must not call the race for the buyer's bank.
      // Fixed clock: the QR expired one minute "ago" — inside the grace.
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T12:01:00Z'));
      mockFetch({
        id: 'ORDE_8',
        qr_codes: [{ text: 'emv', expiration_date: '2030-01-01T12:00:00Z' }],
      });
      const snapshot = await pagbankProvider().getCharge('ORDE_8', CREDS);
      now.mockRestore();
      expect(snapshot.status).toBe('PENDING');
    });
  });

  describe('canceled and refunded charges stop collapsing into PENDING', () => {
    async function polledStatus(charge: Record<string, unknown>) {
      mockFetch({ id: 'ORDE_9', charges: [charge] });
      return (await pagbankProvider().getCharge('ORDE_9', CREDS)).status;
    }

    it('maps a voided charge to CANCELED and a refunded one to REFUNDED', async () => {
      expect(await polledStatus({ id: 'CHAR_9', status: 'CANCELED' })).toBe('CANCELED');
      // PagBank answers CANCELED for a refund too; the refunded summary is
      // what tells money-went-back from voided-before-payment.
      expect(
        await polledStatus({
          id: 'CHAR_9',
          status: 'CANCELED',
          amount: { value: 12_50, summary: { refunded: 12_50 } },
        }),
      ).toBe('REFUNDED');
      expect(await polledStatus({ id: 'CHAR_9', status: 'DECLINED' })).toBe('DECLINED');
    });

    it('emits REFUND_UPDATED alongside the charge event when money went back', async () => {
      const rawBody = JSON.stringify({
        id: 'ORDE_10',
        reference_id: 'order-10',
        charges: [
          {
            id: 'CHAR_10',
            status: 'CANCELED',
            amount: { value: 12_50, summary: { refunded: 12_50 } },
          },
        ],
      });
      const events = await pagbankProvider().webhook.parse(
        { provider: 'pagbank', rawBody, headers: {} },
        LIVE,
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'CHARGE_UPDATED',
        charge: { providerChargeId: 'CHAR_10', status: 'REFUNDED' },
      });
      expect(events[1]).toMatchObject({
        type: 'REFUND_UPDATED',
        refund: {
          providerChargeId: 'CHAR_10',
          status: 'REFUNDED',
          amount: { amountCents: 12_50, currency: 'BRL' },
        },
      });
      // Its own dedup key: the inbox records one row per event.
      expect(events[1]!.eventId).not.toBe(events[0]!.eventId);
    });

    it('emits no refund event for a plain cancel where no money moved', async () => {
      const rawBody = JSON.stringify({
        id: 'ORDE_11',
        charges: [{ id: 'CHAR_11', status: 'CANCELED' }],
      });
      const events = await pagbankProvider().webhook.parse(
        { provider: 'pagbank', rawBody, headers: {} },
        LIVE,
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.charge?.status).toBe('CANCELED');
    });
  });
});

describe('pagbank adapter — wallet capability and client config (FUT-471)', () => {
  it('declares the Google Pay wallet in its capability table', () => {
    // The single source the gateway's skip and the checkout's button gate on.
    expect(pagbankProvider().capabilities.wallets).toContain('GOOGLE_PAY');
  });

  it('publishes the PAYMENT_GATEWAY parameters when the connection carries a merchant id', () => {
    const config = pagbankProvider().clientConfig({
      environment: 'SANDBOX',
      fields: { token: 't', googlePayMerchantId: 'MID_123' },
    });
    // `gateway` is PagBank's id in Google's processor registry — a provider
    // fact, spelled by the adapter so no frontend hardcodes a vendor name.
    expect(config.googlePay).toEqual({ gateway: 'pagbank', gatewayMerchantId: 'MID_123' });
  });

  it('publishes a null merchant id for a connection that has none', () => {
    // The button must not render for this store: a token minted against a
    // missing gatewayMerchantId charges nobody. Blank normalizes to null too.
    const config = pagbankProvider().clientConfig({
      environment: 'SANDBOX',
      fields: { token: 't', googlePayMerchantId: '' },
    });
    expect(config.googlePay).toEqual({ gateway: 'pagbank', gatewayMerchantId: null });
  });
});
