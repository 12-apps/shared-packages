import { afterEach, describe, expect, it, vi } from 'vitest';

import { chargeInputFor, hasInstrument } from '../core/card-instrument';
import { toClientProviderConfig } from '../core/client-view';
import { debitSessionFor } from '../core/debit-session';
import { defineProviders } from '../core/registry';
import { UnsupportedOperationError } from '../core/errors';
import type { ChargeInput, ResolvedCredentials } from '../core/types';
import { chargeDraftOf } from '../checkout/draft';
import { pagbankProvider } from '../providers/pagbank';
import { createPagbankThreeDSecureSession, pagbankSdkBase } from '../providers/pagbank-3ds';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';
import { cardInput, setupGatewayWorld, STUB_CREDS, TENANT } from './fixtures';

/**
 * FUT-3754 — a DEBIT card, authenticated with PagBank's 3-D Secure.
 *
 * PagBank's "Criar e pagar com autenticação 3DS do PagBank": a `DEBIT_CARD`
 * charge must carry `authentication_method: { type: 'THREEDS', id }`, the id
 * coming out of the browser SDK, which runs on a session minted server-side
 * (`POST /checkout-sdk/sessions` on the SDK host, seller token as Bearer).
 */

const LIVE: ResolvedCredentials = { environment: 'SANDBOX', fields: { token: 'tok_live' } };

function debitInput(card: NonNullable<ChargeInput['card']> = {}): ChargeInput {
  return {
    ...cardInput('order-d'),
    card: { token: 'enc_blob', funding: 'DEBIT', authenticationId: 'AUTH_1', ...card },
  };
}

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

function sentBody(spy: ReturnType<typeof mockFetch>) {
  return JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
    charges: Array<{ payment_method: Record<string, unknown> }>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the PagBank debit charge', () => {
  it('sends DEBIT_CARD with the 3DS authentication, one installment and no stored card', async () => {
    const spy = mockFetch({ id: 'ORDE_D', charges: [{ id: 'CHAR_D', status: 'PAID' }] });
    await pagbankProvider(PT_BR_PAGBANK_COPY).createCharge(debitInput({ installments: 3 }), LIVE);

    expect(sentBody(spy).charges[0]?.payment_method).toEqual({
      type: 'DEBIT_CARD',
      installments: 1,
      authentication_method: { type: 'THREEDS', id: 'AUTH_1' },
      capture: true,
      card: { encrypted: 'enc_blob' },
    });
  });

  it('says on the snapshot how PagBank charged the card, so nothing downstream calls a debit credit', async () => {
    const charged = (type: string) => ({
      id: 'ORDE_F',
      charges: [{ id: 'CHAR_F', status: 'PAID', payment_method: { type, card: { brand: 'visa', last_digits: '2701' } } }],
    });
    mockFetch(charged('DEBIT_CARD'));
    const debit = await pagbankProvider(PT_BR_PAGBANK_COPY).createCharge(debitInput(), LIVE);
    mockFetch(charged('CREDIT_CARD'));
    const credit = await pagbankProvider(PT_BR_PAGBANK_COPY).createCharge(cardInput('order-c', 'enc_c'), LIVE);

    expect(debit.card).toMatchObject({ brand: 'visa', last4: '2701', funding: 'DEBIT' });
    expect(credit.card?.funding).toBe('CREDIT');
  });

  it('keeps an ordinary card charge exactly as it was: CREDIT_CARD, stored', async () => {
    const spy = mockFetch({ id: 'ORDE_C', charges: [{ id: 'CHAR_C', status: 'PAID' }] });
    await pagbankProvider(PT_BR_PAGBANK_COPY).createCharge(cardInput('order-c', 'enc_c'), LIVE);

    expect(sentBody(spy).charges[0]?.payment_method).toEqual({
      type: 'CREDIT_CARD',
      installments: 1,
      capture: true,
      card: { encrypted: 'enc_c', store: true },
    });
  });

  it('declares debit and publishes it to the checkout', () => {
    const adapter = pagbankProvider(PT_BR_PAGBANK_COPY);
    expect(adapter.capabilities.debit).toBe(true);
    expect(toClientProviderConfig(adapter, LIVE).debit).toBe(true);
  });

  it('publishes no debit for an adapter that never declared it', () => {
    const world = setupGatewayWorld();
    expect(toClientProviderConfig(world.adapter, STUB_CREDS).debit).toBe(false);
  });
});

