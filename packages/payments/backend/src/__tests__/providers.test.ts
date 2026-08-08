import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { STUB_CREDS, cardInput, pixInput } from './fixtures';

describe('provider skeletons (stub mode)', () => {
  it('stone creates normalized PIX charges', async () => {
    const snapshot = await stoneProvider().createCharge(pixInput(), STUB_CREDS);
    expect(snapshot).toMatchObject({
      provider: 'stone',
      status: 'PENDING',
      method: 'PIX',
      amount: { amountCents: 12_50, currency: 'BRL' },
    });
    expect(snapshot.pix?.qrText).toBeTruthy();
  });

  it('infinitepay charges carry a hosted checkout URL (redirect flow)', async () => {
    const adapter = infinitePayProvider();
    const snapshot = await adapter.createCharge(pixInput(), STUB_CREDS);
    expect(adapter.capabilities.tokenization).toBe('REDIRECT');
    expect(snapshot.hostedCheckoutUrl).toContain('stub_infinitepay_order-1');
  });

  it('stripe exposes the publishable key via clientConfig, never the secret', () => {
    const config = stripeProvider().clientConfig({
      environment: 'SANDBOX',
      fields: { secretKey: 'sk_test_x', publishableKey: 'pk_test_x' },
    });
    expect(config).toEqual({ provider: 'stripe', tokenization: 'SDK', publicKey: 'pk_test_x' });
  });

  it('stub credentials verify ok everywhere', async () => {
    for (const adapter of [stoneProvider(), infinitePayProvider(), stripeProvider()]) {
      await expect(adapter.verifyCredentials(STUB_CREDS)).resolves.toMatchObject({ ok: true });
    }
  });

  it('stub deliveries with no secret verify OK; live ones fail closed (all adapters)', async () => {
    for (const adapter of [stoneProvider(), infinitePayProvider(), stripeProvider()]) {
      const delivery = { provider: adapter.name, rawBody: '{}', headers: {} };
      await expect(adapter.webhook.verify(delivery, STUB_CREDS)).resolves.toBe(true);
      await expect(
        adapter.webhook.verify(delivery, { environment: 'PRODUCTION', fields: {} }),
      ).resolves.toBe(false);
    }
  });

  it('pagbank runs in stub mode with the proven credential schema', async () => {
    const adapter = pagbankProvider();
    // The proven trio, plus the Google Pay merchant id (FUT-471) — optional,
    // non-secret, and only read by `clientConfig`.
    expect(adapter.credentialSchema.map((f) => f.key)).toEqual([
      'token',
      'publicKey',
      'webhookToken',
      'googlePayMerchantId',
    ]);
    const snapshot = await adapter.createCharge(pixInput(), STUB_CREDS);
    expect(snapshot).toMatchObject({ provider: 'pagbank', status: 'PENDING', method: 'PIX' });
  });

  /**
   * PagBank is deliberately absent. A walkthrough is a per-store procedure, and
   * Connect — which is how PagBank is joined now — has none: one platform
   * application is reviewed centrally and the owner only authorizes. The guide
   * it used to ship described the token-paste path instead, from a review form
   * never confirmed to apply to Connect.
   */
  it('every provider with a setup guide names the merchant webhook URL', () => {
    const ctx = { webhookUrl: 'https://host.example/api/webhooks/x', publicKeyUrl: 'https://host.example/pk' };
    expect(pagbankProvider().setupGuide).toBeUndefined();
    for (const adapter of [stoneProvider(), infinitePayProvider(), stripeProvider()]) {
      const guide = adapter.setupGuide?.(ctx);
      // Stage ids are each vendor's own now that the guides are real
      // walkthroughs rather than one generic template — what every guide must
      // still do is stage the work and tell the store where deliveries land.
      expect(guide?.stages.length).toBeGreaterThanOrEqual(2);
      expect(guide?.sections.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(guide)).toContain(ctx.webhookUrl);
    }
  });

  /**
   * InfinitePay's guide used to invent a task and omit the real one.
   *
   * It carried a "Cadastrar webhook" stage telling the owner to send their
   * notification URL to `parcerias@cloudwalk.io` or register it in "o cadastro
   * da sua integração". No such registration exists — InfinitePay reads
   * `webhook_url` from the `POST /links` payload, which `linkPayload` fills in
   * on every charge, so the owner's actual task was nothing at all.
   *
   * Meanwhile the step that DOES gate the integration was missing: Checkout
   * Integrado ships disabled, and until it is switched on no link can be
   * created however valid the InfiniteTag is.
   */
  it('infinitepay tells the owner to enable Checkout, not to register a webhook', () => {
    const ctx = { webhookUrl: 'https://host.example/api/webhooks/x' };
    const guide = infinitePayProvider().setupGuide?.(ctx);
    const text = JSON.stringify(guide);

    expect(guide?.stages.map((s) => s.id)).toContain('enable');
    expect(text).toContain('Habilitar Checkout Integrado');
    // The invented task, in both of the forms it was offered.
    expect(text).not.toContain('parcerias@cloudwalk.io');
    expect(guide?.stages.map((s) => s.id)).not.toContain('webhook');
    // The URL stays, as reference — it is just no longer presented as a chore.
    expect(text).toContain(ctx.webhookUrl);
  });

  /**
   * The adapter ships every section and reports the stage it can PROVE. It
   * deliberately does not choose what is on screen: one step in the middle can
   * only be confirmed by the owner (no API reports whether Checkout Integrado
   * is on), and one can be reopened after the fact — two facts that live in the
   * browser. Choosing here meant the screen either skipped a step it had never
   * shown, or put the InfiniteTag field inside the card about enabling Checkout.
   */
  it('infinitepay reports the stage it can prove, and ships every section', () => {
    const guide = (progress: {
      configured: Record<string, boolean>;
      connected: boolean;
      proven: boolean;
    }) => infinitePayProvider().setupGuide?.({ webhookUrl: 'https://host.example/w', progress });

    const nothing = guide({ configured: {}, connected: false, proven: false });
    expect(nothing?.sections.map((s) => s.id)).toEqual(['handle', 'enable']);
    expect(nothing?.activeStage).toBe(0);

    // Saved but not probed is still step 1. A stored handle is not a handle
    // that reaches an account, and "Salvar" is what runs the probe — advancing
    // on the save alone left the credential form inside step 2's card.
    const saved = guide({ configured: { handle: true }, connected: false, proven: false });
    expect(saved?.activeStage).toBe(0);

    // The probe passing moves it on, and no further: whether Checkout Integrado
    // is switched on is a question only the owner can answer.
    const connected = guide({ configured: { handle: true }, connected: true, proven: false });
    expect(connected?.activeStage).toBe(2);
    const enable = connected?.sections.find((s) => s.id === 'enable');
    expect(enable?.steps.map((step) => step.action)).toContain('checkout-integrado-confirmado');
    expect(enable?.doneSummary?.value).toContain('Habilitado');

    // Charged: past the last stage, so every step reads as complete.
    const proven = guide({ configured: { handle: true }, connected: true, proven: true });
    expect(proven?.activeStage).toBe(proven?.stages.length);
  });

  it('declares an auth mode per provider: OAuth where the vendor supports it', () => {
    // PagBank Connect and Stripe Connect are real merchant-authorization
    // flows. Stone (key-only across every one of its APIs) and InfinitePay
    // (handle-only, no API key at all) have none — claiming otherwise would
    // render a connect button that cannot work.
    expect(pagbankProvider().authMode).toBe('oauth');
    expect(stripeProvider().authMode).toBe('oauth');
    expect(stoneProvider().authMode).toBe('credentials');
    expect(infinitePayProvider().authMode).toBe('credentials');
    for (const adapter of [pagbankProvider(), stripeProvider()]) {
      expect(adapter.oauth).toBeDefined();
    }
  });

  it('card stub declines on the magic -declined token suffix', async () => {
    const snapshot = await stoneProvider().createCharge(
      cardInput('order-9', 'tok-declined'),
      STUB_CREDS,
    );
    expect(snapshot.status).toBe('DECLINED');
  });
});

