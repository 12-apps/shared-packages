import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import type { ResolvedCredentials } from '../core/types';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { cardInput, pixInput } from './fixtures';
import { PT_BR_INFINITEPAY_COPY, PT_BR_PAGBANK_COPY, PT_BR_STONE_COPY, PT_BR_STRIPE_COPY } from '../providers/pt-BR';

/**
 * Live-mode adapter tests: the request each provider actually builds and the
 * snapshot it makes of the response. `fetch` is stubbed, so these assert the
 * MAPPING — the part that silently pays the wrong person when it is wrong.
 */

interface StubbedCall {
  url: string;
  init: RequestInit;
}

/** Stub `fetch` with a queue of responses and record what was sent. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>): StubbedCall[] {
  const calls: StubbedCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    // `calls` is the call counter: the n-th call takes the n-th queued
    // response and the last one repeats, so a test queues only the responses
    // it actually asserts on.
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    const status = next?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => JSON.stringify(next?.body ?? {}),
      // PagBank keeps its own transport, which reads `json()` rather than the
      // shared `text()` path — the stub has to answer both.
      json: async () => next?.body ?? {},
    } as unknown as Response;
  });
  return calls;
}

/** Decode a form-encoded body into a flat map, for asserting on payloads. */
function formOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
}

function jsonOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
}