describe('the walk gates debit charges', () => {
  it('passes a debit charge to a provider that declared debit', () => {
    const result = chargeInputFor(debitInput(), 'pagbank', 'pagbank', { tokenization: 'PUBLIC_KEY', debit: true });
    expect(hasInstrument(result) && result.card?.funding).toBe('DEBIT');
  });

  it('refuses a debit charge on a provider that never declared debit, rather than charge it as credit', () => {
    const result = chargeInputFor(debitInput(), 'stone', 'stone', { tokenization: 'PUBLIC_KEY' });
    expect(hasInstrument(result)).toBe(false);
    expect(!hasInstrument(result) && result.reason).toContain('does not support debit');
  });

  it('refuses a debit charge that carries no 3-D Secure authentication', () => {
    const result = chargeInputFor(
      debitInput({ authenticationId: undefined }),
      'pagbank',
      'pagbank',
      { tokenization: 'PUBLIC_KEY', debit: true },
    );
    expect(!hasInstrument(result) && result.reason).toContain('3-D Secure');
  });

  it('refuses a debit charge on a saved card, rather than charge the vaulted card as DEBIT', () => {
    const result = chargeInputFor(
      debitInput({ token: undefined, savedCardToken: 'vault-1' }),
      'pagbank',
      'pagbank',
      { tokenization: 'PUBLIC_KEY', debit: true },
    );
    expect(!hasInstrument(result) && result.reason).toContain('saved card');
  });

  it('refuses a pinned debit charge before reaching createCharge', async () => {
    const world = setupGatewayWorld();
    await expect(world.gateway.charge(TENANT, debitInput(), { provider: 'stone' })).rejects.toThrow(
      UnsupportedOperationError,
    );
  });
});

describe('the charge body carries the debit fields', () => {
  it('reads them off the nested card block', () => {
    const draft = chargeDraftOf({ orderId: 'o', card: { token: 't', funding: 'DEBIT', authenticationId: 'A' } });
    expect(draft.card).toEqual({ token: 't', funding: 'DEBIT', authenticationId: 'A' });
  });

  it('reads them off the flat body, and never takes its token for a saved card', () => {
    const draft = chargeDraftOf({ orderId: 'o', token: 't', funding: 'DEBIT', authenticationId: 'A' });
    expect(draft.card).toEqual({ token: 't', funding: 'DEBIT', authenticationId: 'A' });
    expect(draft.ambiguousInstrument).toBeUndefined();
  });

  it('ignores a funding it does not know', () => {
    const draft = chargeDraftOf({ orderId: 'o', token: 't', funding: 'PREPAID' });
    expect(draft.card).toEqual({ token: 't' });
    expect(draft.ambiguousInstrument).toBe(true);
  });
});

describe("PagBank's 3-D Secure session", () => {
  it('posts to the SDK host with the seller token and returns the session', async () => {
    const spy = mockFetch({ session: 'SESS', expires_at: 1_700_000_000_000 });
    const session = await createPagbankThreeDSecureSession(LIVE);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.sdk.pagseguro.com/checkout-sdk/sessions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_live');
    expect(session).toEqual({ session: 'SESS', expiresAt: 1_700_000_000_000, environment: 'SANDBOX' });
  });

  it('uses the production SDK host for a production connection', () => {
    expect(pagbankSdkBase('PRODUCTION')).toBe('https://sdk.pagseguro.com');
  });

  it('throws on a refusal, naming the status', async () => {
    mockFetch({}, 400);
    await expect(createPagbankThreeDSecureSession(LIVE)).rejects.toThrow('HTTP 400');
  });

  it('mints a fake session in stub mode without calling out', async () => {
    const spy = mockFetch({});
    const session = await createPagbankThreeDSecureSession(STUB_CREDS);
    expect(spy).not.toHaveBeenCalled();
    expect(session.session).toBe('stub-3ds-session');
  });
});

describe('debitSessionFor', () => {
  const providers = defineProviders({ pagbank: pagbankProvider(PT_BR_PAGBANK_COPY) });

  function store(provider: string | null, credentials: ResolvedCredentials | null, chain: string[] = provider ? [provider] : []) {
    return {
      providerChain: async () => chain,
      getCredentials: async () => credentials,
    };
  }

  it("mints the session with the chain head's credentials", async () => {
    const minted = await debitSessionFor({ providers, credentials: store('pagbank', STUB_CREDS) }, TENANT);
    expect(minted?.provider).toBe('pagbank');
    expect(minted?.session.session).toBe('stub-3ds-session');
  });

  it('answers null with nothing connected, or with no credentials', async () => {
    expect(await debitSessionFor({ providers, credentials: store(null, STUB_CREDS) }, TENANT)).toBeNull();
    expect(await debitSessionFor({ providers, credentials: store('pagbank', null) }, TENANT)).toBeNull();
  });

  it("mints on the first provider that takes a card, past a Pix-only head (FUT-4109)", async () => {
    const pagbank = pagbankProvider(PT_BR_PAGBANK_COPY);
    const pixKey = { ...pagbank, name: 'pix-key', capabilities: { ...pagbank.capabilities, methods: ['PIX' as const], debit: false } };
    const chain = defineProviders({ 'pix-key': pixKey, pagbank });
    const minted = await debitSessionFor({ providers: chain, credentials: store(null, STUB_CREDS, ['pix-key', 'pagbank']) }, TENANT);
    expect(minted?.provider).toBe('pagbank');
  });

  it('answers null when the head cannot do debit', async () => {
    const world = setupGatewayWorld();
    const others = defineProviders({ stone: world.adapter });
    expect(await debitSessionFor({ providers: others, credentials: store('stone', STUB_CREDS) }, TENANT)).toBeNull();
  });
});
