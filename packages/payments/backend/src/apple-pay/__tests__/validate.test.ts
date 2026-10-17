import { describe, expect, it, vi } from 'vitest';

import type { ProviderHttpInit } from '../../providers/http';
import type { ClientIdentity } from '../../providers/mtls';
import { selfSignedIdentity } from '../../providers/__tests__/pki';
import type { ApplePayMerchantIdentity } from '../types';
import { ApplePayValidationError, validateApplePayMerchant, type ApplePayValidationDeps } from '../validate';

/**
 * The mTLS call is STUBBED at the transport seam: no test here reaches the
 * network. The handshake itself is `providers/mtls.ts`'s, proven against a
 * real TLS server in `providers/__tests__/mtls.test.ts`.
 */

const PKI = selfSignedIdentity('merchant.com.example');
const MERCHANT = { kind: 'TENANT', id: 'store-1' } as const;
const URL_OK = 'https://apple-pay-gateway.apple.com/paymentservices/startSession';
const SESSION = { epochTimestamp: 1, merchantSessionIdentifier: 'opaque', signature: 'abc' };

function identity(over: Partial<ApplePayMerchantIdentity> = {}): ApplePayMerchantIdentity {
  return {
    merchantIdentifier: 'merchant.com.example',
    displayName: 'Loja Exemplo',
    certificate: PKI.cert,
    privateKey: PKI.key,
    ...over,
  };
}

interface Sent {
  url: string;
  init: ProviderHttpInit;
  presented: ClientIdentity;
}

function deps(
  answer: (url: string, init: ProviderHttpInit) => Promise<Response>,
  found: ApplePayMerchantIdentity | null = identity(),
  over: Partial<ApplePayValidationDeps> = {},
): { deps: ApplePayValidationDeps; sent: Sent[]; lookups: () => number } {
  const sent: Sent[] = [];
  const merchantIdentity = vi.fn(async () => found);
  return {
    sent,
    lookups: () => merchantIdentity.mock.calls.length,
    deps: {
      identity: { merchantIdentity },
      transport: (presented) => async (url, init) => {
        sent.push({ url, init, presented });
        return answer(url, init);
      },
      ...over,
    },
  };
}

const ok = async (): Promise<Response> => Response.json(SESSION);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApplePayValidationError);
  return (error as ApplePayValidationError).code;
}

