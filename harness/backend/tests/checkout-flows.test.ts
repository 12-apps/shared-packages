import {
  CHECKOUT_ROUTES,
  attemptReference,
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  createMemoryWebhookInbox,
  createPaymentFlowsBE,
  createPaymentsGateway,
  defineProviders,
  ownsReference,
  type ChargeInput,
  type ChargeSnapshot,
  type CheckoutCopy,
  type MerchantRef,
  type Money,
  type Payable,
  type PaymentProviderAdapter,
} from '@12-apps/payments-backend';
import { describe, expect, it } from 'vitest';

/**
 * THE BUYER-CHECKOUT MOUNT, against the PUBLISHED tarball (FUT-740).
 *
 * `createPaymentFlowsBE` moves ~1,500 lines of money rules out of whichever host
 * wrote them and into this package — per-attempt idempotency keys, the `--`
 * attempt reference, charge-identity fail-closed, PIX re-tap reuse, the REDIRECT
 * commit-on-mint rule and the captured-amount rule. A host adopting it is
 * deleting its own copies of all of them, so what matters is not that they work
 * in `packages/` but that they work through the door a consumer comes in.
 *
 * Everything here is imported from the installed tarball, with no aliases, and
 * the two adapters are hand-written and called `alpha` and `beta` — so a vendor
 * name leaking into a buyer-facing body is detectable by string search.
 */

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'harness-merchant' };
const REF = 'inv_2024_0043';
const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });

interface AdapterOptions {
  hosted?: boolean;
  refuses?: boolean;
  /** Collects every `ChargeInput` the gateway handed this adapter. */
  seen?: ChargeInput[];
}

/** The smallest adapter the gateway will accept. No vendor anywhere in it. */
function harnessAdapter(name: string, options: AdapterOptions = {}): PaymentProviderAdapter {
  const chargeId = (reference: string): string => `stub_${name}_${reference}`;
  return {
    name,
    displayName: name,
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: options.hosted ? 'REDIRECT' : 'PUBLIC_KEY',
    },
    credentialSchema: [{ key: 'secretKey', label: 'Secret', secret: true, required: true }],
    async verifyCredentials() {
      return { ok: true };
    },
    async createCharge(input) {
      options.seen?.push(input);
      if (options.refuses) {
        // Provably pre-send, so the walk is entitled to advance past it.
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const base: ChargeSnapshot = {
        provider: name,
        providerChargeId: chargeId(input.reference),
        reference: input.reference,
        status: 'PENDING',
        amount: input.amount,
        method: input.method,
      };
      if (options.hosted) {
        return { ...base, hostedCheckoutUrl: `https://${name}.example/pay/${base.providerChargeId}` };
      }
      if (input.method === 'CARD') return { ...base, status: 'PAID', card: { last4: '4242' } };
      return { ...base, pix: { qrText: `qr:${base.providerChargeId}` } };
    },
    async getCharge(providerChargeId) {
      return {
        provider: name,
        providerChargeId,
        status: 'PENDING',
        amount: BRL(0),
        method: 'PIX',
      };
    },
    webhook: {
      async verify() {
        return { provider: name, eventId: 'evt', type: 'UNKNOWN' };
      },
    },
    clientConfig: () => ({
      provider: name,
      tokenization: options.hosted ? 'REDIRECT' : 'PUBLIC_KEY',
    }),
  };
}

/** Machine-readable sentinels — the RULE is what is under test, not the prose. */
const copy: CheckoutCopy = {
  notConfigured: 'notConfigured',
  chainExhausted: (method) => `chainExhausted.${method}`,
  unresolvedCharge: 'unresolvedCharge',
  chargeMismatch: 'chargeMismatch',
  instrumentNotUsableHere: 'instrumentNotUsableHere',
  payableNotFound: 'payableNotFound',
  buyerFieldMissing: (fields) => `missing.${[...fields].join('+')}`,
  buyerFieldInvalid: (field) => `invalid.${field}`,
  fieldNameOf: (field) => (field === 'taxId' ? 'cpf' : field),
  genericProviderRefusal: 'generic',
};

