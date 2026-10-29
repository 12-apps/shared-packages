import { describe, expect, it } from 'vitest';

import { UnsupportedOperationError } from '../../core/errors';
import { createPaymentsGateway } from '../../core/gateway';
import { cardProviderFor } from '../../core/method-head';
import type { PaymentProviderAdapter } from '../../core/provider';
import { defineProviders } from '../../core/registry';
import type { ChargeInput } from '../../core/types';
import { createMemoryAttemptLedger, createMemoryChargeStore, createMemoryCredentialStore } from '../../memory';
import { createMemoryWebhookInbox } from '../../memory-webhook-inbox';
import type { InstrumentScope } from '../types';

import { MERCHANT, call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * SAVED CARDS BELONG TO THE CHAIN'S CARD PROVIDER, NOT ITS HEAD (FUT-3138).
 *
 * A chain whose head takes no card — a PIX-only acquirer in front of the one
 * that charges cards — used to scope the vault, the saved-instrument list and
 * the saved-card lookup to that head: every card the provider behind it
 * vaulted vanished, vaulting answered "not enabled", and a saved-card charge
 * was refused as "not usable here". Each of them now names ONE provider, the
 * first link that takes a CARD — resolved once per request and handed to the
 * gateway's vault by name — the same rule the 3-D Secure session and the
 * walk's owner of a bare instrument already follow (FUT-4109). A head that
 * takes cards is still that first link, so those chains answer as before.
 */

const REF = 'inv_2024_0043';

/** A provider that settles PIX and nothing else. */
const pixOnly = (name: string): PaymentProviderAdapter => testAdapter(name, { methods: ['PIX'] });

/** Every card each provider's `createCharge` was handed, by provider. */
type Sent = { provider: string; card: ChargeInput['card'] }[];

/**
 * A card provider whose vault seam answers as `answersAs` (itself unless a
 * test wants a provider that misreports), recording every charge it is sent.
 */
function cardProvider(
  name: string,
  sent: Sent,
  options: { answersAs?: string; refuses?: boolean } = {},
): PaymentProviderAdapter {
  const base = testAdapter(name, options.refuses ? { refuses: true } : {});
  const as = options.answersAs ?? name;
  return {
    ...base,
    async createCharge(input, credentials) {
      sent.push({ provider: name, card: input.card });
      return base.createCharge(input, credentials);
    },
    vault: {
      begin: async () => ({ provider: as, tokenization: 'PUBLIC_KEY', publicKey: `pub_${as}`, sessionId: 'vs_1' }),
      complete: async () => ({ provider: as, instrumentId: `vault_${as}`, brand: 'visa', last4: '4242' }),
    },
  };
}

/** Every scope the host's ports were asked about. */
interface ScopeLog {
  /** `vault(caller, scope)` — whose ownership facts (`customerRef`) were asked. */
  owner: string[];
  listed: string[];
  resolved: string[];
  saved: string[];
}

/**
 * A checkout world over `chain`, its vault and instrument ports recording each
 * scope they are asked for, and — unless `registry: false` — the adapter
 * registry the runtime asks capabilities of.
 */
function world(chain: { name: string; adapter: PaymentProviderAdapter }[], options: { registry?: boolean } = {}) {
  const scopes: ScopeLog = { owner: [], listed: [], resolved: [], saved: [] };
  const providers = defineProviders(Object.fromEntries(chain.map((entry) => [entry.name, entry.adapter])));
  const built = setupCheckoutWorld({
    chain,
    payable: { method: 'CARD' },
    config: {
      ...(options.registry === false ? {} : { providers }),
      vault: async (caller, scope: InstrumentScope) => {
        scopes.owner.push(scope.provider);
        return {
          reference: `vault_${caller.id}`,
          customer: { name: 'Ana Buyer', email: 'ana@example.com', taxId: '12345678909' },
          customerRef: `cus_${scope.provider}`,
        };
      },
      instruments: {
        list: async (_caller, scope: InstrumentScope) => {
          scopes.listed.push(scope.provider);
          return [{ id: 'card_1', last4: '4242' }];
        },
        resolve: async (_caller, scope: InstrumentScope, instrumentId) => {
          scopes.resolved.push(scope.provider);
          return instrumentId === 'card_1' ? { token: `vault_${scope.provider}` } : { token: null, owned: false };
        },
        save: async (_caller, scope: InstrumentScope) => {
          scopes.saved.push(scope.provider);
        },
      },
    },
  });
  return { ...built, scopes };
}

/** The PIX-first shape: a PIX-only head, then the provider that takes cards. */
function pixHeadThenCards(sent: Sent) {
  return [
    { name: 'pixonly', adapter: pixOnly('pixonly') },
    { name: 'cards', adapter: cardProvider('cards', sent) },
  ];
}

/** Drive every card question once: list, begin, complete, saved-card charge. */
async function everyCardQuestion(at: ReturnType<typeof world>) {
  const listed = await call(at.routes, 'GET', '/cards');
  const begun = await call(at.routes, 'POST', '/cards/begin');
  const completed = await call(at.routes, 'POST', '/cards/complete', { sessionId: 'vs_1' });
  const charged = await call(at.routes, 'POST', '/charge', { orderId: REF, card: { savedCardToken: 'card_1' } });
  return { listed, begun, completed, charged };
}

describe('a chain whose head takes no card', () => {
  it('names the card provider in every card question, the ownership facts included', async () => {
    const sent: Sent = [];
    const at = world(pixHeadThenCards(sent));

    const { listed, begun, completed, charged } = await everyCardQuestion(at);

    expect(listed.body.data).toEqual([{ id: 'card_1', last4: '4242' }]);
    expect(begun.status).toBe(200);
    expect(begun.body.data).toMatchObject({ provider: 'cards', publicKey: 'pub_cards' });
    expect(completed.status).toBe(200);
    expect(charged.status).toBe(200);
    expect(at.scopes).toEqual({
      owner: ['cards', 'cards'],
      listed: ['cards'],
      resolved: ['cards'],
      saved: ['cards'],
    });
    expect(sent).toEqual([{ provider: 'cards', card: { savedCardToken: 'vault_cards', tokenProvider: 'cards' } }]);
  });

  it('never hands one provider\'s saved card to the next when the first is down', async () => {
    const sent: Sent = [];
    const at = world([
      { name: 'pixonly', adapter: pixOnly('pixonly') },
      { name: 'cards', adapter: cardProvider('cards', sent, { refuses: true }) },
      { name: 'cards2', adapter: cardProvider('cards2', sent) },
    ]);

    const charged = await call(at.routes, 'POST', '/charge', { orderId: REF, card: { savedCardToken: 'card_1' } });

    expect(charged.status).toBe(502);
    expect(sent.map((entry) => entry.provider)).toEqual(['cards']);
    expect(at.charges.all()).toEqual([]);
  });

  it('refuses to store a card the vault answered for another provider', async () => {
    const sent: Sent = [];
    const at = world([
      { name: 'pixonly', adapter: pixOnly('pixonly') },
      { name: 'cards', adapter: cardProvider('cards', sent, { answersAs: 'elsewhere' }) },
    ]);

    const begun = await call(at.routes, 'POST', '/cards/begin');
    const completed = await call(at.routes, 'POST', '/cards/complete', { sessionId: 'vs_1' });

    expect(begun.status).toBe(502);
    expect(completed.status).toBe(502);
    expect(completed.body.code).toBe('VAULT_NOT_SAVED');
    expect(at.scopes.saved).toEqual([]);
  });
});

describe('a chain whose head takes cards', () => {
  it('names the head in every card question, as before', async () => {
    const sent: Sent = [];
    const at = world([
      { name: 'alpha', adapter: cardProvider('alpha', sent) },
      { name: 'beta', adapter: cardProvider('beta', sent) },
    ]);

    const { begun, completed, charged } = await everyCardQuestion(at);

    expect(begun.body.data).toMatchObject({ provider: 'alpha' });
    expect(completed.status).toBe(200);
    expect(charged.status).toBe(200);
    expect(at.scopes).toEqual({ owner: ['alpha', 'alpha'], listed: ['alpha'], resolved: ['alpha'], saved: ['alpha'] });
    expect(sent.map((entry) => entry.provider)).toEqual(['alpha']);
  });
});

describe('a runtime that wired no adapter registry', () => {
  it('cannot ask who takes a card, so every question names the head — and the head cannot vault', async () => {
    const sent: Sent = [];
    const at = world(pixHeadThenCards(sent), { registry: false });

    const { begun, completed } = await everyCardQuestion(at);

    // The answer it gave before FUT-3138: the head has no vault.
    expect(begun.status).toBe(404);
    expect(begun.body.code).toBe('VAULT_NOT_ENABLED');
    expect(completed.status).toBe(404);
    expect(at.scopes).toEqual({
      owner: ['pixonly', 'pixonly'],
      listed: ['pixonly'],
      resolved: ['pixonly'],
      saved: [],
    });
    // A token found under the head's scope is the head's: never offered to the card provider.
    expect(sent).toEqual([]);
  });
});

describe('cardProviderFor', () => {
  const providers = defineProviders({ pixonly: pixOnly('pixonly'), other: pixOnly('other'), cards: testAdapter('cards') });

  it('answers the head when no link takes a card — the answer callers had before', async () => {
    const credentials = createMemoryCredentialStore();
    credentials.setChain(MERCHANT, ['pixonly', 'other']);

    expect(await cardProviderFor({ providers, credentials }, MERCHANT)).toBe('pixonly');
  });

  it('skips a provider this deployment does not route to', async () => {
    const credentials = createMemoryCredentialStore();
    credentials.setChain(MERCHANT, ['unknown', 'pixonly', 'cards']);

    expect(await cardProviderFor({ providers, credentials }, MERCHANT)).toBe('cards');
  });

  it('answers null when payments are off', async () => {
    expect(await cardProviderFor({ providers, credentials: createMemoryCredentialStore() }, MERCHANT)).toBeNull();
  });
});

/**
 * THE GATEWAY'S OWN VAULT, as subscription billing calls it: no provider
 * named, so the head — the provider billing loads the customer of and collects
 * at. Its adapters are registered from PARTIAL objects with no `capabilities`
 * at all, as the billing harness does; nothing may read through that.
 */
describe('the gateway vault', () => {
  const vaultOnly = {
    name: 'vaulter',
    vault: {
      begin: async () => ({ provider: 'vaulter', tokenization: 'PUBLIC_KEY', sessionId: 'vs_1' }),
      complete: async () => ({ provider: 'vaulter', instrumentId: 'vault_1' }),
    },
  } as unknown as PaymentProviderAdapter;
  const chargeOnly = { name: 'charger' } as unknown as PaymentProviderAdapter;
  const ownership = { reference: 'sub_1', customer: { name: 'Tenant', email: 't@example.com' } };

  function billing(chain: string[]) {
    const credentials = createMemoryCredentialStore();
    credentials.set(MERCHANT, 'vaulter', { environment: 'SANDBOX', fields: {} });
    credentials.set(MERCHANT, 'charger', { environment: 'SANDBOX', fields: {} });
    credentials.setChain(MERCHANT, chain);
    return createPaymentsGateway({
      providers: defineProviders({ vaulter: vaultOnly, charger: chargeOnly }),
      credentials,
      charges: createMemoryChargeStore(),
      webhooks: createMemoryWebhookInbox(),
      attempts: createMemoryAttemptLedger(),
    });
  }

  it('vaults at the head when no provider is named', async () => {
    expect((await billing(['vaulter', 'charger']).beginVault(MERCHANT, ownership)).provider).toBe('vaulter');
  });

  it('refuses as unsupported when the head cannot vault, whatever stands behind it', async () => {
    await expect(billing(['charger', 'vaulter']).beginVault(MERCHANT, ownership)).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });

  it('vaults at a NAMED provider, with no failover to the head', async () => {
    const gateway = billing(['charger', 'vaulter']);
    expect((await gateway.beginVault(MERCHANT, ownership, 'vaulter')).provider).toBe('vaulter');
    await expect(gateway.beginVault(MERCHANT, ownership, 'charger')).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('asks a registry of capability-less adapters without reading through them', async () => {
    const store = createMemoryCredentialStore();
    store.setChain(MERCHANT, ['charger', 'vaulter']);
    const registry = defineProviders({ vaulter: vaultOnly, charger: chargeOnly });

    expect(await cardProviderFor({ providers: registry, credentials: store }, MERCHANT)).toBe('charger');
  });
});
