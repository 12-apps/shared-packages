import { describe, expect, it } from 'vitest';

import { ProviderRequestError } from '../../core/errors';
import type { PaymentProviderAdapter } from '../../core/provider';
import type { VaultBeginInput, VaultCompleteInput } from '../../core/vault-types';
import { pagbankProvider } from '../../providers/pagbank';

import { MERCHANT, call, setupCheckoutWorld, testAdapter } from './harness';

/**
 * VAULT A CARD FROM THE BUYER SURFACE (FUT-478) — `POST /cards/begin` and
 * `POST /cards/complete` on the checkout mount. The vault machinery predates
 * this (the gateway verbs, the adapters' seam); what is pinned here is the
 * BUYER dispatch: the ownership facts are server-derived and a body cannot
 * override them, the browser never sees the vault token or the provider
 * customer, an unwired host answers the admin convention's 404 BEFORE any
 * adapter runs, and the rows authenticate exactly like every other BUYER row.
 */

/** Everything the adapter's vault seam was handed — the assertion surface. */
interface VaultSeamLog {
  begin: VaultBeginInput[];
  complete: VaultCompleteInput[];
}

const seamLog = (): VaultSeamLog => ({ begin: [], complete: [] });

/** A vendor-free vaulting adapter whose seam records what it was shown. */
function vaultingAdapter(name: string, seam: VaultSeamLog): PaymentProviderAdapter {
  return {
    ...testAdapter(name),
    vault: {
      begin: async (input) => {
        seam.begin.push(input);
        return {
          provider: name,
          tokenization: 'PUBLIC_KEY',
          publicKey: 'pub_browser_key',
          customerRef: 'cus_provider_7',
          sessionId: 'vs_1',
        };
      },
      complete: async (input) => {
        seam.complete.push(input);
        return {
          provider: name,
          instrumentId: 'vault_tok_1',
          customerRef: 'cus_provider_7',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2031,
        };
      },
    },
  };
}

describe('POST /cards/begin — equip the browser to mint the instrument', () => {
  it('given a PUBLIC_KEY provider (stub pagbank), when the buyer begins vaulting, then the answer carries the tokenization and the public key', async () => {
    const world = setupCheckoutWorld({ chain: [{ name: 'pagbank', adapter: pagbankProvider() }] });
    world.credentials.set(MERCHANT, 'pagbank', {
      environment: 'SANDBOX',
      fields: { publicKey: 'PUB_KEY_1' },
      stub: true,
    });

    const { status, body } = await call(world.routes, 'POST', '/cards/begin');

    expect(status).toBe(200);
    expect(body.data).toEqual({
      provider: 'pagbank',
      tokenization: 'PUBLIC_KEY',
      publicKey: 'PUB_KEY_1',
      clientSecret: null,
      sessionId: null,
    });
  });

  it('given the session names a provider customer, when begin answers, then the host-persisted customerRef is stripped', async () => {
    const seam = seamLog();
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: vaultingAdapter('alpha', seam) }],
    });

    const { status, body } = await call(world.routes, 'POST', '/cards/begin');

    expect(status).toBe(200);
    expect(body.data).toEqual({
      provider: 'alpha',
      tokenization: 'PUBLIC_KEY',
      publicKey: 'pub_browser_key',
      clientSecret: null,
      sessionId: 'vs_1',
    });
    // `customerRef` is the host's persist-it fact, never a page prop.
    expect(JSON.stringify(body)).not.toContain('cus_provider_7');
  });

  it('given a body trying to name its own owner, when vaulting begins, then the adapter sees the host-derived ownership only', async () => {
    const seam = seamLog();
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: vaultingAdapter('alpha', seam) }],
    });

    await call(world.routes, 'POST', '/cards/begin', {
      reference: 'attacker-ref',
      customerRef: 'attacker-cus',
      customer: { name: 'Mallory' },
    });

    // The reference names the CALLER — a request body has no field that
    // reaches the adapter, which is the same rule the admin resolvers pin.
    expect(seam.begin).toHaveLength(1);
    expect(seam.begin[0]).toMatchObject({
      reference: 'vault_caller-1',
      customerRef: 'cus_host_9',
    });
    expect(seam.begin[0]?.customer.name).toBe('Ana Buyer');
  });

  it('given a provider with no vault seam, when the buyer begins vaulting, then the NotEnabled 404 answers', async () => {
    // The default world's adapter declares no `vault` — the gateway refuses
    // with UnsupportedOperationError, and the buyer reads "not enabled here".
    const world = setupCheckoutWorld();

    const { status, body } = await call(world.routes, 'POST', '/cards/begin');

    expect(status).toBe(404);
    expect(body.code).toBe('VAULT_NOT_ENABLED');
    expect(body.error).toBe('Card vaulting is not enabled');
  });

  it('given a merchant with no connected provider, when the buyer begins vaulting, then the store reads not configured', async () => {
    const world = setupCheckoutWorld();
    world.credentials.clear();

    const { status, body } = await call(world.routes, 'POST', '/cards/begin');

    expect(status).toBe(409);
    expect(body.code).toBe('PAYMENT_NOT_CONFIGURED');
  });
});

