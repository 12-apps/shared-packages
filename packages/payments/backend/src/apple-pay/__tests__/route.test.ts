import { describe, expect, it, vi } from 'vitest';

import { selfSignedIdentity } from '../../providers/__tests__/pki';
import { createApplePayMerchantValidation, type ApplePayMerchantValidationOptions } from '../route';
import type { ApplePayMerchantIdentity } from '../types';

/** The one-route mount: what a host's route file exports, driven as a browser would post to it. */

const PKI = selfSignedIdentity('merchant.com.example');
const SESSION = { merchantSessionIdentifier: 'opaque' };
const URL_OK = 'https://apple-pay-gateway-cert.apple.com/paymentservices/startSession';

const IDENTITY: ApplePayMerchantIdentity = {
  merchantIdentifier: 'merchant.com.example',
  displayName: 'Loja Exemplo',
  certificate: PKI.cert,
  privateKey: PKI.key,
};

function mount(over: Partial<ApplePayMerchantValidationOptions> = {}) {
  const bodies: string[] = [];
  const warn = vi.fn();
  const route = createApplePayMerchantValidation({
    identity: { merchantIdentity: async () => IDENTITY },
    resolveMerchant: () => ({ kind: 'TENANT', id: 'store-1' }),
    transport: () => async (_url, init) => {
      bodies.push(init.body ?? '');
      return Response.json(SESSION);
    },
    logger: { warn },
    ...over,
  });
  return { route, bodies, warn };
}

function post(body: unknown, origin: string | null = 'https://loja.example.com'): Request {
  return new Request('https://api.example.com/api/checkout/apple-pay/merchant-session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('createApplePayMerchantValidation', () => {
  it('answers the opaque session in the checkout envelope, validated for the Origin domain', async () => {
    const { route, bodies } = mount();
    const response = await route.POST(post({ validationURL: URL_OK }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: SESSION });
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ initiativeContext: 'loja.example.com' });
  });

  it('uses the body domain only when no Origin came', async () => {
    const { route, bodies } = mount();
    const response = await route.POST(post({ validationURL: URL_OK, domain: 'loja.example.com' }, null));
    expect(response.status).toBe(200);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ initiativeContext: 'loja.example.com' });
  });

  it('refuses a body domain that disagrees with the Origin', async () => {
    const { route, bodies } = mount();
    const response = await route.POST(post({ validationURL: URL_OK, domain: 'victim.example.com' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_DOMAIN', code: 'INVALID_DOMAIN' });
    expect(bodies).toHaveLength(0);
  });

  it('refuses a non-Apple validation URL with 400 and dials nothing', async () => {
    const { route, bodies, warn } = mount();
    const response = await route.POST(post({ validationURL: 'https://apple-pay-gateway.apple.com.evil.com/x' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_VALIDATION_URL', code: 'INVALID_VALIDATION_URL' });
    expect(bodies).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([['not json'], [[]], [{}], [{ validationURL: 42 }]])('refuses a malformed body (%j) with 400', async (body) => {
    // Not `response`: the flakiness lint does not see an `it.each` body as a
    // test, so a name declared here reads to it as shared with the tests below.
    const { route } = mount();
    const malformed = await route.POST(post(body));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a body over 4 KB with 400, before the identity is read', async () => {
    const merchantIdentity = vi.fn(async () => IDENTITY);
    const { route } = mount({ identity: { merchantIdentity } });
    const oversized = await route.POST(post({ validationURL: URL_OK, padding: 'x'.repeat(5000) }));
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toMatchObject({ code: 'BAD_REQUEST' });
    expect(merchantIdentity).not.toHaveBeenCalled();
  });

  it('refuses a declared content-length over 4 KB without reading the body', async () => {
    const { route } = mount();
    const request = new Request('https://api.example.com/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '100000', origin: 'https://loja.example.com' },
      body: JSON.stringify({ validationURL: URL_OK }),
    });
    const declared = await route.POST(request);
    expect(declared.status).toBe(400);
  });

  it('answers 503 IDENTITY_UNAVAILABLE when the identity port fails', async () => {
    const { route } = mount({
      identity: {
        merchantIdentity: async () => {
          throw new Error('vault down');
        },
      },
    });
    const unavailable = await route.POST(post({ validationURL: URL_OK }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'IDENTITY_UNAVAILABLE', code: 'IDENTITY_UNAVAILABLE' });
  });

  it('answers 409 APPLE_PAY_NOT_CONFIGURED when there is no merchant identity', async () => {
    const { route } = mount({ identity: { merchantIdentity: async () => null } });
    const response = await route.POST(post({ validationURL: URL_OK }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'APPLE_PAY_NOT_CONFIGURED', code: 'APPLE_PAY_NOT_CONFIGURED' });
  });

  it("answers 502 on Apple's refusal without forwarding Apple's body", async () => {
    const { route } = mount({
      transport: () => async () => new Response('{"statusMessage":"internal detail"}', { status: 500 }),
    });
    const response = await route.POST(post({ validationURL: URL_OK }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('internal detail');
  });

  it('answers 504 on a timeout', async () => {
    const { route } = mount({
      transport: () => async () => {
        throw Object.assign(new Error('idle'), { code: 'ETIMEDOUT' });
      },
    });
    const response = await route.POST(post({ validationURL: URL_OK }));
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: 'TIMEOUT' });
  });

  it("returns the host's own refusal from resolveMerchant untouched, before reading anything", async () => {
    const merchantIdentity = vi.fn(async () => IDENTITY);
    const { route } = mount({
      identity: { merchantIdentity },
      resolveMerchant: () => new Response('no such store', { status: 404 }),
    });
    const response = await route.POST(post({ validationURL: URL_OK }));
    expect(response.status).toBe(404);
    expect(merchantIdentity).not.toHaveBeenCalled();
  });

  it('never logs secret material', async () => {
    const other = selfSignedIdentity('someone-else');
    const { route, warn } = mount({ identity: { merchantIdentity: async () => ({ ...IDENTITY, privateKey: other.key }) } });
    const response = await route.POST(post({ validationURL: URL_OK }));
    expect(response.status).toBe(503);
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).not.toContain('PRIVATE KEY');
    expect(logged).not.toContain('CERTIFICATE');
  });
});