const LIVE: ResolvedCredentials = {
  environment: 'PRODUCTION',
  fields: { secretKey: 'sk_live_x', publicKey: 'pk_live_x' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stripe live mode', () => {
  const creds: ResolvedCredentials = {
    environment: 'PRODUCTION',
    fields: { accessToken: 'sk_acct_1', publishableKey: 'pk_1' },
  };

  it('creates a confirmed PIX intent and maps the QR payload out of next_action', async () => {
    const calls = stubFetch([
      {
        body: {
          id: 'pi_1',
          status: 'requires_action',
          amount: 12_50,
          currency: 'brl',
          payment_method_types: ['pix'],
          next_action: {
            pix_display_qr_code: {
              data: '00020126-pix',
              image_url_png: 'https://img.example/qr.png',
              expires_at: 1_700_000_000,
            },
          },
        },
      },
    ]);

    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).createCharge(pixInput(), creds);

    const body = formOf(calls[0]!.init);
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(body['amount']).toBe('1250');
    expect(body['currency']).toBe('brl');
    expect(body['payment_method_types[0]']).toBe('pix');
    expect(body['confirm']).toBe('true');
    // The host reference must reach Stripe, or reconciliation has no key.
    expect(body['metadata[reference]']).toBe('order-1');
    expect(snapshot).toMatchObject({ status: 'PENDING', method: 'PIX', providerChargeId: 'pi_1' });
    expect(snapshot.pix?.qrText).toBe('00020126-pix');
  });

  it('authenticates as the OAuth access token, with no Stripe-Account header', async () => {
    const calls = stubFetch([{ body: { id: 'pi_2', status: 'succeeded' } }]);
    await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), creds);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk_acct_1');
    expect(headers['Stripe-Account']).toBeUndefined();
  });

  it('sends Stripe-Account when a platform key charges a connected account', async () => {
    const calls = stubFetch([{ body: { id: 'pi_3', status: 'succeeded' } }]);
    await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), {
      environment: 'PRODUCTION',
      fields: { secretKey: 'sk_platform', connectedAccountId: 'acct_9' },
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk_platform');
    expect(headers['Stripe-Account']).toBe('acct_9');
  });

  it('forwards the idempotency key so a retried create cannot double-charge', async () => {
    const calls = stubFetch([{ body: { id: 'pi_4', status: 'succeeded' } }]);
    await stripeProvider(PT_BR_STRIPE_COPY).createCharge({ ...cardInput(), idempotencyKey: 'order-2:1' }, creds);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('order-2:1');
  });

  it('turns a 402 decline into a DECLINED snapshot, not an exception', async () => {
    stubFetch([
      {
        status: 402,
        body: {
          error: {
            code: 'card_declined',
            decline_code: 'insufficient_funds',
            payment_intent: { id: 'pi_5', status: 'requires_payment_method' },
          },
        },
      },
    ]);

    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), creds);
    expect(snapshot.status).toBe('DECLINED');
    expect(snapshot.declineReason).toBe('INSUFFICIENT_FUNDS');
    expect(snapshot.providerChargeId).toBe('pi_5');
  });

  /**
   * Off-session collection (FUT-340). A subscription cycle is charged with
   * nobody at the keyboard, and Stripe treats that as a different transaction
   * from a checkout: a vaulted `pm_` is refused unless its customer is named,
   * and without `off_session` the intent can park at `requires_action`
   * awaiting an authentication a cron job cannot supply.
   */
  it('names the customer and flags off-session for a vaulted card', async () => {
    const calls = stubFetch([{ body: { id: 'pi_off', status: 'succeeded' } }]);

    await stripeProvider(PT_BR_STRIPE_COPY).createCharge(
      {
        ...cardInput('sub-cycle-1'),
        card: {
          savedCardToken: 'pm_saved',
          customerRef: 'cus_tenant',
          tokenProvider: 'stripe',
          merchantInitiated: true,
        },
      },
      creds,
    );

    const body = formOf(calls[0]!.init);
    expect(body['payment_method']).toBe('pm_saved');
    expect(body['customer']).toBe('cus_tenant');
    expect(body['off_session']).toBe('true');
    expect(body['confirm']).toBe('true');
  });

  it('sends neither customer nor off_session for an ordinary checkout', async () => {
    // A storefront charge has a buyer present and no stored-credential
    // agreement; claiming one would misdeclare the transaction to the issuer.
    const calls = stubFetch([{ body: { id: 'pi_on', status: 'succeeded' } }]);

    await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), creds);

    const body = formOf(calls[0]!.init);
    expect(body['customer']).toBeUndefined();
    expect(body['off_session']).toBeUndefined();
  });

  /**
   * 3-D Secure (FUT-698). Confirmed server-side with no `return_url`, an
   * intent that needs authentication parks at `requires_action` with a
   * `use_stripe_sdk` action nothing in the host can drive — the buyer polls a
   * PENDING order forever. The `redirectUrl` the host already stamps on
   * tenant credentials (`withMerchantRedirectUrl`, FUT-556) is where the
   * issuer page must send the buyer back.
   */
  it('confirms a card with the merchant return_url so 3DS can redirect', async () => {
    const calls = stubFetch([{ body: { id: 'pi_3ds', status: 'succeeded' } }]);

    await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), {
      ...creds,
      fields: { ...creds.fields, redirectUrl: 'https://host/acme/menu/checkout' },
    });

    const body = formOf(calls[0]!.init);
    expect(body['return_url']).toBe('https://host/acme/menu/checkout');
  });

  it('omits return_url for an off-session charge — nobody is there to redirect', async () => {
    const calls = stubFetch([{ body: { id: 'pi_off2', status: 'succeeded' } }]);

    await stripeProvider(PT_BR_STRIPE_COPY).createCharge(
      {
        ...cardInput('sub-cycle-2'),
        card: { savedCardToken: 'pm_saved', customerRef: 'cus_1', merchantInitiated: true },
      },
      { ...creds, fields: { ...creds.fields, redirectUrl: 'https://host/acme/menu/checkout' } },
    );

    expect(formOf(calls[0]!.init)['return_url']).toBeUndefined();
  });

  it('maps a 3DS challenge to a PENDING snapshot carrying the challenge page', async () => {
    // Given a Stripe store, when the buyer pays with a card that exige 3DS,
    // the create answers `requires_action` + `redirect_to_url` — the same
    // hosted-checkout shape as far as the host is concerned, so the checkout
    // hands the buyer over and the webhook/poll settles the order.
    stubFetch([
      {
        body: {
          id: 'pi_challenge',
          status: 'requires_action',
          amount: 12_50,
          currency: 'brl',
          payment_method_types: ['card'],
          next_action: { redirect_to_url: { url: 'https://hooks.stripe.com/3ds/x' } },
        },
      },
    ]);

    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), creds);

    expect(snapshot).toMatchObject({ status: 'PENDING', method: 'CARD' });
    expect(snapshot.hostedCheckoutUrl).toBe('https://hooks.stripe.com/3ds/x');
  });

  /**
   * Card VAULTING (FUT-340) — a SetupIntent, not a zero-amount charge.
   * Stripe models "authorise this card for future use" as its own object, and
   * it is the only flow that records the stored-credential agreement a later
   * `off_session` charge relies on.
   */
  it('reuses the tenant customer and opens an off-session SetupIntent', async () => {
    const calls = stubFetch([{ body: { id: 'seti_1', client_secret: 'seti_1_secret' } }]);

    const session = await stripeProvider(PT_BR_STRIPE_COPY).vault!.begin(
      {
        reference: 'sub-1',
        customer: { name: 'Bar do Ze', email: 'dono@bar.com' },
        customerRef: 'cus_existing',
      },
      creds,
    );

    // No customer was created: a second `cus_` per tenant would scatter their
    // instruments so "replace my card" could leave the old one chargeable.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/setup_intents');
    const body = formOf(calls[0]!.init);
    expect(body['customer']).toBe('cus_existing');
    expect(body['usage']).toBe('off_session');
    expect(body['payment_method_types[0]']).toBe('card');

    expect(session).toMatchObject({
      provider: 'stripe',
      tokenization: 'SDK',
      customerRef: 'cus_existing',
      clientSecret: 'seti_1_secret',
      sessionId: 'seti_1',
      publicKey: 'pk_1',
    });
  });

  it('creates the customer when the tenant has none yet', async () => {
    const calls = stubFetch([
      { body: { id: 'cus_new' } },
      { body: { id: 'seti_2', client_secret: 'sec' } },
    ]);

    const session = await stripeProvider(PT_BR_STRIPE_COPY).vault!.begin(
      { reference: 'sub-2', customer: { name: 'Loja', email: 'l@x.com' } },
      creds,
    );

    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/customers');
    expect(formOf(calls[0]!.init)['metadata[reference]']).toBe('sub-2');
    expect(formOf(calls[1]!.init)['customer']).toBe('cus_new');
    expect(session.customerRef).toBe('cus_new');
  });

  it('returns the attached instrument and its display metadata', async () => {
    const calls = stubFetch([
      {
        body: {
          id: 'seti_3',
          status: 'succeeded',
          customer: 'cus_1',
          metadata: { reference: 'sub-1' },
          payment_method: {
            id: 'pm_9',
            card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
          },
        },
      },
    ]);

    const vaulted = await stripeProvider(PT_BR_STRIPE_COPY).vault!.complete(
      { sessionId: 'seti_3', reference: 'sub-1', customerRef: 'cus_1' },
      creds,
    );

    // Expanded, or `payment_method` returns as a bare id and the brand/last4
    // would need a second round trip before the tenant could be shown a card.
    expect(calls[0]!.url).toContain('expand');
    expect(vaulted).toEqual({
      provider: 'stripe',
      customerRef: 'cus_1',
      instrumentId: 'pm_9',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
  });

  it('REFUSES a SetupIntent minted for another subscription', async () => {
    // THE security property. `sessionId` arrives from a browser and names an
    // object at Stripe, not in our database — without this check a tenant
    // could post a stranger's SetupIntent id and attach their card.
    stubFetch([
      {
        body: {
          id: 'seti_4',
          status: 'succeeded',
          customer: 'cus_someone_else',
          metadata: { reference: 'sub-theirs' },
          payment_method: { id: 'pm_theirs', card: { last4: '1111' } },
        },
      },
    ]);

    await expect(
      stripeProvider(PT_BR_STRIPE_COPY).vault!.complete({ sessionId: 'seti_4', reference: 'sub-mine' }, creds),
    ).rejects.toThrow(/does not belong/i);
  });

  it('checks the reference even with no customer on file — the FIRST card', async () => {
    // The customer does not exist until `begin` creates it, so a check that
    // rested on `customerRef` would be skipped exactly when the account is
    // newest. The reference is stamped server-side and always present.
    stubFetch([
      {
        body: {
          id: 'seti_6',
          status: 'succeeded',
          customer: 'cus_attacker',
          metadata: { reference: 'sub-theirs' },
          payment_method: { id: 'pm_x', card: { last4: '1111' } },
        },
      },
    ]);

    await expect(
      stripeProvider(PT_BR_STRIPE_COPY).vault!.complete({ sessionId: 'seti_6', reference: 'sub-mine' }, creds),
    ).rejects.toThrow(/does not belong/i);
  });

  it('detaches the payment method, and leaves the customer standing', async () => {
    // `detach`, not `customers.delete`. The customer carries the tenant's
    // stored-credential agreement and anything else hanging off it, so
    // deleting it to remove one card would take the next card's paperwork
    // with it.
    const calls = stubFetch([{ body: { id: 'pm_9' } }]);

    await stripeProvider(PT_BR_STRIPE_COPY).vault!.forget!({ instrumentId: 'pm_9' }, creds);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/payment_methods/pm_9/detach');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('makes no call at all in stub mode', async () => {
    // The adapter contract: stubs never reach the network. Nothing was vaulted
    // at Stripe in stub mode, so there is nothing there to detach — and a
    // deployment running on stubs must still be able to remove a card.
    const calls = stubFetch([{ body: {} }]);

    await stripeProvider(PT_BR_STRIPE_COPY).vault!.forget!(
      { instrumentId: 'pm_stub' },
      { ...creds, stub: true },
    );

    expect(calls).toHaveLength(0);
  });

  it('reports a rejected detach as a NON-retriable error', async () => {
    // The host reads `retriable` to decide whether to keep its pointer: a 4xx
    // means Stripe will never act on this id, so holding the row would strand
    // the tenant with a card they cannot remove. Nothing here inspects the
    // message to reach that conclusion.
    stubFetch([{ status: 404, body: { error: { code: 'resource_missing' } } }]);

    const error = await stripeProvider(PT_BR_STRIPE_COPY)
      .vault!.forget!({ instrumentId: 'pm_gone' }, creds)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).retriable).toBe(false);
  });

  it('reports a Stripe outage during detach as RETRIABLE', async () => {
    // The one failure the host refuses on: clicking again in ten seconds
    // genuinely works, and dropping the pointer would throw away the only
    // handle on a card that is still stored.
    stubFetch([{ status: 503, body: { error: {} } }]);

    const error = await stripeProvider(PT_BR_STRIPE_COPY)
      .vault!.forget!({ instrumentId: 'pm_9' }, creds)
      .catch((thrown: unknown) => thrown);

    expect((error as ProviderRequestError).retriable).toBe(true);
  });

  it('refuses an intent that never succeeded', async () => {
    // An abandoned or failed confirmation attaches nothing worth charging;
    // storing it would leave the tenant looking set up and uncollectable.
    stubFetch([
      {
        body: {
          id: 'seti_5',
          status: 'requires_payment_method',
          customer: 'cus_1',
          metadata: { reference: 'sub-1' },
        },
      },
    ]);

    await expect(
      stripeProvider(PT_BR_STRIPE_COPY).vault!.complete(
        { sessionId: 'seti_5', reference: 'sub-1', customerRef: 'cus_1' },
        creds,
      ),
    ).rejects.toThrow(/not succeeded/i);
  });

  /**
   * Stripe's "next steps" per decline code, normalized the same way PagBank's
   * "Retentável" column is (FUT-340) — so one retry policy can read one field
   * whichever acquirer the platform switch happens to be pointed at.
   */
  it.each([
    ['issuer_not_available', true, 'the issuer was down; the card is fine'],
    ['stolen_card', false, 'this card will never authorize again'],
    ['revocation_of_authorization', false, 'the holder cancelled the recurring debit'],
  ])('reports decline_code %s as retriable=%s — %s', async (declineCode, retriable) => {
    stubFetch([
      {
        status: 402,
        body: { error: { code: 'card_declined', decline_code: declineCode } },
      },
    ]);

    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), creds);
    expect(snapshot.status).toBe('DECLINED');
    expect(snapshot.declineRetriable).toBe(retriable);
  });

  it('leaves retriability undefined when Stripe gave no guidance', async () => {
    // Most declines fall in neither list. Undefined is the honest answer and
    // lets the caller apply its own bounded policy instead of acting on a
    // verdict Stripe never gave.
    stubFetch([{ status: 402, body: { error: { code: 'card_declined' } } }]);

    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).createCharge(cardInput(), creds);
    expect(snapshot.declineReason).toBe('CARD_DECLINED');
    expect(snapshot.declineRetriable).toBeUndefined();
  });

  it('maps intent statuses onto the normalized lifecycle', async () => {
    const cases: Array<[string, string]> = [
      ['succeeded', 'PAID'],
      ['requires_capture', 'AUTHORIZED'],
      ['processing', 'PENDING'],
      ['canceled', 'CANCELED'],
    ];
    for (const [stripeStatus, expected] of cases) {
      // A real intent always reports its amount; one without is now (correctly)
      // refused, so the fixture gains the field rather than the guard losing it.
      stubFetch([
        { body: { id: 'pi_x', status: stripeStatus, amount: 500, payment_method_types: ['card'] } },
      ]);
      const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).getCharge('pi_x', creds);
      expect(snapshot.status).toBe(expected);
    }
  });

  it('builds the Connect authorize URL and exchanges the code for account tokens', async () => {
    const app: ResolvedCredentials = {
      environment: 'PRODUCTION',
      fields: { clientId: 'ca_1', clientSecret: 'sk_platform', webhookSecret: 'whsec_platform' },
    };
    const adapter = stripeProvider(PT_BR_STRIPE_COPY);

    const request = await adapter.oauth!.buildAuthorizeUrl(app, {
      state: 'st_1',
      redirectUri: 'https://host.example/cb',
    });
    expect(request.url).toContain('https://connect.stripe.com/oauth/authorize');
    expect(request.url).toContain('client_id=ca_1');
    expect(request.url).toContain('scope=read_write');
    expect(request.url).toContain('state=st_1');

    const calls = stubFetch([
      {
        body: {
          access_token: 'sk_acct_new',
          refresh_token: 'rt_1',
          stripe_user_id: 'acct_new',
          stripe_publishable_key: 'pk_new',
        },
      },
    ]);
    const tokens = await adapter.oauth!.exchangeCode('ac_1', app, {
      redirectUri: 'https://host.example/cb',
    });

    expect(formOf(calls[0]!.init)['grant_type']).toBe('authorization_code');
    expect(tokens.fields['accessToken']).toBe('sk_acct_new');
    expect(tokens.fields['stripeUserId']).toBe('acct_new');
    // Also under the RESERVED identity key, which is what the settings page
    // reads back as "Conta conectada: acct_…" (FUT-691 / FUT-300).
    expect(tokens.fields['accountId']).toBe('acct_new');
    expect(tokens.fields['publishableKey']).toBe('pk_new');
    // Connect deliveries are signed with the PLATFORM secret — without this
    // copy an OAuth-connected store could not verify its own webhooks.
    expect(tokens.fields['webhookSecret']).toBe('whsec_platform');
    // Standard-account tokens do not expire.
    expect(tokens.expiresAt).toBeNull();
  });

  it('keeps the original refresh token when a refresh response omits it', async () => {
    stubFetch([{ body: { access_token: 'sk_rolled' } }]);
    const tokens = await stripeProvider(PT_BR_STRIPE_COPY).oauth!.refresh(
      { environment: 'PRODUCTION', fields: { refreshToken: 'rt_keep', stripeUserId: 'acct_1' } },
      { environment: 'PRODUCTION', fields: { clientId: 'ca_1', clientSecret: 'sk_p' } },
    );
    expect(tokens.fields['accessToken']).toBe('sk_rolled');
    expect(tokens.fields['refreshToken']).toBe('rt_keep');
  });

  it('parses payment_intent events and ignores unrelated ones', async () => {
    const adapter = stripeProvider(PT_BR_STRIPE_COPY);
    const creds: ResolvedCredentials = { environment: 'PRODUCTION', fields: { secretKey: 'sk' } };
    const paid = await adapter.webhook.parse(
      {
        provider: 'stripe',
        rawBody: JSON.stringify({
          id: 'evt_1',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_9', status: 'succeeded', amount: 500, currency: 'brl' } },
        }),
        headers: {},
      },
      creds,
    );
    expect(paid[0]).toMatchObject({ eventId: 'evt_1', type: 'CHARGE_UPDATED' });
    expect(paid[0]?.charge?.status).toBe('PAID');
    // FUT-373: the captured amount is forwarded, never invented.
    expect(paid[0]?.charge?.amount.amountCents).toBe(500);

    const other = await adapter.webhook.parse(
      {
        provider: 'stripe',
        rawBody: JSON.stringify({ id: 'evt_2', type: 'customer.created', data: { object: {} } }),
        headers: {},
      },
      creds,
    );
    expect(other[0]?.type).toBe('UNKNOWN');
  });

  it('REFUSES a succeeded payment_intent delivery that carries no amount', async () => {
    // A fabricated zero is exactly the input a host's shortfall guard exists to
    // catch: it turns a fully-paid order into a parked one.
    await expect(
      stripeProvider(PT_BR_STRIPE_COPY).webhook.parse(
        {
          provider: 'stripe',
          rawBody: JSON.stringify({
            id: 'evt_3',
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_10', status: 'succeeded', currency: 'brl' } },
          }),
          headers: {},
        },
        { environment: 'PRODUCTION', fields: { secretKey: 'sk' } },
      ),
    ).rejects.toThrow(ProviderRequestError);
  });

  it('REFUSES a succeeded intent with no amount on the poll path too', async () => {
    stubFetch([{ body: { id: 'pi_11', status: 'succeeded', currency: 'brl' } }]);
    await expect(
      stripeProvider(PT_BR_STRIPE_COPY).getCharge('pi_11', {
        environment: 'PRODUCTION',
        fields: { secretKey: 'sk' },
      }),
    ).rejects.toThrow(ProviderRequestError);
  });

  it('still answers PENDING for an unpaid intent that carries no amount', async () => {
    // The refusal is scoped to SETTLED: an intent nobody has paid legitimately
    // has nothing to report, and throwing would break the buyer's poll.
    stubFetch([{ body: { id: 'pi_12', status: 'requires_action', currency: 'brl' } }]);
    const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).getCharge('pi_12', {
      environment: 'PRODUCTION',
      fields: { secretKey: 'sk' },
    });
    expect(snapshot).toMatchObject({ status: 'PENDING', amount: { amountCents: 0 } });
  });
});

