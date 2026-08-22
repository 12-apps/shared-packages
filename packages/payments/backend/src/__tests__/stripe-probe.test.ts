import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProbeCheck, ResolvedCredentials } from '../core/types';
import { stripeProvider } from '../providers/stripe';
import { PT_BR_STRIPE_COPY } from '../providers/pt-BR';

/**
 * What "Testar conexão" establishes about a Stripe connection (FUT-796).
 *
 * The probe was a bare `GET /v1/balance`, which authenticates the secret key
 * and nothing else — so a store pasting its own keys got a green result that
 * predicted nothing about checkout. Every case here is one of that ticket's
 * scenarios, named in its own words.
 *
 * The test names carry the Given/When/Then because these are browser-invisible:
 * an owner sees the verdict, not the call that produced it.
 */

/** Stub `fetch` with one response; record the URL so the call itself is assertable. */
function stubAccount(body: unknown, status = 200): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  });
  return { urls };
}

const ACCOUNT = { id: 'acct_live_1', charges_enabled: true, payouts_enabled: true };

/** A store that pasted its own keys, all four fields filled and coherent. */
function pastedKeys(overrides: Record<string, string> = {}): ResolvedCredentials {
  return {
    environment: 'PRODUCTION',
    fields: {
      secretKey: 'sk_live_abc',
      publishableKey: 'pk_live_abc',
      webhookSecret: 'whsec_abc',
      ...overrides,
    },
  };
}

const checkFor = (checks: readonly ProbeCheck[] | undefined, key: string) =>
  checks?.find((check) => check.key === key);

afterEach(() => vi.unstubAllGlobals());

describe('stripe credential probe', () => {
  it('asks the account endpoint, so the answer can name the account', async () => {
    const { urls } = stubAccount(ACCOUNT);

    await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(pastedKeys());

    // `/v1/balance` authenticated the key and told the owner nothing else.
    expect(urls[0]).toBe('https://api.stripe.com/v1/account');
  });

  it('given a pasted secret key alone, then it reports which credentials are still missing', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials({
      environment: 'PRODUCTION',
      fields: { secretKey: 'sk_live_abc' },
    });

    expect(probe.ok).toBe(false);
    expect(checkFor(probe.checks, 'secretKey')?.status).toBe('PASS');
    // Both are absent, and both break something the owner would only discover
    // in front of a buyer: no tokenization, and no verifiable notifications.
    expect(checkFor(probe.checks, 'publishableKey')?.status).toBe('FAIL');
    expect(checkFor(probe.checks, 'webhookSecret')?.status).toBe('FAIL');
    // Named, not summarised — "confira as credenciais" is advice you can
    // follow all afternoon when the form has four fields.
    expect(probe.message).toMatch(/chave publicável/i);
  });

  it('given a wrong webhook secret, then the probe reports it rather than the first payment', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(
      pastedKeys({ webhookSecret: 'sk_live_oops' }),
    );

    expect(probe.ok).toBe(false);
    expect(checkFor(probe.checks, 'webhookSecret')?.status).toBe('FAIL');
  });

  /**
   * The honest third state. Stripe publishes no way to ask whether a signing
   * secret is the RIGHT one, so a green tick would be a claim nothing
   * established — and this is precisely the credential whose failure surfaces
   * as a payment that never confirms.
   */
  it('given a well-formed webhook secret, then it is reported unchecked, not passed', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(pastedKeys());

    expect(probe.ok).toBe(true);
    const webhook = checkFor(probe.checks, 'webhookSecret');
    expect(webhook?.status).toBe('UNCHECKED');
    expect(webhook?.message).toMatch(/não oferece como conferir/i);
  });

  it('given a pasted key, then the probe names the Stripe account it resolves to', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(pastedKeys());

    expect(checkFor(probe.checks, 'secretKey')?.message).toContain('acct_live_1');
  });

  /**
   * The classic mismatch, and it is invisible until a buyer types a card: the
   * browser mints a token in the wrong mode and Stripe refuses the charge with
   * an error about the token rather than about the key.
   */
  it('given a test publishable key beside a live secret key, then the probe refuses', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(
      pastedKeys({ publishableKey: 'pk_test_abc' }),
    );

    expect(probe.ok).toBe(false);
    expect(checkFor(probe.checks, 'publishableKey')?.status).toBe('FAIL');
  });

  /**
   * A success that does not predict a working checkout is the whole complaint.
   * An account still in document review authenticates perfectly and refuses
   * every charge.
   */
  it('given an account Stripe has not released for charging, then the probe says so', async () => {
    stubAccount({ ...ACCOUNT, charges_enabled: false });

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(pastedKeys());

    expect(probe.ok).toBe(false);
    expect(checkFor(probe.checks, 'secretKey')?.status).toBe('FAIL');
    expect(probe.message).toMatch(/não liberou cobranças/i);
  });

  it('given a connectedAccountId naming another account, then the mismatch is refused', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(
      pastedKeys({ connectedAccountId: 'acct_someone_else' }),
    );

    expect(probe.ok).toBe(false);
    // It decides which account the money lands in — the one mismatch on this
    // form that is worth stopping for.
    expect(checkFor(probe.checks, 'connectedAccountId')?.status).toBe('FAIL');
    expect(probe.message).toContain('acct_live_1');
  });

  /**
   * An authorized store copies no keys at all, so the checks written for the
   * pasted-key form must not invent failures for it — the webhook endpoint is
   * the platform's, and there is nothing for the owner to register.
   */
  it('given an OAuth connection, then the absent webhook secret is not a failure', async () => {
    stubAccount(ACCOUNT);

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials({
      environment: 'PRODUCTION',
      fields: { accessToken: 'sk_live_grant', publishableKey: 'pk_live_grant' },
    });

    expect(probe.ok).toBe(true);
    expect(checkFor(probe.checks, 'webhookSecret')?.status).toBe('UNCHECKED');
    expect(checkFor(probe.checks, 'secretKey')?.message).toMatch(/autorização/i);
  });

  /**
   * Unchanged by all of the above, and load-bearing: an unanswered probe learned
   * NOTHING about the credentials, so it must not be reported as a refusal
   * (FUT-695) — and it carries no per-field findings, because none were made.
   */
  it('given the probe never reaches Stripe, then it stays UNREACHABLE with no findings', async () => {
    // A recognised transport cause, which is what `isTransportError` reads —
    // a bare TypeError is also what one of OUR bugs looks like, and blaming
    // the provider for that would hide it.
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ENOTFOUND' },
      });
    });

    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials(pastedKeys());

    expect(probe.ok).toBe(false);
    expect(probe.fault).toBe('UNREACHABLE');
    expect(probe.checks).toBeUndefined();
  });

  it('given a stub connection, then it passes without a network call', async () => {
    const probe = await stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials({
      environment: 'SANDBOX',
      fields: {},
      stub: true,
    });

    expect(probe.ok).toBe(true);
  });
});
