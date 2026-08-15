import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';


import { WebhookVerificationError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import type { SetupProgress, WebhookDelivery } from '../core/types';
import { guardedWebhook, json } from '../http/responses';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { defineProviders } from '../core/registry';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { sha256Hex } from '../providers/shared';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { STUB_CREDS, TENANT, cardInput, pixInput } from './fixtures';
/**
 * The platform name every guide in this suite renders under.
 *
 * Deliberately NOT the name of any real adopter. `SetupGuideContext.brandName`
 * exists because two guides addressed the platform by one adopter's product
 * name in shipped pt-BR copy; a suite feeding those guides that same name back
 * would assert the seam exists while proving nothing about whether it is used.
 * A stranger's brand here makes the assertion below fail the moment a guide
 * hardcodes anybody's.
 */
const HOST_BRAND = 'Quitanda Digital';


/** Stripe's HMAC over `<t>.<body>`, keyed by an endpoint secret. */
function stripeMac(body: string, timestamp: string, key: string): string {
  return createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
}

/** A delivery signed the way Stripe signs it. */
function stripeSigned(body: string, timestamp: string, key: string): WebhookDelivery {
  return {
    provider: 'stripe',
    rawBody: body,
    headers: { 'stripe-signature': `t=${timestamp},v1=${stripeMac(body, timestamp, key)}` },
  };
}

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
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/api/webhooks/x', publicKeyUrl: 'https://host.example/pk' };
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
   * NO GUIDE MAY NAME AN ADOPTER (FUT-760/761).
   *
   * Two of these guides used to address the platform by the origin host's own
   * brand name ("o <brand>…") in the middle of a pt-BR instruction, so every
   * host installing this package shipped one particular storefront's brand to
   * its own store owners — in copy, not in a comment. `brandName` is the seam that fixed it, and this is
   * the assertion that keeps it fixed: render every guide under a brand no
   * adopter uses, then require that the rendered text says THAT and contains
   * no known adopter's name.
   *
   * Checking `toContain(HOST_BRAND)` alone would not hold the line — a guide
   * could interpolate the brand once and still hardcode another somewhere
   * else, which is exactly the state this replaces.
   */
  it('renders the HOST platform brand, and no adopter of this package', () => {
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/w' };
    const branded = [stoneProvider(), infinitePayProvider()];
    for (const adapter of branded) {
      const text = JSON.stringify(adapter.setupGuide?.(ctx));
      expect(text).toContain(HOST_BRAND);
      expect(text).not.toMatch(/future[\s_-]?pay|paladira/i);
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
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/api/webhooks/x' };
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
    }) => infinitePayProvider().setupGuide?.({ brandName: HOST_BRAND, webhookUrl: 'https://host.example/w', progress });

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

  /**
   * ── The guide shape invariant ──────────────────────────────────────────────
   *
   * Asserted for EVERY guide, because this defect has now shipped three times
   * in three spellings and each one was found by a store owner, not by CI.
   *
   * A walkthrough renders ONE section: the one paired with the stage the store
   * is on. Two rules follow, and they pull against each other — which is why
   * both belong in a single test rather than one each:
   *
   *  - **No section may be unpaired with a stage.** Nothing can ever select it,
   *    so its content is dead. Stripe shipped a `webhook` section no stage
   *    pointed at, and a store's own notification URL was unreachable from
   *    every state (FUT-691).
   *  - **The LAST stage may not carry a section.** That slot belongs to the
   *    host's activation card, which appears only once the guide has run out of
   *    sections. Stripe (FUT-799) and Stone (FUT-800) both paired it, and for a
   *    provider declaring `activationCharge` the result is not cosmetic: that
   *    card is the only control that stamps `chargeVerifiedAt`, `proofMissing`
   *    refuses to enable without it, and no store could be switched on at all.
   *
   * Fixing the first by pairing every stage 1:1 is what caused the second. A
   * test pinning one direction and not the other defends the bug.
   */
  it('no guide ships an unpaired section, nor a section on its last stage', () => {
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/api/webhooks/x' };
    for (const adapter of [stoneProvider(), infinitePayProvider(), stripeProvider()]) {
      const guide = adapter.setupGuide?.(ctx);
      const stageIds = guide?.stages.map((s) => s.id) ?? [];
      const sectionIds = guide?.sections.map((s) => s.id) ?? [];

      expect(sectionIds.filter((id) => !stageIds.includes(id))).toEqual([]);
      expect(sectionIds).not.toContain(stageIds.at(-1));
    }
  });

  /**
   * A `credentialsPath` variant must MIRROR the guide it varies.
   *
   * The host resolves the activation card's `blocked` and `hidden` from the
   * base guide alone — that happens in `PaymentProviderSettings`, before the
   * panel knows which disclosure is open, and it is what keeps one screen's
   * step 3 in agreement with the walkthrough above it. A variant with a
   * different stage count, or with the owner-confirmable section at a different
   * index, silently desyncs the two: the walkthrough would show one step while
   * the card computed its state from another.
   *
   * The variant is free to differ in every way that does not move those — the
   * whole point is that step 1 and the webhook wording DO differ. This pins
   * only the shape, and it runs over every shipped adapter so the next provider
   * to add a variant is held to it without anyone remembering to.
   */
  it('every credentialsPath variant mirrors its base guide shape', () => {
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/api/webhooks/x' };
    const confirmableIndex = (guide: {
      stages: readonly { id: string }[];
      sections: readonly { id: string; steps: readonly { action?: string }[] }[];
    }) =>
      guide.stages.findIndex((stage) => {
        const section = guide.sections.find((candidate) => candidate.id === stage.id);
        return section?.steps.some((step) => step.action === 'checkout-integrado-confirmado');
      });

    // Derived, not counted: a mutable tally inside the loop is shared state the
    // flakiness gate refuses, and the pair is what each assertion needs anyway.
    const pairs = [stoneProvider(), infinitePayProvider(), stripeProvider()]
      .map((adapter) => adapter.setupGuide?.(ctx))
      .filter((guide) => guide?.credentialsPath !== undefined)
      .map((guide) => ({ guide: guide!, variant: guide!.credentialsPath! }));

    // A silent zero-iteration loop proves nothing — stripe ships one today.
    expect(pairs.length).toBeGreaterThan(0);

    for (const { guide, variant } of pairs) {
      expect(variant.stages).toHaveLength(guide.stages.length);
      expect(confirmableIndex(variant)).toBe(confirmableIndex(guide));
      // And the variant is a guide in its own right: the two rules above hold
      // for it too, or its activation card has nowhere to render either.
      const stageIds = variant.stages.map((s) => s.id);
      const sectionIds = variant.sections.map((s) => s.id);
      expect(sectionIds.filter((id) => !stageIds.includes(id))).toEqual([]);
      expect(sectionIds).not.toContain(stageIds.at(-1));
    }
  });

  /**
   * The other half of the deadlock, and the half a shape check cannot see: a
   * guide has to REACH its empty stage under its own steam.
   *
   * Stripe's `activeStageOf` returned 0, 2 or `stages.length` and never 3, so a
   * connected store sat on a middle stage only `proven` could leave — while
   * `proven` is stamped by the charge living on the stage it never reached
   * (FUT-799). Stone answered with no `activeStage` at all, pinning the stepper
   * on step 1 over a store that had done every step (FUT-800). Neither shows up
   * in the stages/sections arrays; both are fatal the same way.
   *
   * The renderer clamps BACK to an owner-confirmable section by itself
   * (`effectiveStage`), so reporting the last stage here is not a claim that the
   * store is finished — it is what lets the walkthrough finish at all.
   */
  it('every provable guide reaches its empty last stage once connected', () => {
    const at = (adapter: PaymentProviderAdapter, progress: SetupProgress) =>
      adapter.setupGuide?.({ brandName: HOST_BRAND, webhookUrl: 'https://host.example/w', progress });

    for (const adapter of [stoneProvider(), infinitePayProvider(), stripeProvider()]) {
      // Only a provider that CAN prove itself by charging is held to this: the
      // empty stage is reserved for the activation card.
      expect(adapter.capabilities.activationCharge).toBe(true);

      const fresh = at(adapter, { configured: {}, connected: false, proven: false });
      expect(fresh?.activeStage).toBe(0);

      const connected = at(adapter, { configured: {}, connected: true, proven: false });
      expect(connected?.activeStage).toBe((connected?.stages.length ?? 0) - 1);

      // Charged: past the last stage, so every step reads as complete.
      const proven = at(adapter, { configured: {}, connected: true, proven: true });
      expect(proven?.activeStage).toBe(proven?.stages.length);
    }
  });

  /**
   * A stage the owner can only leave by saying so needs a button that names
   * what they are agreeing to. The label was a constant in the renderer —
   * InfinitePay's "Já habilitei o Checkout Integrado" — which names another
   * vendor's product on Stripe's and Stone's screens (FUT-799).
   */
  it('a confirmable section authors its own confirm label, per vendor', () => {
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/w' };
    const asking = (adapter: PaymentProviderAdapter) =>
      adapter.setupGuide?.(ctx)?.sections.find((section) =>
        section.steps.some((step) => step.action === 'checkout-integrado-confirmado'),
      );

    for (const adapter of [stoneProvider(), stripeProvider()]) {
      const label = asking(adapter)?.confirmLabel;
      expect(label).toBeTruthy();
      expect(label).not.toContain('Checkout Integrado');
    }
    // InfinitePay authors none, so the renderer's fallback leaves its guide
    // exactly as it shipped — the one screen that constant was written for.
    expect(asking(infinitePayProvider())?.confirmLabel).toBeUndefined();
  });

  /**
   * Stripe's two dashboard stages collapsed into one: `methods` and `webhook`
   * both happen on Stripe's own screens and no API can tell them apart, so no
   * fact could ever have advanced the walkthrough between them — and with a
   * connected store sent straight to `webhook`, `methods` was unreachable too
   * (FUT-799).
   */
  it('stripe asks for one visit to the dashboard, carrying the notification URL', () => {
    const ctx = { brandName: HOST_BRAND, webhookUrl: 'https://host.example/api/webhooks/x' };
    const guide = stripeProvider().setupGuide?.(ctx);

    expect(guide?.stages.map((s) => s.id)).toEqual(['connect', 'dashboard', 'activate']);
    expect(guide?.sections.map((s) => s.id)).toEqual(['connect', 'dashboard']);

    const dashboard = guide?.sections.find((s) => s.id === 'dashboard');
    expect(JSON.stringify(dashboard)).toContain(ctx.webhookUrl);
    // Named in the step's own sentence, not only in the copy button's label —
    // that label reaches screen readers alone (`CopyRow`).
    expect(dashboard?.steps.some((step) => step.text?.includes('URL de notificação'))).toBe(true);
    // A host that reports no progress gets no stage claim — renders as step 1.
    expect(guide?.activeStage).toBeUndefined();
  });

  /**
   * The manual path is not a second-class citizen: a store pasting its own
   * `sk_`/`pk_` walks the same three stages, so the connect section has to say
   * where that door is (FUT-796). Every credential field is optional precisely
   * so either mode satisfies the schema.
   */
  it('stripe points a store at the manual-credentials path too', () => {
    const guide = stripeProvider().setupGuide?.({ brandName: HOST_BRAND, webhookUrl: 'https://host.example/w' });

    expect(guide?.sections.find((s) => s.id === 'connect')?.intro).toContain(
      'credenciais manualmente',
    );
    expect(stripeProvider().credentialSchema.every((field) => !field.required)).toBe(true);
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

  it('given an endpoint-secret roll, when the header carries the new and the old v1, then the store holding the old secret still accepts', async () => {
    // During a roll Stripe signs with BOTH secrets: `t=…,v1=A,v1=B`. A parse
    // that keeps only the last `v1` refuses every delivery for the whole roll.
    const rolled = {
      provider: 'stripe' as const,
      rawBody,
      headers: {
        'stripe-signature':
          `t=1700000000,v1=${stripeMac(rawBody, '1700000000', 'whsec_new_secret')}` +
          `,v1=${stripeMac(rawBody, '1700000000', secret)}`,
      },
    };
    await expect(stripeProvider().webhook.verify(rolled, creds)).resolves.toBe(true);
  });

  it('given a rotated platform secret, when the stored copy is stale and platformWebhookSecret is stamped current, then the delivery verifies', async () => {
    const stamped = {
      environment: 'SANDBOX' as const,
      fields: { webhookSecret: 'whsec_stale_connect_copy', platformWebhookSecret: secret },
    };
    await expect(
      stripeProvider().webhook.verify(stripeSigned(rawBody, '1700000000', secret), stamped),
    ).resolves.toBe(true);
    // And a delivery still signed by the merchant's own copy keeps verifying
    // beside the stamp — both secrets authenticate through the roll.
    await expect(
      stripeProvider().webhook.verify(
        stripeSigned(rawBody, '1700000000', 'whsec_stale_connect_copy'),
        stamped,
      ),
    ).resolves.toBe(true);
  });

  it("given store B's credentials, when store A's signed delivery arrives, then the account mismatch is refused", async () => {
    // Connect stores share the platform's endpoint secret, so the signature
    // alone cannot tell the stores apart — the body's `account` must agree
    // with the credentials the URL slug resolved.
    const storeA = JSON.stringify({ id: 'evt_1', account: 'acct_A', type: 'other' });
    const storeB = {
      environment: 'SANDBOX' as const,
      fields: { webhookSecret: secret, stripeUserId: 'acct_B' },
    };
    await expect(
      stripeProvider().webhook.verify(stripeSigned(storeA, '1700000000', secret), storeB),
    ).resolves.toBe(false);
  });

  /**
   * The same guard, on a store that pasted its own keys (FUT-796).
   *
   * One concept, two field names: OAuth stores it as `stripeUserId`, the
   * credential form as `connectedAccountId`. The guard read only the first, so
   * a pasted-key store skipped the account check even when its owner had filled
   * the `acct_` field in — the fact was on record and nothing consulted it.
   */
  it("given a pasted-key store's connectedAccountId, when another account's delivery arrives, then it is refused", async () => {
    const otherAccount = JSON.stringify({ id: 'evt_1', account: 'acct_A', type: 'other' });
    const pastedKeys = {
      environment: 'SANDBOX' as const,
      fields: { webhookSecret: secret, connectedAccountId: 'acct_B' },
    };
    await expect(
      stripeProvider().webhook.verify(stripeSigned(otherAccount, '1700000000', secret), pastedKeys),
    ).resolves.toBe(false);

    // Its own account still arrives home.
    const own = JSON.stringify({ id: 'evt_1', account: 'acct_B', type: 'other' });
    await expect(
      stripeProvider().webhook.verify(stripeSigned(own, '1700000000', secret), pastedKeys),
    ).resolves.toBe(true);
  });

  it('given a delivery naming no account, when the credentials carry a stripeUserId, then it still verifies', async () => {
    // Fail open on MISSING metadata (platform-account events carry no
    // `account`), closed only on contradiction.
    const storeB = {
      environment: 'SANDBOX' as const,
      fields: { webhookSecret: secret, stripeUserId: 'acct_B' },
    };
    await expect(
      stripeProvider().webhook.verify(stripeSigned(rawBody, '1700000000', secret), storeB),
    ).resolves.toBe(true);
    // And a delivery naming the credentialed account itself is at home.
    const own = JSON.stringify({ id: 'evt_1', account: 'acct_B', type: 'other' });
    await expect(
      stripeProvider().webhook.verify(stripeSigned(own, '1700000000', secret), storeB),
    ).resolves.toBe(true);
  });

  it('given SANDBOX credentials, when a signed delivery claims livemode, then the contradiction is refused', async () => {
    const liveBody = JSON.stringify({ id: 'evt_1', livemode: true, type: 'other' });
    await expect(
      stripeProvider().webhook.verify(stripeSigned(liveBody, '1700000000', secret), creds),
    ).resolves.toBe(false);
    // The agreeing environment verifies, and a body naming no livemode at
    // all is never held to one.
    const production = { environment: 'PRODUCTION' as const, fields: { webhookSecret: secret } };
    await expect(
      stripeProvider().webhook.verify(stripeSigned(liveBody, '1700000000', secret), production),
    ).resolves.toBe(true);
    await expect(
      stripeProvider().webhook.verify(stripeSigned(rawBody, '1700000000', secret), production),
    ).resolves.toBe(true);
  });

  it('given a signed body with no event id, when parsed, then eventId falls back to the body hash instead of an empty string', async () => {
    // '' would collide on the inbox's unique index: the second anonymous
    // delivery reads as a duplicate of the first and is silently swallowed.
    const anonymous = JSON.stringify({ type: 'some.event' });
    const [event] = await stripeProvider().webhook.parse(
      { provider: 'stripe', rawBody: anonymous, headers: {} },
      creds,
    );
    expect(event?.eventId).toBe(sha256Hex(anonymous));
    expect(event?.type).toBe('UNKNOWN');
  });

  it('given a signed but malformed body, when parsed, then the refusal is the retryable 400 shape rather than an escaping SyntaxError', async () => {
    const malformed = stripeSigned('{"id":"evt_1","type":', '1700000000', secret);
    // Wrapped in the very guard the webhook route runs under: a
    // `PaymentsError` becomes the 400 every provider redelivers on, where a
    // bare `SyntaxError` escaped as a 500 about our server.
    const res = await guardedWebhook(async () => {
      await stripeProvider().webhook.parse(malformed, creds);
      return json({ processed: 0 });
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'ProviderRequestError' });
  });
});

describe('stripe intake freshness (FUT-690)', () => {
  const secret = 'whsec_test_secret';
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'other' });
  /** `t=1700000000`, as the clock reads it. */
  const SIGNED_AT_MS = 1_700_000_000_000;
  const MINUTE_MS = 60_000;

  it('given a delivery inside the five-minute window, when intake checks freshness, then it passes', () => {
    const delivery = stripeSigned(rawBody, '1700000000', secret);
    expect(stripeProvider().webhook.intakeFreshness?.(delivery, SIGNED_AT_MS + 4 * MINUTE_MS)).toEqual(
      { fresh: true },
    );
  });

  it('given a delivery signed longer than five minutes ago, when intake checks freshness, then it is refused with a reason', () => {
    const delivery = stripeSigned(rawBody, '1700000000', secret);
    expect(
      stripeProvider().webhook.intakeFreshness?.(delivery, SIGNED_AT_MS + 6 * MINUTE_MS),
    ).toMatchObject({ fresh: false, reason: expect.stringContaining('tolerance') });
  });

  it('given no signature header at all (a stub delivery), then freshness passes and verify still decides', () => {
    const bare = { provider: 'stripe' as const, rawBody, headers: {} };
    expect(stripeProvider().webhook.intakeFreshness?.(bare, SIGNED_AT_MS)).toEqual({ fresh: true });
  });
});