describe('stone live mode (pagar.me v5)', () => {
  it('posts an order with basic auth and maps the PIX QR code back', async () => {
    const calls = stubFetch([
      {
        body: {
          id: 'or_1',
          charges: [
            {
              id: 'ch_1',
              status: 'pending',
              amount: 12_50,
              payment_method: 'pix',
              last_transaction: { qr_code: '000201-stone', qr_code_url: 'https://qr.example' },
            },
          ],
        },
      },
    ]);

    const snapshot = await stoneProvider(PT_BR_STONE_COPY).createCharge(pixInput(), LIVE);

    expect(calls[0]!.url).toBe('https://api.pagar.me/core/v5/orders');
    const headers = calls[0]!.init.headers as Record<string, string>;
    // Secret key as the USERNAME with an empty password — not a bearer token.
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('sk_live_x:').toString('base64')}`,
    );
    const body = jsonOf(calls[0]!.init);
    expect(body['code']).toBe('order-1');
    expect((body['payments'] as Array<Record<string, unknown>>)[0]?.['payment_method']).toBe('pix');
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_1', status: 'PENDING', method: 'PIX' });
    expect(snapshot.pix?.qrText).toBe('000201-stone');
  });

  it('maps a refused card to DECLINED with the acquirer reason', async () => {
    stubFetch([
      {
        body: {
          id: 'or_2',
          charges: [
            {
              id: 'ch_2',
              status: 'failed',
              amount: 99_90,
              payment_method: 'credit_card',
              last_transaction: { acquirer_return_code: '51', card: { brand: 'visa', last_four_digits: '4242' } },
            },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).createCharge(cardInput(), LIVE);
    expect(snapshot.status).toBe('DECLINED');
    expect(snapshot.declineReason).toBe('INSUFFICIENT_FUNDS');
  });

  it('sends a card token, never a PAN, and honours a saved card id', async () => {
    const calls = stubFetch([{ body: { id: 'or_3', charges: [{ id: 'ch_3', status: 'paid' }] } }]);
    await stoneProvider(PT_BR_STONE_COPY).createCharge(
      { ...cardInput(), card: { savedCardToken: 'card_saved_1' } },
      LIVE,
    );
    const payment = (jsonOf(calls[0]!.init)['payments'] as Array<Record<string, unknown>>)[0];
    const card = payment?.['credit_card'] as Record<string, unknown>;
    expect(card['card_id']).toBe('card_saved_1');
    expect(card['card_token']).toBeUndefined();
  });

  it('authenticates webhooks by basic auth and fails closed without credentials', async () => {
    const adapter = stoneProvider(PT_BR_STONE_COPY);
    const creds: ResolvedCredentials = {
      environment: 'PRODUCTION',
      fields: { webhookUser: 'hook', webhookPassword: 's3cr3t' },
    };
    const expected = `Basic ${Buffer.from('hook:s3cr3t').toString('base64')}`;

    await expect(
      adapter.webhook.verify(
        { provider: 'stone', rawBody: '{}', headers: { authorization: expected } },
        creds,
      ),
    ).resolves.toBe(true);
    await expect(
      adapter.webhook.verify(
        { provider: 'stone', rawBody: '{}', headers: { authorization: 'Basic wrong' } },
        creds,
      ),
    ).resolves.toBe(false);
    // No configured credentials in live mode → always rejected.
    await expect(
      adapter.webhook.verify(
        { provider: 'stone', rawBody: '{}', headers: { authorization: expected } },
        { environment: 'PRODUCTION', fields: {} },
      ),
    ).resolves.toBe(false);
  });

  it('refunds by DELETEing the charge, with an amount only when partial', async () => {
    const calls = stubFetch([{ body: { id: 'ch_4', status: 'refunded', amount: 500 } }]);
    await stoneProvider(PT_BR_STONE_COPY).refund!(
      { providerChargeId: 'ch_4', amount: { amountCents: 500, currency: 'BRL' } },
      LIVE,
    );
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(jsonOf(calls[0]!.init)['amount']).toBe(500);
  });

  /**
   * The webhook half used a payload Pagar.me does not send — a bare charge with
   * no nested order — and passed because it took a shape fallback that no real
   * delivery reached. That fallback is gone; the fixture is kept only as the
   * historical case, with the REAL shape asserted beside it. The pipeline-level
   * account of what the two shapes cost is in `stone-webhook.test.ts` (FUT-674).
   */
  it('REFUSES a paid charge that carries no amount, on both the poll and the webhook', async () => {
    stubFetch([{ body: { id: 'or_9', charges: [{ id: 'ch_9', status: 'paid' }] } }]);
    await expect(stoneProvider(PT_BR_STONE_COPY).getCharge('or_9', LIVE)).rejects.toThrow(ProviderRequestError);

    await expect(
      stoneProvider(PT_BR_STONE_COPY).webhook.parse(
        {
          provider: 'stone',
          rawBody: JSON.stringify({
            id: 'evt_9',
            type: 'charge.paid',
            data: { id: 'ch_9', status: 'paid' },
          }),
          headers: {},
        },
        LIVE,
      ),
    ).rejects.toThrow(ProviderRequestError);

    await expect(
      stoneProvider(PT_BR_STONE_COPY).webhook.parse(
        {
          provider: 'stone',
          rawBody: JSON.stringify({
            id: 'evt_9b',
            type: 'charge.paid',
            data: { id: 'ch_9', status: 'paid', order: { id: 'or_9', code: 'order-1' } },
          }),
          headers: {},
        },
        LIVE,
      ),
    ).rejects.toThrow(ProviderRequestError);
  });

  /**
   * The POLL reads the same mapping the webhook does, and it is the path that
   * actually reaches most stores today — a merchant who followed the setup
   * guide before it named `charge.underpaid` gets a shortfall here first
   * (FUT-674). All three cases were uncovered.
   */
  it('reports what a short payment CAPTURED, not what was raised', async () => {
    stubFetch([
      {
        body: {
          id: 'or_11',
          code: 'order-1',
          charges: [
            { id: 'ch_11', status: 'underpaid', amount: 25_38, paid_amount: 15_00, payment_method: 'pix' },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_11', LIVE);
    expect(snapshot).toMatchObject({ status: 'PAID', amount: { amountCents: 15_00 } });
  });

  it('REFUSES a short payment that does not say how much came in', async () => {
    // The amount RAISED would clear a host's coverage guard and settle an
    // order for money that never arrived.
    stubFetch([{ body: { id: 'or_12', charges: [{ id: 'ch_12', status: 'underpaid', amount: 25_38 }] } }]);
    await expect(stoneProvider(PT_BR_STONE_COPY).getCharge('or_12', LIVE)).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('answers REFUNDED for a full reversal, which reads `canceled` on the wire', async () => {
    // CANCELED does not outrank PAID, so mapping the word rather than the money
    // left a refunded charge's row sitting at PAID for ever.
    stubFetch([
      {
        body: {
          id: 'or_14',
          charges: [
            { id: 'ch_14', status: 'canceled', amount: 25_38, paid_amount: 25_38, canceled_amount: 25_38 },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_14', LIVE);
    expect(snapshot.status).toBe('REFUNDED');
  });

  it('still answers CANCELED for a cancellation that returned no money', async () => {
    stubFetch([{ body: { id: 'or_15', charges: [{ id: 'ch_15', status: 'canceled', amount: 25_38 }] } }]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_15', LIVE);
    expect(snapshot.status).toBe('CANCELED');
  });

  it('answers CANCELED for a VOID, which cancels an amount without returning one', async () => {
    // `canceled_amount` names the amount CANCELLED, not the amount returned —
    // voiding an unpaid charge cancels its full value with nothing having
    // arrived. Reading it alone parks a payable for money the buyer never
    // sent, and marks a void as proof the connection can charge.
    stubFetch([
      {
        body: {
          id: 'or_17',
          charges: [
            { id: 'ch_17', status: 'canceled', amount: 25_38, paid_amount: 0, canceled_amount: 25_38 },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_17', LIVE);
    expect(snapshot.status).toBe('CANCELED');
  });

  it('reports what a short-paid charge CAPTURED after it is reversed whole', async () => {
    // The poll and the webhook read the same order object and must agree: the
    // webhook path already answers 15_00 here, and reporting the amount raised
    // writes a capture larger than reality over the row the host parked short.
    stubFetch([
      {
        body: {
          id: 'or_18',
          charges: [
            { id: 'ch_18', status: 'canceled', amount: 25_38, paid_amount: 15_00, canceled_amount: 15_00 },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_18', LIVE);
    expect(snapshot).toMatchObject({ status: 'REFUNDED', amount: { amountCents: 15_00 } });
  });

  it('reads a PARTIAL reversal as partial even under the word `canceled`', async () => {
    // Reporting REFUNDED here parks the WHOLE payable for a partial return and
    // puts the row at rank 4, which nothing can move afterwards.
    stubFetch([
      {
        body: {
          id: 'or_24',
          charges: [
            { id: 'ch_24', status: 'canceled', amount: 25_38, paid_amount: 25_38, canceled_amount: 9_00 },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_24', LIVE);
    expect(snapshot.status).toBe('PARTIALLY_REFUNDED');
  });

  it('lets a live PAID charge outrank a reversed sibling listed before it', async () => {
    // Membership plus array order is not a choice between siblings: the
    // reversed charge listed first made an order.paid report REFUNDED, which
    // the reactor parks where it used to settle.
    stubFetch([
      {
        body: {
          id: 'or_20',
          charges: [
            { id: 'ch_20a', status: 'canceled', amount: 25_38, paid_amount: 25_38, canceled_amount: 25_38 },
            { id: 'ch_20b', status: 'paid', amount: 25_38, paid_amount: 25_38, payment_method: 'pix' },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_20', LIVE);
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_20b', status: 'PAID' });
  });

  it('does not let a shortfall sibling refuse a delivery a paid charge answers', async () => {
    // The same defect's sharper half: the underpaid sibling has no
    // `paid_amount`, so speaking for the order made the WHOLE delivery throw
    // and an order that really was paid never settled.
    stubFetch([
      {
        body: {
          id: 'or_21',
          charges: [
            { id: 'ch_21a', status: 'underpaid', amount: 25_38 },
            { id: 'ch_21b', status: 'paid', amount: 25_38, paid_amount: 25_38, payment_method: 'pix' },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_21', LIVE);
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_21b', status: 'PAID' });
  });

  it('lets a charge still HOLDING money outrank ones that gave it back', async () => {
    // The priority's lower rungs, which no assertion pinned until a mutation
    // reordered them and every test still passed: money the store currently
    // has speaks over money it has returned, and a partial return over a full
    // one. Ordered worst-first here so array position cannot supply the answer.
    stubFetch([
      {
        body: {
          id: 'or_22',
          charges: [
            { id: 'ch_22a', status: 'refunded', amount: 25_38, paid_amount: 25_38 },
            { id: 'ch_22b', status: 'partial_canceled', amount: 25_38, paid_amount: 25_38 },
            { id: 'ch_22c', status: 'overpaid', amount: 25_38, paid_amount: 30_00, payment_method: 'pix' },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_22', LIVE);
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_22c', status: 'PAID' });
  });

  it('lets a PARTIAL reversal outrank a full one', async () => {
    stubFetch([
      {
        body: {
          id: 'or_23',
          charges: [
            { id: 'ch_23a', status: 'refunded', amount: 25_38, paid_amount: 25_38 },
            { id: 'ch_23b', status: 'partial_canceled', amount: 25_38, paid_amount: 25_38 },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_23', LIVE);
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_23b', status: 'PARTIALLY_REFUNDED' });
  });

  it('lets a REVERSED charge speak for its order over a failed sibling', async () => {
    // The same hole `settledCharge` had for `overpaid`, one status along: a
    // charge that took money and gave it back still speaks for its order.
    stubFetch([
      {
        body: {
          id: 'or_19',
          charges: [
            { id: 'ch_19a', status: 'failed', amount: 25_38 },
            { id: 'ch_19b', status: 'refunded', amount: 25_38, paid_amount: 25_38 },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_19', LIVE);
    expect(snapshot).toMatchObject({ providerChargeId: 'ch_19b', status: 'REFUNDED' });
  });

  it('lets a SETTLED charge speak for a multi-charge order, not merely a `paid` one', async () => {
    // A first attempt that failed beside a second that overpaid: reading only
    // `paid` picks the failure and reports the whole order DECLINED.
    stubFetch([
      {
        body: {
          id: 'or_16',
          charges: [
            { id: 'ch_16a', status: 'failed', amount: 25_38 },
            { id: 'ch_16b', status: 'overpaid', amount: 25_38, paid_amount: 30_00, payment_method: 'pix' },
          ],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_16', LIVE);
    expect(snapshot).toMatchObject({
      providerChargeId: 'ch_16b',
      status: 'PAID',
      amount: { amountCents: 30_00 },
    });
  });

  it('answers PARTIALLY_REFUNDED for a partially reversed charge', async () => {
    // Without a mapping this fell through to PENDING, and the row never left
    // the pending sweep until its abandon window.
    stubFetch([
      {
        body: {
          id: 'or_13',
          charges: [{ id: 'ch_13', status: 'partial_canceled', amount: 25_38, paid_amount: 25_38 }],
        },
      },
    ]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_13', LIVE);
    expect(snapshot.status).toBe('PARTIALLY_REFUNDED');
  });

  it('still answers PENDING for an unpaid order with no amount', async () => {
    stubFetch([{ body: { id: 'or_10', charges: [{ id: 'ch_10', status: 'waiting_payment' }] } }]);
    const snapshot = await stoneProvider(PT_BR_STONE_COPY).getCharge('or_10', LIVE);
    expect(snapshot).toMatchObject({ status: 'PENDING', amount: { amountCents: 0 } });
  });
});

describe('infinitepay live mode', () => {
  const creds: ResolvedCredentials = {
    environment: 'PRODUCTION',
    fields: { handle: '$minhaloja' },
  };

  it('creates a checkout link keyed on the host reference and strips the $ from the handle', async () => {
    const calls = stubFetch([{ body: { url: 'https://checkout.infinitepay.io/abc' } }]);
    const snapshot = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).createCharge(pixInput(), creds);

    expect(calls[0]!.url).toBe('https://api.checkout.infinitepay.io/links');
    const body = jsonOf(calls[0]!.init);
    expect(body['handle']).toBe('minhaloja');
    expect(body['order_nsu']).toBe('order-1');
    expect(snapshot.hostedCheckoutUrl).toBe('https://checkout.infinitepay.io/abc');
    // The reference IS the charge id, so a later lookup needs nothing new.
    expect(snapshot.providerChargeId).toBe('order-1');
    expect(snapshot.status).toBe('PENDING');
  });

  /**
   * The item field is `description`, and InfinitePay rejects the whole request
   * without it:
   *
   *     422 {"success":false,"message":"Invalid checkout link params",
   *          "errors":{"items":{"0":{"description":["is missing"]}}}}
   *
   * It shipped as `name`, so NO InfinitePay link could ever be created. The
   * request was asserted here already — but only its handle and reference, so
   * the one field that invalidated every call went unpinned. Nothing surfaced
   * the provider's answer either, which is why a total outage read as silence.
   */
  it('names each item `description` — InfinitePay 422s the whole link without it', async () => {
    const calls = stubFetch([{ body: { url: 'https://checkout.infinitepay.io/abc' } }]);
    await infinitePayProvider(PT_BR_INFINITEPAY_COPY).createCharge(pixInput(), creds);

    const items = jsonOf(calls[0]!.init)['items'] as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      description: expect.stringContaining('order-1'),
      price: expect.any(Number),
      quantity: 1,
    });
    expect(items[0]).not.toHaveProperty('name');
  });

  it('believes a webhook ONLY after payment_check confirms it', async () => {
    const calls = stubFetch([{ body: { success: true, paid: true, amount: 12_50 } }]);
    const delivery = {
      provider: 'infinitepay',
      rawBody: JSON.stringify({ order_nsu: 'order-1', transaction_nsu: 'tx-1', slug: 'sl' }),
      headers: {},
    };

    await expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).webhook.verify(delivery, creds)).resolves.toBe(true);
    expect(calls[0]!.url).toBe('https://api.checkout.infinitepay.io/payment_check');
    expect(jsonOf(calls[0]!.init)['order_nsu']).toBe('order-1');
  });

  it('rejects a forged "paid" delivery that payment_check does not confirm', async () => {
    stubFetch([{ body: { success: false, paid: false } }]);
    const forged = {
      provider: 'infinitepay',
      // The body CLAIMS paid; the adapter must not care what it claims.
      rawBody: JSON.stringify({ order_nsu: 'order-1', paid: true, amount: 999_99 }),
      headers: {},
    };
    await expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).webhook.verify(forged, creds)).resolves.toBe(false);
  });

  it('fails closed when payment_check itself errors, and when there is no reference', async () => {
    stubFetch([{ status: 500, body: { error: 'boom' } }]);
    await expect(
      infinitePayProvider(PT_BR_INFINITEPAY_COPY).webhook.verify(
        { provider: 'infinitepay', rawBody: JSON.stringify({ order_nsu: 'order-1' }), headers: {} },
        creds,
      ),
    ).resolves.toBe(false);

    await expect(
      infinitePayProvider(PT_BR_INFINITEPAY_COPY).webhook.verify(
        { provider: 'infinitepay', rawBody: JSON.stringify({ paid: true }), headers: {} },
        creds,
      ),
    ).resolves.toBe(false);
  });

  it('declares refunds unsupported rather than failing at the call', () => {
    const adapter = infinitePayProvider(PT_BR_INFINITEPAY_COPY);
    expect(adapter.capabilities.refunds).toBe(false);
    expect(adapter.refund).toBeUndefined();
  });
});

describe('pagbank connect oauth', () => {
  const app: ResolvedCredentials = {
    environment: 'PRODUCTION',
    // `accountToken` is required: PagBank wants the partner's token as a
    // Bearer alongside the id/secret pair, or the exchange dies as
    // `401 invalid_token`.
    fields: { clientId: 'cid', clientSecret: 'csec', webhookToken: 'wht', accountToken: 'acct' },
  };

  it('sends the merchant to the production consent screen with the requested scopes', async () => {
    const request = await pagbankProvider(PT_BR_PAGBANK_COPY).oauth!.buildAuthorizeUrl(app, {
      state: 'st_9',
      redirectUri: 'https://host.example/cb',
    });
    expect(request.url).toContain('https://connect.pagbank.com.br/oauth2/authorize');
    expect(request.url).toContain('client_id=cid');
    expect(request.url).toContain('payments.create');
    expect(request.state).toBe('st_9');
  });

  it('uses the sandbox host for a SANDBOX connection', async () => {
    const request = await pagbankProvider(PT_BR_PAGBANK_COPY).oauth!.buildAuthorizeUrl(
      { ...app, environment: 'SANDBOX' },
      { state: 's', redirectUri: 'https://host.example/cb' },
    );
    expect(request.url).toContain('https://connect.sandbox.pagbank.com.br/oauth2/authorize');
  });

  it('stores the access token under the key the charge path already reads', async () => {
    const calls = stubFetch([
      { body: { access_token: 'at_1', refresh_token: 'rt_1', expires_in: 3600, account_id: 'acc_1' } },
    ]);
    const tokens = await pagbankProvider(PT_BR_PAGBANK_COPY).oauth!.exchangeCode('code_1', app, {
      redirectUri: 'https://host.example/cb',
    });

    expect(calls[0]!.url).toBe('https://api.pagseguro.com/oauth2/token');
    // JSON body + X_CLIENT_* headers, NOT form encoding + Basic auth: PagBank
    // deviates from the OAuth2 default here, and the conventional shape fails
    // the exchange with an error the merchant only sees as a dead callback.
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X_CLIENT_ID']).toBe('cid');
    // Bearer, never Basic: PagBank wants the partner's account token here on
    // top of the id/secret pair. Asserting this header was ABSENT is what kept
    // the missing-Bearer bug alive, so pin the value rather than its absence.
    expect(headers['Authorization']).toBe('Bearer acct');
    expect(JSON.parse(calls[0]!.init.body as string)['redirect_uri']).toBe(
      'https://host.example/cb',
    );
    // `token` — the same field a store that pasted its token would fill, so
    // both connection styles share one charge path.
    expect(tokens.fields['token']).toBe('at_1');
    expect(tokens.fields['webhookToken']).toBe('wht');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects a token response with no access token instead of storing a broken connection', async () => {
    stubFetch([{ body: { refresh_token: 'rt_only' } }]);
    await expect(
      pagbankProvider(PT_BR_PAGBANK_COPY).oauth!.exchangeCode('c', app, { redirectUri: 'https://host.example/cb' }),
    ).rejects.toThrow(/no access token/i);
  });
});

/**
 * FUT-680 — the PagBank refund must read the response, not narrate one. It
 * used to POST `{"amount":{}}` (partialRefunds is false, so `value` was always
 * undefined) and answer a hardcoded REFUNDED with a fabricated 0-cent amount,
 * whatever PagBank said. Mirrors the Stripe test below.
 */
describe('pagbank refund honesty', () => {
  const creds: ResolvedCredentials = {
    environment: 'PRODUCTION',
    fields: { token: 'tok_live' },
  };

  it('reports a failed PagBank refund as FAILED, not REFUNDED', async () => {
    for (const [status, expected] of [
      ['CANCELED', 'REFUNDED'],
      // The cancel endpoint answers with the charge as it now stands; a
      // charge still PAID is the provider saying the cancel did not take.
      ['PAID', 'FAILED'],
      ['AUTHORIZED', 'FAILED'],
      ['DECLINED', 'FAILED'],
      ['IN_ANALYSIS', 'FAILED'],
      // An unknown status must never be optimistically called complete.
      ['SOMETHING_NEW', 'PENDING'],
      [undefined, 'PENDING'],
    ] as const) {
      stubFetch([{ body: { id: 'CHAR_1', status, amount: { value: 500 } } }]);
      const snapshot = await pagbankProvider(PT_BR_PAGBANK_COPY).refund!({ providerChargeId: 'CHAR_1' }, creds);
      expect(snapshot.status, `pagbank cancel status "${status}"`).toBe(expected);
    }
  });

  it('sends NO body for a full refund — never the {"amount":{}} shape', async () => {
    const calls = stubFetch([{ body: { id: 'CHAR_2', status: 'CANCELED' } }]);
    await pagbankProvider(PT_BR_PAGBANK_COPY).refund!({ providerChargeId: 'CHAR_2' }, creds);

    expect(calls[0]!.url).toBe('https://api.pagseguro.com/charges/CHAR_2/cancel');
    expect(calls[0]!.init.method).toBe('POST');
    // PagBank documents an omitted `amount` as "cancel the total"; an empty
    // amount object asserts nothing and is the wire bug FUT-680 names.
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('still sends the explicit amount when the caller has one', async () => {
    const calls = stubFetch([{ body: { id: 'CHAR_3', status: 'CANCELED' } }]);
    await pagbankProvider(PT_BR_PAGBANK_COPY).refund!(
      { providerChargeId: 'CHAR_3', amount: { amountCents: 500, currency: 'BRL' } },
      creds,
    );
    expect(jsonOf(calls[0]!.init)).toEqual({ amount: { value: 500 } });
  });

  it('reports the amount PagBank says went back, not a fabricated zero', async () => {
    stubFetch([
      {
        body: {
          id: 'CHAR_4',
          status: 'CANCELED',
          amount: { value: 12_50, summary: { refunded: 12_50 } },
        },
      },
    ]);
    const snapshot = await pagbankProvider(PT_BR_PAGBANK_COPY).refund!({ providerChargeId: 'CHAR_4' }, creds);
    expect(snapshot.amount).toEqual({ amountCents: 12_50, currency: 'BRL' });
    expect(snapshot.providerRefundId).toBe('CHAR_4');
  });
});

/**
 * Regressions for the four defects the FUT-305 review caught. Each one was
 * silently wrong rather than loud — the class of bug that reconciles badly
 * weeks later — so each keeps a test.
 */
describe('review regressions', () => {
  it('reports a failed Stripe refund as FAILED, not REFUNDED', async () => {
    const creds: ResolvedCredentials = {
      environment: 'PRODUCTION',
      fields: { secretKey: 'sk_live_x' },
    };
    for (const [status, expected] of [
      ['succeeded', 'REFUNDED'],
      ['pending', 'PENDING'],
      ['requires_action', 'PENDING'],
      ['failed', 'FAILED'],
      ['canceled', 'FAILED'],
      // An unknown status must never be optimistically called complete.
      ['something_new', 'PENDING'],
    ] as const) {
      stubFetch([{ body: { id: 're_1', status, amount: 500 } }]);
      const snapshot = await stripeProvider(PT_BR_STRIPE_COPY).refund!(
        { providerChargeId: 'pi_1', amount: { amountCents: 500, currency: 'BRL' } },
        creds,
      );
      expect(snapshot.status, `stripe refund status "${status}"`).toBe(expected);
    }
  });

  it('never lets a stored apiBase field redirect Stone traffic off pagar.me', async () => {
    const calls = stubFetch([{ body: { id: 'or_1', status: 'paid', charges: [] } }]);
    await stoneProvider(PT_BR_STONE_COPY).getCharge('or_1', {
      environment: 'PRODUCTION',
      // A tenant-supplied field must not steer where the secret is sent.
      fields: { secretKey: 'sk_live_x', apiBase: 'https://attacker.example' },
    });

    expect(calls[0]!.url.startsWith('https://api.pagar.me/core/v5')).toBe(true);
    expect(calls[0]!.url).not.toContain('attacker.example');
  });

  it('records an InfinitePay card payment as CARD, not PIX', async () => {
    const adapter = infinitePayProvider(PT_BR_INFINITEPAY_COPY);
    const creds: ResolvedCredentials = { environment: 'PRODUCTION', fields: { handle: '$loja' } };
    // `parse` re-asks payment_check, so THAT answer is what decides the method
    // — the unsigned delivery body never gets to.
    const methodOfPayment = async (check: Record<string, unknown>) => {
      stubFetch([{ body: { success: true, amount: 12_50, ...check } }]);
      const events = await adapter.webhook.parse(
        { provider: 'infinitepay', rawBody: JSON.stringify({ order_nsu: 'o1' }), headers: {} },
        creds,
      );
      return events[0]!.charge!.method;
    };

    // InfinitePay's own answer wins…
    expect(await methodOfPayment({ capture_method: 'credit_card' })).toBe('CARD');
    expect(await methodOfPayment({ capture_method: 'pix' })).toBe('PIX');
    // …an installment count is the fallback tell, since PIX is never split…
    expect(await methodOfPayment({ installments: 3 })).toBe('CARD');
    // …and PIX stands only when nothing says otherwise.
    expect(await methodOfPayment({})).toBe('PIX');
  });

  it('takes the captured amount from payment_check, never from the unsigned body', async () => {
    // The delivery is an anonymous claim about someone else's payment. With a
    // host-side shortfall guard downstream, believing its `amount` would let
    // anyone park a fully-paid order by POSTing `{order_nsu, amount: 1}`.
    stubFetch([{ body: { success: true, amount: 12_50 } }]);
    const [event] = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).webhook.parse(
      {
        provider: 'infinitepay',
        rawBody: JSON.stringify({ order_nsu: 'o1', amount: 1 }),
        headers: {},
      },
      { environment: 'PRODUCTION', fields: { handle: '$loja' } },
    );
    expect(event?.charge).toMatchObject({ status: 'PAID', amount: { amountCents: 12_50 } });
  });

  it('REFUSES a confirmed InfinitePay payment that reports no amount', async () => {
    // Both legs: the delivery and the status poll. Neither may invent a zero.
    const creds: ResolvedCredentials = { environment: 'PRODUCTION', fields: { handle: '$loja' } };
    stubFetch([{ body: { success: true } }]);
    await expect(
      infinitePayProvider(PT_BR_INFINITEPAY_COPY).webhook.parse(
        { provider: 'infinitepay', rawBody: JSON.stringify({ order_nsu: 'o1' }), headers: {} },
        creds,
      ),
    ).rejects.toThrow(ProviderRequestError);

    stubFetch([{ body: { success: true } }]);
    await expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).getCharge('o1', creds)).rejects.toThrow(
      ProviderRequestError,
    );
  });

  it('still answers PENDING for an unpaid InfinitePay reference with no amount', async () => {
    stubFetch([{ body: { success: false } }]);
    const snapshot = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).getCharge('o1', {
      environment: 'PRODUCTION',
      fields: { handle: '$loja' },
    });
    expect(snapshot).toMatchObject({ status: 'PENDING', amount: { amountCents: 0 } });
  });
});

/**
 * The reconciliation probes (FUT-303). These are the calls that decide, after
 * an ambiguous failure, whether it is safe to charge a different provider —
 * so what matters is not just that a hit is found, but that a MISS is only
 * ever reported when it is genuinely proof of absence.
 */
describe('reconciliation probes', () => {
  it('stripe reads the LIST endpoint, not search, and matches on metadata', async () => {
    const calls = stubFetch([
      {
        body: {
          data: [
            { id: 'pi_other', metadata: { reference: 'order-9' } },
            { id: 'pi_hit', status: 'requires_payment_method', amount: 12_50, currency: 'brl', metadata: { reference: 'order-1' } },
          ],
          has_more: false,
        },
      },
    ]);

    const found = await stripeProvider(PT_BR_STRIPE_COPY).findChargeByReference!('order-1', LIVE);

    expect(found?.providerChargeId).toBe('pi_hit');
    // The list endpoint reads the primary datastore; `/search` is index-backed
    // and lags by up to a minute, which is the whole window this probe runs in.
    expect(calls[0]!.url).toContain('/v1/payment_intents?');
    expect(calls[0]!.url).not.toContain('/search');
    expect(calls[0]!.url).toContain('created%5Bgte%5D=');
  });

  it('stripe reports a MISS only after reading the whole window', async () => {
    stubFetch([{ body: { data: [{ id: 'pi_a', metadata: {} }], has_more: false } }]);
    await expect(stripeProvider(PT_BR_STRIPE_COPY).findChargeByReference!('order-1', LIVE)).resolves.toBeNull();
  });

  it('stripe refuses to call an exhausted page budget a MISS', async () => {
    // `has_more` never goes false: the probe runs out of pages without ever
    // proving absence, which is inconclusive — and must NOT be reported as
    // "no charge", or the walk would go charge someone else.
    const calls = stubFetch([{ body: { data: [{ id: 'pi_z', metadata: {} }], has_more: true } }]);
    await expect(stripeProvider(PT_BR_STRIPE_COPY).findChargeByReference!('order-1', LIVE)).rejects.toThrow(
      /undetermined, not absent/,
    );
    expect(calls.length).toBeGreaterThan(1);
  });

  it('stone filters orders by the code it sent as the reference', async () => {
    const calls = stubFetch([
      { body: { data: [{ id: 'or_9', charges: [{ id: 'ch_9', status: 'paid', amount: 12_50 }] }] } },
    ]);

    const found = await stoneProvider(PT_BR_STONE_COPY).findChargeByReference!('order-1', {
      environment: 'PRODUCTION',
      fields: { secretKey: 'sk_live_x' },
    });

    expect(calls[0]!.url).toContain('/orders?code=order-1');
    // The CHARGE id, matching what `createCharge` returns for the same order —
    // so an adopted snapshot is indistinguishable from a normally created one.
    expect(found?.providerChargeId).toBe('ch_9');
    expect(found?.status).toBe('PAID');
  });

  it('stone returns null for an empty result — proof it is safe to fail over', async () => {
    stubFetch([{ body: { data: [] } }]);
    await expect(
      stoneProvider(PT_BR_STONE_COPY).findChargeByReference!('order-1', {
        environment: 'PRODUCTION',
        fields: { secretKey: 'sk_live_x' },
      }),
    ).resolves.toBeNull();
  });

  it('pagbank looks the order up by reference_id', async () => {
    const calls = stubFetch([
      { body: { orders: [{ id: 'ORDE_9', charges: [{ id: 'CHAR_9', status: 'PAID', amount: { value: 12_50 } }] }] } },
    ]);

    const found = await pagbankProvider(PT_BR_PAGBANK_COPY).findChargeByReference!('order-1', {
      environment: 'SANDBOX',
      fields: { token: 'tok_live' },
    });

    expect(calls[0]!.url).toContain('/orders?reference_id=order-1');
    // The charge id, as `createCharge`/`getCharge` also report for this order.
    expect(found?.providerChargeId).toBe('CHAR_9');
  });

  it('infinitepay treats 404 as absence but propagates a real outage', async () => {
    const creds: ResolvedCredentials = { environment: 'PRODUCTION', fields: { handle: '$loja' } };

    stubFetch([{ status: 404, body: { error: 'not found' } }]);
    // No PAYMENT under this reference — an orphaned checkout link is not
    // money, so this is genuine proof nothing was charged.
    await expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).findChargeByReference!('order-1', creds)).resolves.toBeNull();

    stubFetch([{ status: 503, body: { error: 'down' } }]);
    // An outage is NOT absence: it must stop the walk, not license a retry
    // somewhere else.
    await expect(
      infinitePayProvider(PT_BR_INFINITEPAY_COPY).findChargeByReference!('order-1', creds),
    ).rejects.toThrow(ProviderRequestError);
  });

  it('every probe is inert in stub mode', async () => {
    const stub: ResolvedCredentials = { environment: 'SANDBOX', fields: {}, stub: true };
    stubFetch([{ status: 500, body: {} }]);
    for (const adapter of [stripeProvider(PT_BR_STRIPE_COPY), stoneProvider(PT_BR_STONE_COPY), pagbankProvider(PT_BR_PAGBANK_COPY), infinitePayProvider(PT_BR_INFINITEPAY_COPY)]) {
      await expect(adapter.findChargeByReference!('order-1', stub)).resolves.toBeNull();
    }
  });
});