describe('stripe webhook signature verification', () => {
  const secret = 'whsec_test_secret';
  const creds = { environment: 'SANDBOX' as const, fields: { webhookSecret: secret } };
  const rawBody = JSON.stringify({ eventId: 'evt_1' });

  function sign(body: string, timestamp: string, key = secret): string {
    const mac = createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${mac}`;
  }

  it('accepts a correctly signed delivery', async () => {
    const verified = await stripeProvider().webhook.verify(
      {
        provider: 'stripe',
        rawBody,
        headers: { 'stripe-signature': sign(rawBody, '1700000000') },
      },
      creds,
    );
    expect(verified).toBe(true);
  });

  it('rejects a tampered body, a wrong key, and a missing header', async () => {
    const adapter = stripeProvider();
    await expect(
      adapter.webhook.verify(
        {
          provider: 'stripe',
          rawBody: rawBody + ' ',
          headers: { 'stripe-signature': sign(rawBody, '1700000000') },
        },
        creds,
      ),
    ).resolves.toBe(false);
    await expect(
      adapter.webhook.verify(
        {
          provider: 'stripe',
          rawBody,
          headers: { 'stripe-signature': sign(rawBody, '1700000000', 'whsec_other') },
        },
        creds,
      ),
    ).resolves.toBe(false);
    await expect(
      adapter.webhook.verify({ provider: 'stripe', rawBody, headers: {} }, creds),
    ).resolves.toBe(false);
  });
});
