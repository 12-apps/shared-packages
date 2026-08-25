import { describe, expect, it } from 'vitest';

import type { PaymentsCopyResolver } from '../../copy-source';
import type { CheckoutCopy } from '../copy';

import { call, setupCheckoutWorld } from './harness';

/**
 * A DECLINE IS READ BY THE BUYER WHOSE CARD WAS REFUSED.
 *
 * `PaymentFlowsBEConfig.copy` was a plain pack and `createRuntime` froze it on
 * its fifth line, so every buyer at every store was refused in whichever
 * language the process happened to boot in — and a deployment with one audience
 * could not tell that apart from working. The providers half of this package
 * had taken a resolver already; the checkout half, which is the money path, had
 * not.
 *
 * What is asserted here is the property that was missing rather than the
 * plumbing: that two requests to the SAME mount can be refused in two
 * languages. The plumbing is what was already there and inert.
 *
 * The sentinels stay machine-readable for the reason `harness.ts` gives —
 * asserting on prose would tie this package's tests to one host's product copy,
 * which is the thing the copy port exists to stop.
 */

/**
 * The harness's own table, read back off a world built with it, so this file
 * never restates the sentinels it does not care about.
 */
const HARNESS_COPY: CheckoutCopy = {
  notConfigured: 'copy.notConfigured',
  chainExhausted: (method) => `copy.chainExhausted.${method}`,
  unresolvedCharge: 'copy.unresolvedCharge',
  chargeMismatch: 'copy.chargeMismatch',
  instrumentNotUsableHere: 'copy.instrumentNotUsableHere',
  payableNotFound: 'copy.payableNotFound',
  buyerFieldMissing: (fields) => `copy.missing.${[...fields].join('+')}`,
  buyerFieldInvalid: (field) => `copy.invalid.${field}`,
  genericProviderRefusal: 'copy.generic',
} as CheckoutCopy;

const PACK: Record<string, CheckoutCopy['notConfigured']> = {
  'pt-BR': 'copy.notConfigured.pt-BR',
  'en-US': 'copy.notConfigured.en-US',
};

/**
 * A host's resolver, in the shape `localeCopy(PACK)` produces.
 *
 * Only `notConfigured` varies: the rest of the table is the harness's, so a
 * failure here can only be about which language was chosen.
 */
function packResolver(base: CheckoutCopy): PaymentsCopyResolver<CheckoutCopy> {
  return ({ locale }) => ({
    ...base,
    notConfigured: PACK[String(locale)] ?? PACK['pt-BR']!,
  });
}

/** The host's own reader — `?lang=`, which is all this fixture needs. */
const localeFromQuery = (request: Request): string | null =>
  new URL(request.url).searchParams.get('lang');

/**
 * One refusal from a mount whose merchant cannot be attributed — the cheapest
 * reachable worded state, and one that runs before any adapter.
 */
async function refusalFor(lang: string | null): Promise<{ status: number; error: unknown }> {
  const { routes } = setupCheckoutWorld({
    config: {
      resolveMerchant: () => null,
      copy: packResolver(HARNESS_COPY),
      locale: localeFromQuery,
    },
  });
  const answer = await call(routes, 'POST', lang === null ? '/' : `/?lang=${lang}`, {
    method: 'PIX',
  });
  return { status: answer.status, error: answer.body.error };
}

describe('a checkout refusal is written in the buyer’s language', () => {
  it('answers the default rendering when the request asks for nothing', async () => {
    // "Nobody said" is not "the default is fine" — it is the resolver that
    // turns the absence into one, in the single place a reader can find it.
    const refusal = await refusalFor(null);
    expect(refusal.status).toBe(409);
    expect(refusal.error).toBe('copy.notConfigured.pt-BR');
  });

  it('answers en-US when the buyer asked for English', async () => {
    // The assertion that fails the moment the mount stops scoping per request.
    // Before it did, this came back in the boot language with everything green.
    const refusal = await refusalFor('en-US');
    expect(refusal.status).toBe(409);
    expect(refusal.error).toBe('copy.notConfigured.en-US');
  });

  it('refuses two buyers on one mount in two languages', async () => {
    /**
     * The property a per-mount resolution cannot have, and the reason rule B
     * is stated as "resolve where the sentence is used": ONE process, ONE
     * assembled route table, two readers. A factory that resolved at
     * construction passes both of the tests above if the fixture happens to
     * build a world per case — this one it cannot pass.
     */
    const { routes } = setupCheckoutWorld({
      config: {
        resolveMerchant: () => null,
        copy: packResolver(HARNESS_COPY),
        locale: localeFromQuery,
      },
    });

    const pt = await call(routes, 'POST', '/?lang=pt-BR', { method: 'PIX' });
    const en = await call(routes, 'POST', '/?lang=en-US', { method: 'PIX' });

    expect(pt.body.error).toBe('copy.notConfigured.pt-BR');
    expect(en.body.error).toBe('copy.notConfigured.en-US');
  });

  it('leaves a host that passed a plain pack exactly as it was', async () => {
    // The compatibility half. A single-audience host passes a value, no
    // `locale` port is consulted, and the mount behaves as it always did.
    const { routes } = setupCheckoutWorld({ config: { resolveMerchant: () => null } });
    const answer = await call(routes, 'POST', '/?lang=en-US', { method: 'PIX' });
    expect(answer.body.error).toBe('copy.notConfigured');
  });
});
