import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import type { ResolvedCredentials } from '../core/types';
import { pagbankProvider } from '../providers/pagbank';
import { cardInput } from './fixtures';

/**
 * PagBank card vaulting (FUT-478 / FUT-183) — saving/validating a card WITHOUT
 * a purchase through the dedicated Card Validation & Storage API. These mirror
 * the Stripe vault suite in `live-adapters.test.ts`: the wire shapes, the
 * refusals, and above all what is (and is NOT) persisted.
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
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    const status = next?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => JSON.stringify(next?.body ?? {}),
      json: async () => next?.body ?? {},
    } as unknown as Response;
  });
  return calls;
}

const LIVE: ResolvedCredentials = {
  environment: 'SANDBOX',
  fields: { token: 'tok_live', publicKey: 'PUB_KEY_1' },
};

const STUB: ResolvedCredentials = { environment: 'SANDBOX', fields: {}, stub: true };

/** The documented `POST /tokens/cards` success body, verbatim shape. */
const STORED_CARD = {
  id: 'CARD_4350C260-C6C8-4E29-B6F1-4470E33A7866',
  brand: 'mastercard',
  first_digits: '559080',
  last_digits: '8129',
  exp_month: '04',
  exp_year: '2030',
  holder: { name: 'Jose da Silva' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank adapter — card vault (FUT-478/FUT-183)', () => {
  it('declares the vault, and declares no forget', () => {
    // The omission is load-bearing: PagBank documents no endpoint that deletes
    // a stored card token, so the gateway must answer UnsupportedOperationError
    // for a removal rather than fake one — the host decides about its pointer.
    const vault = pagbankProvider().vault;
    expect(vault?.begin).toBeTypeOf('function');
    expect(vault?.complete).toBeTypeOf('function');
    expect(vault?.forget).toBeUndefined();
  });

  describe('begin — equip the browser, open nothing', () => {
    it('hands over the public key with no session and no network call', async () => {
      // PagBank has no SetupIntent equivalent: `begin` only tells the browser
      // how to encrypt. Nothing exists at the provider yet.
      const calls = stubFetch([{ body: {} }]);

      const session = await pagbankProvider().vault!.begin(
        { reference: 'sub-1', customer: { name: 'Bar do Ze', email: 'dono@bar.com' } },
        LIVE,
      );

      expect(calls).toHaveLength(0);
      expect(session).toEqual({
        provider: 'pagbank',
        tokenization: 'PUBLIC_KEY',
        publicKey: 'PUB_KEY_1',
      });
    });

    it('refuses a live connection that carries no public key', async () => {
      // Without the key the browser cannot encrypt, so the flow is already
      // dead — refused here with a reason, not later as an opaque SDK error.
      const calls = stubFetch([{ body: {} }]);

      const error = await pagbankProvider()
        .vault!.begin(
          { reference: 'sub-1', customer: { name: 'Loja' } },
          { environment: 'SANDBOX', fields: { token: 'tok_live' } },
        )
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ProviderRequestError);
      expect((error as ProviderRequestError).message).toMatch(/public key/i);
      expect((error as ProviderRequestError).retriable).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('answers a stub connection without a key instead of refusing it', async () => {
      // No key on a stub is exactly the state the host's mock tokenization
      // exists for — the same gate the checkout config applies.
      const session = await pagbankProvider().vault!.begin(
        { reference: 'sub-1', customer: { name: 'Loja' } },
        STUB,
      );

      expect(session).toEqual({ provider: 'pagbank', tokenization: 'PUBLIC_KEY' });
    });
  });

  describe('complete — POST /tokens/cards', () => {
    it('sends only the encrypted blob, bearer-authenticated, to the sandbox host', async () => {
      const calls = stubFetch([{ body: STORED_CARD }]);

      await pagbankProvider().vault!.complete(
        { reference: 'sub-1', token: 'ENCRYPTED_BLOB' },
        LIVE,
      );

      expect(calls[0]!.url).toBe('https://sandbox.api.pagseguro.com/tokens/cards');
      expect(calls[0]!.init.method).toBe('POST');
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok_live');
      // `encrypted` alone: the holder and every card field ride inside the
      // blob the browser SDK produced. Nothing else may leave this process.
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ encrypted: 'ENCRYPTED_BLOB' });
    });

    it('keeps the token and display metadata — and drops everything else', async () => {
      stubFetch([{ body: STORED_CARD }]);

      const vaulted = await pagbankProvider().vault!.complete(
        { reference: 'sub-1', token: 'ENCRYPTED_BLOB' },
        LIVE,
      );

      // `toEqual`, not `toMatchObject`: what the object OMITS is the point.
      // No PAN, no `first_digits`, no holder name — the durable row is the
      // vault id plus what a tenant needs to recognize the card. The string
      // expiry PagBank answers ("04") arrives as the numbers the contract
      // promises.
      expect(vaulted).toEqual({
        provider: 'pagbank',
        instrumentId: 'CARD_4350C260-C6C8-4E29-B6F1-4470E33A7866',
        brand: 'mastercard',
        last4: '8129',
        expMonth: 4,
        expYear: 2030,
      });
    });

    it('routes PRODUCTION credentials at the live host', async () => {
      const calls = stubFetch([{ body: STORED_CARD }]);

      await pagbankProvider().vault!.complete(
        { reference: 'sub-1', token: 'BLOB' },
        { environment: 'PRODUCTION', fields: { token: 't', publicKey: 'pk' } },
      );

      expect(calls[0]!.url).toBe('https://api.pagseguro.com/tokens/cards');
    });

    it('drops an unparseable display expiry rather than answering NaN', async () => {
      stubFetch([{ body: { ...STORED_CARD, exp_month: 'ab', exp_year: undefined } }]);

      const vaulted = await pagbankProvider().vault!.complete(
        { reference: 'sub-1', token: 'BLOB' },
        LIVE,
      );

      expect(vaulted.expMonth).toBeUndefined();
      expect(vaulted.expYear).toBeUndefined();
    });

    it('refuses a completion with no encrypted blob, before any network', async () => {
      // A sessionId alone is the Stripe shape; PagBank has no session to read
      // back, so without the blob there is nothing to store.
      const calls = stubFetch([{ body: STORED_CARD }]);

      const error = await pagbankProvider()
        .vault!.complete({ reference: 'sub-1', sessionId: 'seti_wrong_provider' }, LIVE)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ProviderRequestError);
      expect((error as ProviderRequestError).retriable).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('refuses a response that carried no token id', async () => {
      // A "stored" card the host cannot ever charge is not a success.
      stubFetch([{ body: { brand: 'visa', last_digits: '4242' } }]);

      const error = await pagbankProvider()
        .vault!.complete({ reference: 'sub-1', token: 'BLOB' }, LIVE)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ProviderRequestError);
      expect((error as ProviderRequestError).retriable).toBe(false);
    });
  });

  describe('validation happens at entry, and the refusal is usable evidence', () => {
    async function refusedCompletion(): Promise<ProviderRequestError> {
      stubFetch([
        {
          status: 400,
          body: {
            error_messages: [
              {
                message: 'exp_year_is_invalid',
                description: "Parameter 'exp_year' has an invalid value, see documentation.",
                parameter_name: 'exp_year',
              },
            ],
          },
        },
      ]);
      try {
        await pagbankProvider().vault!.complete({ reference: 'sub-1', token: 'BAD_BLOB' }, LIVE);
      } catch (error) {
        return error as ProviderRequestError;
      }
      throw new Error('the completion was expected to fail');
    }

    it('surfaces a 400 validation refusal as a non-retriable error', async () => {
      // This IS the "validate before store" the tickets ask for: the bad card
      // is caught at entry — with PagBank's field-level reason kept — instead
      // of at the next charge's money moment.
      const error = await refusedCompletion();

      expect(error.retriable).toBe(false);
      const body = error.options.body as { error_messages: Array<{ message: string }> };
      expect(body.error_messages[0]?.message).toBe('exp_year_is_invalid');
    });

    it('captures the request with the blob redacted and the token never read', async () => {
      // The encrypted blob is enough to charge with — the failure evidence
      // must show the field was sent without retaining what was in it.
      const request = (await refusedCompletion()).options.request;

      expect(request?.url).toBe('https://sandbox.api.pagseguro.com/tokens/cards');
      expect(request?.body).toEqual({ encrypted: '***REDACTED***' });
      expect(request?.headers['Authorization']).toBe('Bearer ***REDACTED***');
      expect(JSON.stringify(request)).not.toContain('BAD_BLOB');
      expect(JSON.stringify(request)).not.toContain('tok_live');
    });

    it('keeps a provider outage retriable', async () => {
      stubFetch([{ status: 503, body: {} }]);

      const error = await pagbankProvider()
        .vault!.complete({ reference: 'sub-1', token: 'BLOB' }, LIVE)
        .catch((thrown: unknown) => thrown);

      expect((error as ProviderRequestError).retriable).toBe(true);
    });
  });

  describe('stub mode — the whole flow with no network', () => {
    it('completes deterministically and touches nothing', async () => {
      const calls = stubFetch([{ body: {} }]);

      const vaulted = await pagbankProvider().vault!.complete(
        { reference: 'sub-9', token: 'mock_tok_1' },
        STUB,
      );

      expect(calls).toHaveLength(0);
      expect(vaulted).toEqual({
        provider: 'pagbank',
        instrumentId: 'stub_pagbank_vault_sub-9',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      });
    });

    it('honours the -declined suffix so the refusal path is exercisable', async () => {
      // The same magic token `stubCharge` reads: hosts and e2e can walk the
      // "bad card caught at entry" branch without a live account.
      const calls = stubFetch([{ body: {} }]);

      const error = await pagbankProvider()
        .vault!.complete({ reference: 'sub-9', token: 'tok-declined' }, STUB)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ProviderRequestError);
      expect((error as ProviderRequestError).retriable).toBe(false);
      expect(calls).toHaveLength(0);
    });
  });

  it('charges the vaulted token as payment_method.card.id — the reuse leg', async () => {
    // The tickets' acceptance: a card stored OUTSIDE an order charges through
    // the existing saved-card path unchanged. The id `complete` answers is
    // handed to `createCharge` as `savedCardToken` and must ride `card.id`,
    // exactly like an order-derived one. (Documented contract; the live
    // sandbox confirmation is FUT-478's open question.)
    const calls = stubFetch([
      { body: STORED_CARD },
      { body: { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'PAID' }] } },
    ]);
    const adapter = pagbankProvider();

    const vaulted = await adapter.vault!.complete({ reference: 'sub-1', token: 'BLOB' }, LIVE);
    await adapter.createCharge(
      { ...cardInput('sub-cycle-1'), card: { savedCardToken: vaulted.instrumentId } },
      LIVE,
    );

    const body = JSON.parse(calls[1]!.init.body as string) as {
      charges: Array<{ payment_method: { card: Record<string, unknown> } }>;
    };
    expect(body.charges[0]?.payment_method.card).toEqual({
      id: 'CARD_4350C260-C6C8-4E29-B6F1-4470E33A7866',
    });
  });
});
