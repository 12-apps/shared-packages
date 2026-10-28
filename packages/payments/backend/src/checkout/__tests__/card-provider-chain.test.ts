import { describe, expect, it } from 'vitest';

import { cardProviderFor } from '../../core/method-head';
import type { PaymentProviderAdapter } from '../../core/provider';
import { defineProviders } from '../../core/registry';
import { createMemoryCredentialStore } from '../../memory';
import type { InstrumentScope } from '../types';

import { MERCHANT, call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * SAVED CARDS BELONG TO THE CHAIN'S CARD PROVIDER, NOT ITS HEAD (FUT-3138).
 *
 * A chain whose head takes no card — a PIX-only acquirer in front of the one
 * that charges cards — used to scope the vault, the saved-instrument list and
 * the saved-card lookup to that head: every card the provider behind it
 * vaulted vanished, vaulting answered "not enabled", and a saved-card charge
 * was refused as "not usable here". Each of them now asks the first link that
 * takes a CARD, the same rule the 3-D Secure session and the walk's owner of a
 * bare instrument already follow (FUT-4109). A head that takes cards is still
 * that first link, so those chains answer exactly as before.
 */

const REF = 'inv_2024_0043';

/** A provider that settles PIX and nothing else. */
const pixOnly = (name: string): PaymentProviderAdapter => testAdapter(name, { methods: ['PIX'] });

/** A card provider whose vault seam names whoever it was asked as. */
function vaultingCards(name: string): PaymentProviderAdapter {
  return {
    ...testAdapter(name),
    vault: {
      begin: async () => ({ provider: name, tokenization: 'PUBLIC_KEY', publicKey: `pub_${name}`, sessionId: 'vs_1' }),
      complete: async () => ({ provider: name, instrumentId: `vault_${name}`, brand: 'visa', last4: '4242' }),
    },
  };
}

/** Every scope the host's instrument port was asked about. */
interface ScopeLog {
  listed: string[];
  resolved: string[];
  saved: string[];
}

/**
 * A checkout world over `chain`, its instrument port recording each scope it
 * is asked for, and — unless `registry: false` — the adapter registry the
 * runtime asks capabilities of.
 */
function world(chain: { name: string; adapter: PaymentProviderAdapter }[], options: { registry?: boolean } = {}) {
  const scopes: ScopeLog = { listed: [], resolved: [], saved: [] };
  const providers = defineProviders(Object.fromEntries(chain.map((entry) => [entry.name, entry.adapter])));
  const built = setupCheckoutWorld({
    chain,
    payable: { method: 'CARD' },
    config: {
      ...(options.registry === false ? {} : { providers }),
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

const itauFirst = () => [
  { name: 'pixonly', adapter: pixOnly('pixonly') },
  { name: 'cards', adapter: vaultingCards('cards') },
];

describe('a chain whose head takes no card', () => {
  it('lists the saved cards of the first provider that takes one', async () => {
    const at = world(itauFirst());

    const listed = await call(at.routes, 'GET', '/cards');

    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([{ id: 'card_1', last4: '4242' }]);
    expect(at.scopes.listed).toEqual(['cards']);
  });

  it('vaults a new card at that provider instead of answering "not enabled"', async () => {
    const at = world(itauFirst());

    const begun = await call(at.routes, 'POST', '/cards/begin');
    expect(begun.status).toBe(200);
    expect(begun.body.data).toMatchObject({ provider: 'cards', publicKey: 'pub_cards' });

    const completed = await call(at.routes, 'POST', '/cards/complete', { sessionId: 'vs_1' });
    expect(completed.status).toBe(200);
    expect(at.scopes.saved).toEqual(['cards']);
  });

  it('charges a saved card there, looked up under that provider', async () => {
    const at = world(itauFirst());

    const charged = await call(at.routes, 'POST', '/charge', { orderId: REF, card: { savedCardToken: 'card_1' } });

    expect(charged.status).toBe(200);
    expect(at.scopes.resolved).toEqual(['cards']);
    expect(at.charges.all().map((charge) => charge.provider)).toEqual(['cards']);
  });
});

describe('a chain whose head takes cards', () => {
  it('still scopes the list, the vault and the lookup to the head', async () => {
    const at = world([
      { name: 'alpha', adapter: vaultingCards('alpha') },
      { name: 'beta', adapter: vaultingCards('beta') },
    ]);

    await call(at.routes, 'GET', '/cards');
    const begun = await call(at.routes, 'POST', '/cards/begin');
    await call(at.routes, 'POST', '/charge', { orderId: REF, card: { savedCardToken: 'card_1' } });

    expect(at.scopes.listed).toEqual(['alpha']);
    expect(begun.body.data).toMatchObject({ provider: 'alpha' });
    expect(at.scopes.resolved).toEqual(['alpha']);
    expect(at.charges.all().map((charge) => charge.provider)).toEqual(['alpha']);
  });
});

describe('a runtime that wired no adapter registry', () => {
  it('cannot ask who takes a card, so it keeps the head it always used', async () => {
    const at = world(itauFirst(), { registry: false });

    await call(at.routes, 'GET', '/cards');

    expect(at.scopes.listed).toEqual(['pixonly']);
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