function setup(chain: readonly PaymentProviderAdapter[], method: 'PIX' | 'CARD' = 'PIX') {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const connections = createMemoryProviderConfigStore();
  const gateway = createPaymentsGateway({
    providers: defineProviders(Object.fromEntries(chain.map((a) => [a.name, a]))),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
  for (const adapter of chain) {
    credentials.set(MERCHANT, adapter.name, { environment: 'SANDBOX', fields: {}, stub: true });
  }

  // An INVOICE, not an order. If this fixture ever needs a line item, a cart or
  // a status vocabulary, `PayablePort` has become an order in disguise.
  const world = {
    payable: {
      ref: REF,
      merchant: MERCHANT,
      amount: BRL(7500),
      method,
      customer: { name: 'Ana Buyer', email: 'ana@example.com', taxId: '12345678909' },
      state: 'OPEN',
    } satisfies Payable as Payable,
  };
  const written: { pending: number; settled: Money[] } = { pending: 0, settled: [] };

  const routes = createPaymentFlowsBE<{ id: string }, { invoice: string }>({
    gateway,
    charges,
    credentials,
    connections,
    requireAuth: () => ({ id: 'buyer-1' }),
    resolveMerchant: () => MERCHANT,
    payables: {
      load: async (_caller, ref) => (ref === REF ? world.payable : null),
      create: async () => ({ payable: world.payable, view: { invoice: REF } }),
      view: async () => ({ invoice: REF }),
      stateToken: (payable) => payable.state,
    },
    correlation: {
      attachPending: async () => {
        written.pending += 1;
      },
      recordCardOutcome: async ({ approved }) => (approved ? 'SETTLED' : 'CLOSED'),
      settle: async ({ capturedAmount }) => {
        written.settled.push(capturedAmount);
        return 'SETTLED';
      },
    },
    copy,
  });
  return { routes, charges, written };
}

async function call(
  routes: ReturnType<typeof setup>['routes'],
  method: 'GET' | 'POST',
  target: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const [pathname = '', query] = target.split('?');
  const url = `https://shop.example/api/checkout${pathname}${query ? `?${query}` : ''}`;
  const request = new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  const response = await routes[method](request, {
    params: { segments: pathname.split('/').filter(Boolean) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

describe('@12-apps/payments-backend — the published buyer-checkout mount', () => {
  it('publishes the six-row table, and 404s anything outside it', async () => {
    expect(CHECKOUT_ROUTES.map((row) => row.kind)).toEqual([
      'getCheckoutConfig',
      'listInstruments',
      'createCheckout',
      'chargeInstrument',
      'getStatus',
      'refreshBrowserKey',
    ]);
    const { routes } = setup([harnessAdapter('alpha')]);
    expect((await call(routes, 'GET', '/nope')).status).toBe(404);
  });

  it('charges the payable\'s own amount, under its own reference and key', async () => {
    const { routes, charges: store } = setup([harnessAdapter('alpha')], 'CARD');
    await call(routes, 'POST', '/charge', {
      orderId: REF,
      amount: BRL(1),
      reference: 'someone-elses',
      idempotencyKey: 'attacker-chosen',
      card: { token: 'tok_ok' },
    });
    const [stored] = store.all();
    expect(stored?.snapshot.amount).toEqual(BRL(7500));
    expect(stored?.reference).toBe(REF);
    expect(stored?.idempotencyKey).toBe(`${REF}:0`);
  });

  it('commits the walk when a REDIRECT provider mints a link, across requests', async () => {
    const { routes, charges: store } = setup([harnessAdapter('alpha', { hosted: true })]);
    const first = await call(routes, 'POST', '/', {});
    const second = await call(routes, 'POST', '/', {});

    const url = (first.body.data as Record<string, unknown>).hostedCheckoutUrl;
    expect(typeof url).toBe('string');
    expect((second.body.data as Record<string, unknown>).hostedCheckoutUrl).toBe(url);
    expect(store.all()).toHaveLength(1);
  });

  it('still advances past a REDIRECT head that refuses before minting anything', async () => {
    const { routes, charges: store } = setup([
      harnessAdapter('alpha', { hosted: true, refuses: true }),
      harnessAdapter('beta'),
    ]);
    expect((await call(routes, 'POST', '/', {})).status).toBe(200);
    expect(store.all()[0]?.provider).toBe('beta');
  });

  it('reuses a live PIX code rather than minting a second payable one', async () => {
    const { routes, charges: store } = setup([harnessAdapter('alpha')]);
    await call(routes, 'POST', '/', {});
    await call(routes, 'POST', '/', {});
    expect(store.all()).toHaveLength(1);
  });

  it('words an exhausted chain once, by method, naming no provider', async () => {
    const { routes } = setup(
      [harnessAdapter('alpha', { refuses: true }), harnessAdapter('beta', { refuses: true })],
      'CARD',
    );
    const { status, body } = await call(routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });
    expect(status).toBe(502);
    expect(body.code).toBe('PAYMENT_UNAVAILABLE');
    expect(body.error).toBe('chainExhausted.CARD');
    expect(JSON.stringify(body)).not.toMatch(/alpha|beta/);
  });

  it('answers 404 for a handle this caller cannot load', async () => {
    const { routes } = setup([harnessAdapter('alpha')]);
    const { status, body } = await call(routes, 'GET', '/status?orderId=someone-elses');
    expect(status).toBe(404);
    expect(body.code).toBe('PAYABLE_NOT_FOUND');
  });

  it('reads the instrument and the CPF off the FLAT body the shipped client posts', async () => {
    // `@12-apps/payments-frontend`'s `chargeCard` posts `{ orderId, token,
    // tokensByProvider, saveCard, cardMeta, taxId }` and is already in
    // browsers. A mount that only understood a nested `card` block was handed
    // no instrument at all by every one of them.
    const seen: ChargeInput[] = [];
    const { routes } = setup([harnessAdapter('alpha', { seen })], 'CARD');

    const charged = await call(routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_from_the_browser',
      tokensByProvider: { alpha: 'tok_alpha' },
      saveCard: false,
      taxId: '98765432100',
    });

    expect(charged.status).toBe(200);
    expect(seen[0]?.card?.tokensByProvider).toEqual({ alpha: 'tok_alpha' });
    // Collected at the payment step and merged OVER what the payable knew — a
    // host's own row may have nowhere to keep a CPF.
    expect(seen[0]?.customer?.taxId).toBe('98765432100');
  });

  it('refuses a card charge against a payable the buyer is paying by PIX', async () => {
    const { routes, charges: store } = setup([harnessAdapter('alpha')], 'PIX');
    await call(routes, 'POST', '/', {});

    const charged = await call(routes, 'POST', '/charge', {
      orderId: REF,
      token: 'tok_from_the_browser',
    });

    // Settling the payable here would leave the live QR scannable and still
    // chargeable — two payable codes for one payable.
    expect(charged.status).toBe(404);
    expect(charged.body.code).toBe('PAYABLE_NOT_FOUND');
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.snapshot.status).toBe('PENDING');
  });

  it('keeps attempt 0 on the bare handle, and refuses a prefix neighbour', () => {
    // The two on-disk compatibility pins: every charge already stored carries
    // the bare reference, and a bare `startsWith` would reach another payable.
    expect(attemptReference(REF, 0)).toBe(REF);
    expect(attemptReference(REF, 1)).toBe(`${REF}--1`);
    expect(ownsReference('abc', 'abc--1')).toBe(true);
    expect(ownsReference('abc', 'abcd')).toBe(false);
  });
});