describe('validateApplePayMerchant', () => {
  it('posts Apple\'s documented body over the merchant identity and returns the session untouched', async () => {
    const world = deps(ok);
    const result = await validateApplePayMerchant(
      { validationURL: URL_OK, domain: 'Loja.Example.com', merchant: MERCHANT },
      world.deps,
    );

    expect(result).toEqual({ status: 'VALIDATED', session: SESSION });
    expect(world.sent).toHaveLength(1);
    const [call] = world.sent;
    expect(call?.url).toBe(URL_OK);
    expect(call?.init.method).toBe('POST');
    expect(JSON.parse(call?.init.body ?? '')).toEqual({
      merchantIdentifier: 'merchant.com.example',
      displayName: 'Loja Exemplo',
      initiative: 'web',
      initiativeContext: 'loja.example.com',
    });
    expect(call?.presented).toEqual({ cert: PKI.cert, key: PKI.key });
  });

  it('answers NOT_CONFIGURED, and dials nothing, when the port has no merchant identity', async () => {
    const world = deps(ok, null);
    const result = await validateApplePayMerchant(
      { validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT },
      world.deps,
    );
    expect(result).toEqual({ status: 'NOT_CONFIGURED' });
    expect(world.sent).toHaveLength(0);
  });

  it.each([
    'https://apple-pay-gateway.apple.com.evil.com/paymentservices/startSession',
    'http://apple-pay-gateway.apple.com/paymentservices/startSession',
    'https://apple-pay-gateway.apple.com@evil.com/x',
    'https://apple-pay-gateway.apple.com:8443/x',
  ])('refuses %s before the identity is even loaded', async (validationURL) => {
    const world = deps(ok);
    expect(await codeOf(validateApplePayMerchant({ validationURL, domain: 'loja.example.com', merchant: MERCHANT }, world.deps))).toBe(
      'INVALID_VALIDATION_URL',
    );
    expect(world.lookups()).toBe(0);
    expect(world.sent).toHaveLength(0);
  });

  it('refuses a domain that is not an FQDN', async () => {
    const world = deps(ok);
    expect(
      await codeOf(validateApplePayMerchant({ validationURL: URL_OK, domain: 'https://loja.example.com', merchant: MERCHANT }, world.deps)),
    ).toBe('INVALID_DOMAIN');
    expect(world.sent).toHaveLength(0);
  });

  it('refuses a domain the identity is not registered for, and accepts one it is', async () => {
    const scoped = identity({ domains: ['Loja.Example.com'] });
    const refused = deps(ok, scoped);
    expect(
      await codeOf(validateApplePayMerchant({ validationURL: URL_OK, domain: 'other.example.com', merchant: MERCHANT }, refused.deps)),
    ).toBe('INVALID_DOMAIN');
    expect(refused.sent).toHaveLength(0);

    const accepted = deps(ok, scoped);
    const result = await validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, accepted.deps);
    expect(result.status).toBe('VALIDATED');
  });

  it('refuses an unusable certificate locally, without naming it', async () => {
    const other = selfSignedIdentity('someone-else');
    const world = deps(ok, identity({ privateKey: other.key }));
    const error = await validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, world.deps).catch(
      (caught: unknown) => caught as ApplePayValidationError,
    );
    expect(error).toBeInstanceOf(ApplePayValidationError);
    expect((error as ApplePayValidationError).code).toBe('IDENTITY_UNUSABLE');
    expect((error as ApplePayValidationError).message).not.toContain('PRIVATE KEY');
    expect(world.sent).toHaveLength(0);
  });

  it('surfaces a deadline as TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const world = deps(() => new Promise<Response>(() => undefined), identity(), { timeoutMs: 50 });
      const pending = codeOf(validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, world.deps));
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toBe('TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the transport's own idle timeout as TIMEOUT", async () => {
    const world = deps(async () => {
      throw Object.assign(new Error('mTLS request idle timeout'), { code: 'ETIMEDOUT' });
    });
    expect(await codeOf(validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, world.deps))).toBe(
      'TIMEOUT',
    );
  });

  it('surfaces a failed handshake as UNREACHABLE', async () => {
    const world = deps(async () => {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    });
    expect(await codeOf(validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, world.deps))).toBe(
      'UNREACHABLE',
    );
  });

  it("surfaces Apple's non-2xx as UPSTREAM_REFUSED with the status, never the body", async () => {
    const world = deps(async () => new Response('{"statusMessage":"Payment Services Exception merchantId=secret"}', { status: 400 }));
    const error = await validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, world.deps).catch(
      (caught: unknown) => caught as ApplePayValidationError,
    );
    expect(error).toBeInstanceOf(ApplePayValidationError);
    expect((error as ApplePayValidationError).code).toBe('UPSTREAM_REFUSED');
    expect((error as ApplePayValidationError).httpStatus).toBe(400);
    expect((error as ApplePayValidationError).message).not.toContain('secret');
  });

  it.each([
    ['not JSON', '<html>'],
    ['a JSON array', '[]'],
    ['a JSON string', '"session"'],
  ])('surfaces a 2xx that is %s as INVALID_RESPONSE', async (_case, body) => {
    const world = deps(async () => new Response(body, { status: 200 }));
    expect(await codeOf(validateApplePayMerchant({ validationURL: URL_OK, domain: 'loja.example.com', merchant: MERCHANT }, world.deps))).toBe(
      'INVALID_RESPONSE',
    );
  });
});
