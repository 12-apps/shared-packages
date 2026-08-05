import { describe, expect, it } from 'vitest';

import { NoProviderSucceededError, ProviderRequestError } from '../core/errors';
import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import type { ChargeInput, ChargeSnapshot, ClientTokenization } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  type MemoryAttemptLedger,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { STUB_CHARGE_FAULT_FIELD, applyStubChargeFault } from '../providers/stub-fault';
import { STUB_CREDS, TENANT, cardInput, pixInput } from './fixtures';

/**
 * A HOSTED-CHECKOUT (REDIRECT) provider inside a failover chain (FUT-563).
 *
 * ## The decision this file pins
 *
 * A REDIRECT provider settles on its OWN page, so it cannot be failed over once
 * the buyer has left: the link is payable from the moment it is minted, and
 * charging somewhere else afterwards would be a second payable charge for one
 * order — on the one path with no probe to disprove it, since the buyer's
 * report of a failed return is not the provider's answer.
 *
 * So the rule is: **a REDIRECT provider is attempted only while the walk can
 * still advance — entirely server-side, BEFORE the link exists. The moment a
 * link is minted, the walk is COMMITTED.**
 *
 * Both positions matter and both are asserted here, because they fail in
 * opposite directions:
 *
 *   HEAD  a redirect provider that fails BEFORE minting must not end the walk
 *         (a store whose first acquirer is down would take no money at all);
 *         and one that DOES mint must end it (the alternative is a double
 *         charge).
 *   TAIL  a redirect provider reached after a proven-safe failure must be
 *         attempted normally, and its link must be what the caller gets —
 *         even though the charge started at a provider that would have
 *         answered with a QR instead.
 *
 * The prose half of this decision lives on `apps/web/app/api/checkout/charge/
 * route.ts` and in the `cadeia-de-provedores` Gherkin journey.
 */

interface Spy {
  chargeCalls: string[];
  /** The card token each attempt actually received, in order. */
  tokens: (string | undefined)[];
}

/** A provider that mints a hosted page instead of an instrument-based charge. */
function redirectProvider(
  name: string,
  script: { fails?: () => Error } = {},
): { adapter: PaymentProviderAdapter; spy: Spy } {
  return provider(name, 'REDIRECT', script, (input) => ({
    provider: name,
    providerChargeId: `${name}_${input.reference}`,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
    hostedCheckoutUrl: `https://${name}.example.invalid/pay/${input.reference}`,
  }));
}

/** An ordinary card acquirer — tokenizes in the browser, charges an instrument. */
function cardProvider(
  name: string,
  script: { fails?: () => Error } = {},
): { adapter: PaymentProviderAdapter; spy: Spy } {
  return provider(name, 'PUBLIC_KEY', script, (input) => ({
    provider: name,
    providerChargeId: `${name}_${input.reference}`,
    status: 'PAID',
    amount: input.amount,
    method: input.method,
  }));
}

/**
 * A CARD charge carrying one instrument per provider — the wire shape the
 * storefront sends once the store has a chain (`tokensByProvider`, FUT-563).
 * The bare `token` is deliberately absent: an unattributed one defaults to the
 * chain HEAD, which is what the map exists to stop.
 */
function chainCardInput(tokensByProvider: Record<string, string>): ChargeInput {
  return { ...cardInput(), card: { tokensByProvider } };
}

/** An ordinary provider that answers a PIX charge with a payload of its own. */
function pixProvider(
  name: string,
  script: { fails?: () => Error } = {},
): { adapter: PaymentProviderAdapter; spy: Spy } {
  return provider(name, 'PUBLIC_KEY', script, (input) => ({
    provider: name,
    providerChargeId: `${name}_${input.reference}`,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
    pix: { qrText: `qr-${name}` },
  }));
}

function provider(
  name: string,
  tokenization: ClientTokenization,
  script: { fails?: () => Error },
  snapshot: (input: ChargeInput) => ChargeSnapshot,
): { adapter: PaymentProviderAdapter; spy: Spy } {
  const spy: Spy = { chargeCalls: [], tokens: [] };
  const adapter: PaymentProviderAdapter = {
    name,
    displayName: name,
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization,
    },
    credentialSchema: [],
    verifyCredentials: async () => ({ ok: true }),
    createCharge: async (input) => {
      spy.chargeCalls.push(input.reference);
      spy.tokens.push(input.card?.token);
      if (script.fails) throw script.fails();
      return snapshot(input);
    },
    getCharge: async (id) => snapshot({ ...pixInput(), reference: id }),
    webhook: { verify: async () => true, parse: async () => [] },
    clientConfig: () => ({ provider: name, tokenization }),
  };
  return { adapter, spy };
}