/**
 * The FUT-690 design constraint, end to end: the skew window binds the LIVE
 * intake path only. The replay sweep re-runs `adapter.webhook.verify` over
 * rows the inbox stored hours earlier and must keep succeeding forever
 * (`core/webhook-replay.ts`), so the very delivery intake refuses as stale
 * must still re-verify once it is a stored row.
 */
describe('stripe stale deliveries: refused at intake, replayable from the inbox', () => {
  const secret = 'whsec_test_secret';
  const rawBody = JSON.stringify({ id: 'evt_1', type: 'payment_intent.created' });

  function stripeWorld() {
    const credentials = createMemoryCredentialStore();
    const webhooks = createMemoryWebhookInbox();
    const gateway = createPaymentsGateway({
      providers: defineProviders({ stripe: stripeProvider() } as const),
      credentials,
      charges: createMemoryChargeStore(),
      webhooks,
      attempts: createMemoryAttemptLedger(),
    });
    credentials.set(TENANT, 'stripe', {
      environment: 'PRODUCTION',
      fields: { webhookSecret: secret },
    });
    return { gateway, webhooks };
  }

  it('given a delivery signed far outside the tolerance, when it reaches live intake, then it is refused fail-closed like a bad signature', async () => {
    const world = stripeWorld();

    // `t=1700000000` is years before any real clock this test runs under.
    await expect(
      world.gateway.handleWebhook(TENANT, stripeSigned(rawBody, '1700000000', secret)),
    ).rejects.toThrow(WebhookVerificationError);
    // Refused BEFORE the inbox, exactly as a bad signature is: no row.
    expect(Object.keys(world.webhooks.statuses())).toHaveLength(0);
  });

  it('given the same stale-signed delivery already stored as a row, when the replay sweep runs hours later, then it re-verifies and processes', async () => {
    const world = stripeWorld();
    const delivery = stripeSigned(rawBody, '1700000000', secret);
    const { id } = await world.webhooks.record(TENANT, delivery, 'evt_1');
    world.webhooks.backdate(id, new Date('2026-07-27T02:00:00Z'));

    const report = await world.gateway.replayWebhooks({ now: new Date('2026-07-27T12:00:00Z') });

    expect(report).toMatchObject({ attempted: 1, processed: 1, failed: 0 });
    expect(world.webhooks.statuses()[id]).toBe('PROCESSED');
  });

  it('given a freshly signed delivery, when it reaches live intake, then it is accepted end to end', async () => {
    vi.useFakeTimers();
    try {
      const nowMs = Date.parse('2026-07-27T12:00:00Z');
      vi.setSystemTime(nowMs);
      const world = stripeWorld();

      const timestamp = String(Math.floor(nowMs / 1000) - 60);
      const events = await world.gateway.handleWebhook(
        TENANT,
        stripeSigned(rawBody, timestamp, secret),
      );

      expect(events).toHaveLength(1);
      expect(Object.values(world.webhooks.statuses())).toEqual(['PROCESSED']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('given a fresh signed but malformed body, when it flows through the pipeline under the webhook guard, then the answer is the retryable 400', async () => {
    vi.useFakeTimers();
    try {
      const nowMs = Date.parse('2026-07-27T12:00:00Z');
      vi.setSystemTime(nowMs);
      const world = stripeWorld();

      const timestamp = String(Math.floor(nowMs / 1000));
      const res = await guardedWebhook(async () => {
        await world.gateway.handleWebhook(
          TENANT,
          stripeSigned('{"id":"evt_1",', timestamp, secret),
        );
        return json({ processed: 0 });
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: 'ProviderRequestError' });
      // Verified but unparseable: nothing was applied.
      expect(Object.values(world.webhooks.statuses())).not.toContain('PROCESSED');
    } finally {
      vi.useRealTimers();
    }
  });
});
