import { describe, expect, it, vi } from 'vitest';

import type { PaymentsGateway } from '../core/gateway';
import type { MerchantRef } from '../core/types';
import { createPaymentsHttp, type PaymentsHttpDeps } from '../http/handlers';
import { mountPayments } from '../http/router';
import type { VaultRequestResolvers } from '../http/vault-handlers';

/**
 * The card-vault HTTP surface (FUT-761). The gateway verbs and both vaulting
 * adapters predate this; what was missing was the dispatch — so every host
 * hand-wrote the same three routes. Pinned here: the ownership facts
 * (`reference`, `instrumentId`) reach the gateway from the HOST's resolvers,
 * never from the request body; the browser contributes exactly one fact
 * (the session id it confirmed); and an unwired host keeps 404ing.
 */

const MERCHANT: MerchantRef = { kind: 'PLATFORM', id: 'platform' };

const SESSION = { provider: 'stripe', tokenization: 'SDK', clientSecret: 'seti_secret' };
const INSTRUMENT = { provider: 'stripe', instrumentId: 'pm_1', brand: 'visa', last4: '4242' };

function harness(resolvers?: VaultRequestResolvers) {
  const gateway = {
    beginVault: vi.fn(async () => SESSION),
    completeVault: vi.fn(async () => INSTRUMENT),
    forgetVault: vi.fn(async () => undefined),
  } as unknown as PaymentsGateway;
  const http = createPaymentsHttp({
    gateway,
    settings: {} as never,
    charges: {} as never,
    resolveChargeRequest: async () => {
      throw new Error('not used');
    },
    resolveVaultRequests: resolvers,
  } as PaymentsHttpDeps);
  const routes = mountPayments({
    gateway: http,
    requireAuth: async () => ({ authorized: true }),
    resolveMerchant: () => MERCHANT,
  });
  return { gateway, routes };
}

const RESOLVERS: VaultRequestResolvers = {
  begin: async () => ({
    reference: 'sub-42',
    customer: { name: 'Loja Acme', email: 'acme@example.test', taxId: '12345678000199' },
    customerRef: 'cus_9',
  }),
  complete: async (_merchant, browser) => ({
    reference: 'sub-42',
    customerRef: 'cus_9',
    sessionId: browser.sessionId,
  }),
  forget: async () => ({ instrumentId: 'pm_1', customerRef: 'cus_9' }),
};

function post(body?: unknown): Request {
  return new Request('https://host.test/api/payments', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const at = (segments: string[]): { params: { segments: string[] } } => ({ params: { segments } });

describe('the vault HTTP surface', () => {
  it('begin: the gateway receives the HOST-resolved input, never a request body', async () => {
    const { gateway, routes } = harness(RESOLVERS);

    const res = await routes.POST(
      post({ reference: 'attacker-owns-this' }),
      at(['vault', 'begin']),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SESSION);
    // The resolver's reference, not the body's — the ownership fact.
    expect(gateway.beginVault).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({ reference: 'sub-42', customerRef: 'cus_9' }),
    );
  });

  it('complete: the confirmed session id is the one browser fact passed through', async () => {
    const { gateway, routes } = harness(RESOLVERS);

    const res = await routes.POST(post({ sessionId: 'seti_1' }), at(['vault', 'complete']));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(INSTRUMENT);
    expect(gateway.completeVault).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({ reference: 'sub-42', sessionId: 'seti_1' }),
    );
  });

  it('complete: a body-less request is legal — PagBank completes off the begin alone', async () => {
    const { gateway, routes } = harness(RESOLVERS);

    const res = await routes.POST(post(), at(['vault', 'complete']));

    expect(res.status).toBe(200);
    expect(gateway.completeVault).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({ sessionId: undefined }),
    );
  });

  it('forget: detaches at the NAMED provider with the host-resolved instrument', async () => {
    const { gateway, routes } = harness(RESOLVERS);

    const res = await routes.POST(post(), at(['vault', 'pagbank', 'forget']));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forgotten: true });
    expect(gateway.forgetVault).toHaveBeenCalledWith(
      MERCHANT,
      'pagbank',
      expect.objectContaining({ instrumentId: 'pm_1' }),
    );
  });

  it('answers 404 on every vault route when no resolvers are wired', async () => {
    const { gateway, routes } = harness(undefined);

    for (const segments of [['vault', 'begin'], ['vault', 'complete'], ['vault', 'pagbank', 'forget']]) {
      const res = await routes.POST(post(), at(segments));
      expect(res.status).toBe(404);
    }
    expect(gateway.beginVault).not.toHaveBeenCalled();
    expect(gateway.completeVault).not.toHaveBeenCalled();
    expect(gateway.forgetVault).not.toHaveBeenCalled();
  });
});