/** A refusal the provider ANSWERED — proven to have created nothing. */
function refusedBeforeCharging(name: string): () => Error {
  return () => new ProviderRequestError(name, 'rejected', { httpStatus: 400 });
}

function world(chain: { adapter: PaymentProviderAdapter }[]) {
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const attempts = createMemoryAttemptLedger();
  const registry: Record<string, PaymentProviderAdapter> = {};
  for (const { adapter } of chain) registry[adapter.name] = adapter;
  const gateway = createPaymentsGateway({
    providers: defineProviders(registry),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });
  for (const { adapter } of chain) credentials.set(TENANT, adapter.name, STUB_CREDS);
  return { gateway, charges, attempts: attempts as MemoryAttemptLedger };
}

describe('a REDIRECT provider at the HEAD of the chain', () => {
  it('advances when it refuses BEFORE minting a link', async () => {
    const hosted = redirectProvider('hosted', { fails: refusedBeforeCharging('hosted') });
    const tail = pixProvider('acquirer');
    const w = world([hosted, tail]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    // Nothing was handed to the buyer, so the walk was free to move.
    expect(charge.provider).toBe('acquirer');
    expect(charge.snapshot.pix?.qrText).toBe('qr-acquirer');
    expect(w.attempts.all().map((a) => [a.provider, a.outcome])).toEqual([
      ['hosted', 'FAILED_OVER'],
      ['acquirer', 'SUCCEEDED'],
    ]);
  });

  it('advances a CARD charge to the acquirer whose instrument we hold', async () => {
    // A hosted-headed store with an acquirer behind it shows OUR card form
    // (`usesHostedCheckout` asks the whole chain), so the browser mints for the
    // acquirer and for nobody else. The head is attempted with no instrument —
    // it needs none — and when it refuses provably the walk reaches the
    // provider the card was actually typed for.
    const hosted = redirectProvider('hosted', { fails: refusedBeforeCharging('hosted') });
    const tail = cardProvider('acquirer');
    const w = world([hosted, tail]);

    const charge = await w.gateway.charge(TENANT, chainCardInput({ acquirer: 'tok_acquirer' }));

    expect(charge.provider).toBe('acquirer');
    expect(tail.spy.tokens).toEqual(['tok_acquirer']);
    expect(hosted.spy.tokens).toEqual([undefined]);
  });

  it('COMMITS the walk the moment it mints one', async () => {
    const hosted = redirectProvider('hosted');
    const tail = pixProvider('acquirer');
    const w = world([hosted, tail]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    // The link is payable from now on. Attempting anyone else would be a
    // second payable charge for the same order.
    expect(charge.snapshot.hostedCheckoutUrl).toBe(
      'https://hosted.example.invalid/pay/order-1',
    );
    expect(tail.spy.chargeCalls).toHaveLength(0);
    expect(w.charges.all()).toHaveLength(1);
  });
});

describe('a REDIRECT provider at the TAIL of the chain', () => {
  it('is reached after a proven-safe failure and its LINK is the answer', async () => {
    const head = pixProvider('acquirer', { fails: refusedBeforeCharging('acquirer') });
    const hosted = redirectProvider('hosted');
    const w = world([head, hosted]);

    const charge = await w.gateway.charge(TENANT, pixInput());

    // The buyer asked the head for PIX and gets the tail's page instead: the
    // shape of the answer belongs to the charge that exists, not to the
    // provider that heads the list.
    expect(charge.provider).toBe('hosted');
    expect(charge.snapshot.hostedCheckoutUrl).toBe(
      'https://hosted.example.invalid/pay/order-1',
    );
    expect(charge.snapshot.pix).toBeUndefined();
    expect(hosted.spy.chargeCalls).toEqual(['order-1']);
  });

  it('is NOT reached when the head cannot prove it created nothing', async () => {
    // An ambiguous head with no probe stops the walk. Minting a payable link
    // at the tail here is the exact double charge the proof rules forbid.
    const head = pixProvider('acquirer', {
      fails: () => new ProviderRequestError('acquirer', 'gateway timeout', { httpStatus: 504 }),
    });
    const hosted = redirectProvider('hosted');
    const w = world([head, hosted]);

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toMatchObject({
      name: 'AmbiguousChargeError',
    });
    expect(hosted.spy.chargeCalls).toHaveLength(0);
    expect(w.charges.all()).toHaveLength(0);
  });

  it('is reached by a CARD charge that minted no instrument for it', async () => {
    // The shape the storefront actually sends for [acquirer, hosted]: ONE
    // instrument, in the map, for the one provider the browser could mint for.
    // Nothing was minted for the hosted page — its own site takes the card —
    // and that must not be read as "holding someone else's instrument".
    //
    // Pinned with a CARD input on purpose: every other tail case here charges
    // PIX, which carries no instrument at all and so never reaches the
    // attribution rules this depends on.
    const head = cardProvider('acquirer', { fails: refusedBeforeCharging('acquirer') });
    const hosted = redirectProvider('hosted');
    const w = world([head, hosted]);

    const charge = await w.gateway.charge(TENANT, chainCardInput({ acquirer: 'tok_acquirer' }));

    expect(charge.provider).toBe('hosted');
    expect(charge.snapshot.hostedCheckoutUrl).toBe('https://hosted.example.invalid/pay/order-2');
    expect(hosted.spy.chargeCalls).toEqual(['order-2']);
    // The head was charged with ITS OWN instrument, never the map wholesale.
    expect(head.spy.tokens).toEqual(['tok_acquirer']);
  });

  it('reports one exhausted chain when the redirect tail fails too', async () => {
    const head = pixProvider('acquirer', { fails: refusedBeforeCharging('acquirer') });
    const hosted = redirectProvider('hosted', { fails: refusedBeforeCharging('hosted') });
    const w = world([head, hosted]);

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toThrow(NoProviderSucceededError);
    expect(w.charges.all()).toHaveLength(0);
  });
});

/**
 * The lever the e2e fixture pulls (the journey-stores helper scripts
 * `jornada-cadeia` this way). Asserted HERE, in the package, because
 * the whole value of the journey rests on this script producing a genuinely
 * classifiable failure — a scripted fault that landed in the wrong bucket would
 * make the browser journey pass while proving the opposite of what it claims.
 */
describe('the scripted stub charge fault', () => {
  it('makes `not-charged` a provably safe refusal, so the chain advances', async () => {
    const w = scriptedWorld('not-charged');

    const charge = await w.gateway.charge(TENANT, pixInput());

    expect(charge.provider).toBe('backup');
    expect(w.attempts.all()[0]).toMatchObject({
      provider: 'acquirer',
      outcome: 'FAILED_OVER',
      failureBucket: 'DEFINITELY_NOT_CHARGED',
    });
  });

  it('leaves `ambiguous` unable to advance, probe or no probe', async () => {
    const w = scriptedWorld('ambiguous');

    await expect(w.gateway.charge(TENANT, pixInput())).rejects.toMatchObject({
      name: 'AmbiguousChargeError',
    });
    expect(w.tail.spy.chargeCalls).toHaveLength(0);
  });
});

/**
 * A two-provider world whose HEAD reads its failure out of stub CREDENTIALS —
 * the exact lever the e2e fixture pulls. Built fresh per test, so nothing here
 * crosses a test boundary.
 */
function scriptedWorld(fault: string) {
  const head = pixProvider('acquirer');
  const tail = pixProvider('backup');
  const credentials = createMemoryCredentialStore();
  const attempts = createMemoryAttemptLedger();
  const gateway = createPaymentsGateway({
    providers: defineProviders({
      acquirer: scriptedByCredentials(head.adapter),
      backup: tail.adapter,
    }),
    credentials,
    charges: createMemoryChargeStore(),
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });
  credentials.set(TENANT, 'acquirer', {
    ...STUB_CREDS,
    fields: { [STUB_CHARGE_FAULT_FIELD]: fault },
  });
  credentials.set(TENANT, 'backup', STUB_CREDS);
  return { gateway, tail, attempts: attempts as MemoryAttemptLedger };
}

/** The one line every real adapter runs: `stubCharge(NAME, input, creds)`. */
function scriptedByCredentials(adapter: PaymentProviderAdapter): PaymentProviderAdapter {
  return {
    ...adapter,
    createCharge: async (input, creds) => {
      applyStubChargeFault(adapter.name, creds);
      return adapter.createCharge(input, creds);
    },
  };
}
