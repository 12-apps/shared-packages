import { afterEach, describe, expect, it, vi } from 'vitest';

import { pagbankProvider } from '../providers/pagbank';
import { stoneProvider } from '../providers/stone';
import { stripeProvider } from '../providers/stripe';
import { PT_BR_PAGBANK_COPY, PT_BR_STONE_COPY, PT_BR_STRIPE_COPY } from '../providers/pt-BR';

/**
 * FUT-695 — a probe that never got an answer must say UNREACHABLE.
 *
 * `runVerify` refuses to persist a verdict only for `fault: 'UNREACHABLE'`,
 * and until this suite's fix only InfinitePay ever said it: Stripe, PagBank
 * and Stone answered a network failure with a bare `{ok: false}`, so a DNS
 * blip during "Testar conexão" stamped `FAILED` over perfectly good
 * credentials and the only way back was re-saving them.
 *
 * The dividing line is the same one `infinitepay-verify.test.ts` pins: a
 * transport failure carries a `cause.code`; a bug of ours does not, and must
 * NOT be reported as the provider being down.
 */
describe('verifyCredentials transport classification (stripe, pagbank, stone)', () => {
  const ADAPTERS = [
    {
      name: 'stripe',
      probe: () =>
        stripeProvider(PT_BR_STRIPE_COPY).verifyCredentials({
          environment: 'PRODUCTION',
          fields: { secretKey: 'sk_live_x' },
          stub: false,
        }),
    },
    {
      name: 'pagbank',
      probe: () =>
        pagbankProvider(PT_BR_PAGBANK_COPY).verifyCredentials({
          environment: 'PRODUCTION',
          fields: { token: 'tok-x' },
          stub: false,
        }),
    },
    {
      name: 'stone',
      probe: () =>
        stoneProvider(PT_BR_STONE_COPY).verifyCredentials({
          environment: 'PRODUCTION',
          fields: { secretKey: 'sk_live_x' },
          stub: false,
        }),
    },
  ] as const;

  afterEach(() => vi.unstubAllGlobals());

  for (const { name, probe } of ADAPTERS) {
    it(`${name}: a network failure is UNREACHABLE, not a failed credential`, async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      });
      await expect(probe()).resolves.toMatchObject({ ok: false, fault: 'UNREACHABLE' });
    });

    it(`${name}: a bug of ours is NOT an outage — no UNREACHABLE without evidence`, async () => {
      // Same class, no cause code: the shape our own throws wear.
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('reading undefined');
      });
      const result = await probe();
      expect(result.ok).toBe(false);
      expect(result.fault).not.toBe('UNREACHABLE');
    });

    it(`${name}: a 401 is a real refusal and stays recordable`, async () => {
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      );
      await expect(probe()).resolves.toMatchObject({ ok: false, fault: 'REFUSED' });
    });
  }

  // The PagBank probe reads a REFUSAL by status, and only 401/403 mean a bad
  // token. It asks with a bogus order id: a right token gets 404 (not found),
  // but PagBank may answer 400 if it rejects the id's shape first — and a 400 is
  // still PAST the auth layer, so the token is good. Stamping FAILED on it would
  // resurrect FUT-695 through an un-enumerated status, so both must pass.
  for (const status of [400, 404] as const) {
    it(`pagbank: a ${status} for the bogus probe id keeps a good token (FUT-695)`, async () => {
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(JSON.stringify({ error_messages: [{ code: 'not_this_auth' }] }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      );
      const result = await pagbankProvider(PT_BR_PAGBANK_COPY).verifyCredentials({
        environment: 'PRODUCTION',
        fields: { token: 'tok-x' },
        stub: false,
      });
      expect(result).toMatchObject({ ok: true });
    });
  }
});