describe('POST /cards/complete — store the instrument, answer the display', () => {
  it('given a browser-encrypted token (stub pagbank), when the buyer completes vaulting, then the card is saved and the answer carries display only', async () => {
    const world = setupCheckoutWorld({ chain: [{ name: 'pagbank', adapter: pagbankProvider() }] });

    const { status, body } = await call(world.routes, 'POST', '/cards/complete', {
      token: 'tok_encrypted_blob',
    });

    expect(status).toBe(200);
    expect(body.data).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 });
    // The vault token reached the HOST's storage, scoped to the provider that
    // minted it — and its `…vault_caller-1` suffix proves the server-derived
    // reference is what the adapter vaulted under.
    expect(world.vault.saved).toEqual([
      {
        provider: 'pagbank',
        token: 'stub_pagbank_vault_vault_caller-1',
        display: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
      },
    ]);
    // The browser never sees the token itself.
    expect(JSON.stringify(body)).not.toContain('stub_pagbank_vault');
  });

  it('given the stub -declined suffix, when validation refuses the card, then the host mapping words the field-level reason and nothing is saved', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'pagbank', adapter: pagbankProvider() }],
      config: {
        // One vendor's error vocabulary is the HOST's to map — the same seam
        // the charge path words a provider 400 through.
        mapProviderError: (error) =>
          error instanceof ProviderRequestError && error.options.httpStatus === 400
            ? { code: 'CARD_VALIDATION_REFUSED', message: 'copy.cardRefused', field: 'cardNumber' }
            : null,
      },
    });

    const { status, body } = await call(world.routes, 'POST', '/cards/complete', {
      token: 'tok-declined',
    });

    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'CARD_VALIDATION_REFUSED',
      error: 'copy.cardRefused',
      field: 'cardNumber',
    });
    expect(world.vault.saved).toEqual([]);
  });

  it('given no host mapping, when validation refuses the card, then the library words one honest generic and no vendor sentence', async () => {
    const world = setupCheckoutWorld({ chain: [{ name: 'pagbank', adapter: pagbankProvider() }] });

    const { status, body } = await call(world.routes, 'POST', '/cards/complete', {
      token: 'tok-declined',
    });

    expect(status).toBe(502);
    expect(body.code).toBe('PAYMENT_DECLINED');
    expect(body.error).toBe('copy.generic');
    expect(world.vault.saved).toEqual([]);
  });

  it('given a body claiming another owner, when completion runs, then the adapter sees host ownership plus the browser session facts only', async () => {
    const seam = seamLog();
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: vaultingAdapter('alpha', seam) }],
    });

    const { status } = await call(world.routes, 'POST', '/cards/complete', {
      reference: 'attacker-ref',
      customerRef: 'attacker-cus',
      sessionId: 'vs_1',
      token: 'tok_1',
    });

    expect(status).toBe(200);
    // `sessionId` and `token` are the browser's two legitimate facts; the
    // ownership pair is the host's answer, body notwithstanding.
    expect(seam.complete).toEqual([
      { reference: 'vault_caller-1', customerRef: 'cus_host_9', sessionId: 'vs_1', token: 'tok_1' },
    ]);
  });

  it('given the host save throws, when completion runs, then the buyer gets an error rather than a card that is not on file', async () => {
    const world = setupCheckoutWorld({
      chain: [{ name: 'pagbank', adapter: pagbankProvider() }],
      config: {
        instruments: {
          list: async () => [],
          resolve: async () => ({ token: null, owned: false }),
          save: async () => {
            throw new Error('disk full');
          },
        },
      },
    });

    const { status, body } = await call(world.routes, 'POST', '/cards/complete', {
      token: 'tok_ok',
    });

    expect(status).toBe(502);
    expect(body.code).toBe('VAULT_NOT_SAVED');
  });
});

describe('the wiring gate and the principal', () => {
  it('given a host without instruments.save, when either vault route is called, then NotEnabled answers and the adapter is never reached', async () => {
    const seam = seamLog();
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: vaultingAdapter('alpha', seam) }],
      config: {
        // list/resolve wired, `save` deliberately not: the host can charge
        // saved cards but has nowhere to keep a new one.
        instruments: {
          list: async () => [],
          resolve: async () => ({ token: null, owned: false }),
        },
      },
    });

    for (const path of ['/cards/begin', '/cards/complete'] as const) {
      const { status, body } = await call(world.routes, 'POST', path, { token: 'tok_1' });
      expect(status).toBe(404);
      expect(body.code).toBe('VAULT_NOT_ENABLED');
    }
    // Refused BEFORE the adapter: a token vaulted at the provider with no
    // host row would be an instrument nothing can ever charge or remove.
    expect(seam.begin).toEqual([]);
    expect(seam.complete).toEqual([]);
  });

  it('given a host without the vault ownership port, when either vault route is called, then NotEnabled answers and the adapter is never reached', async () => {
    const seam = seamLog();
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: vaultingAdapter('alpha', seam) }],
      config: { vault: undefined },
    });

    for (const path of ['/cards/begin', '/cards/complete'] as const) {
      const { status, body } = await call(world.routes, 'POST', path, { token: 'tok_1' });
      expect(status).toBe(404);
      expect(body.code).toBe('VAULT_NOT_ENABLED');
    }
    expect(seam.begin).toEqual([]);
    expect(seam.complete).toEqual([]);
  });

  it('given an unauthenticated request, when a vault route is called, then it is refused exactly like every other BUYER row', async () => {
    const seam = seamLog();
    const seen: string[] = [];
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: vaultingAdapter('alpha', seam) }],
      config: {
        requireAuth: (_request, intent) => {
          seen.push(intent.kind);
          return new Response('nope', { status: 401 });
        },
      },
    });

    for (const path of ['/cards/begin', '/cards/complete'] as const) {
      expect((await call(world.routes, 'POST', path, {})).status).toBe(401);
    }
    expect(seen).toEqual(['beginVault', 'completeVault']);
    expect(seam.begin).toEqual([]);
    expect(seam.complete).toEqual([]);
  });
});
