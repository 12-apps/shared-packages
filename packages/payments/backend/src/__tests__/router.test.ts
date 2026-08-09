import { describe, expect, it, vi } from 'vitest';

import type { MerchantRef } from '../core/types';
import type { PaymentsHttpHandlers } from '../http/handlers';
import {
  mountPayments,
  type MountPaymentsOptions,
  type PaymentsRouteIntent,
} from '../http/router';

/**
 * `mountPayments` (FUT-559) — the contract every host leans on:
 *
 *   1. the canonical table dispatches each (method, segments) pair to the ONE
 *      library handler it means, with the arguments that handler's signature
 *      wants;
 *   2. `requireAuth` sees the parsed intent and can refuse BEFORE any handler
 *      (or any body read) runs;
 *   3. a mount can exclude built-ins, add host extensions, sit below a
 *      prefix, and keep the host's own 404/405 bodies.
 */

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 't1' };

const ok = (): Promise<Response> => Promise.resolve(Response.json({ ok: true }));

function fakeHttp(): PaymentsHttpHandlers {
  return {
    getClientConfig: vi.fn(ok),
    createCharge: vi.fn(ok),
    getCharge: vi.fn(ok),
    handleWebhook: vi.fn(ok),
    getSettings: vi.fn(ok),
    saveCredentials: vi.fn(ok),
    setEnabled: vi.fn(ok),
    setPriorities: vi.fn(ok),
    setFailoverPolicy: vi.fn(ok),
    verify: vi.fn(ok),
    getSetupGuide: vi.fn(ok),
    beginOAuth: vi.fn(ok),
    completeOAuth: vi.fn(ok),
    disconnectOAuth: vi.fn(ok),
    beginVault: vi.fn(ok),
    completeVault: vi.fn(ok),
    forgetVault: vi.fn(ok),
  };
}

interface World {
  http: PaymentsHttpHandlers;
  routes: ReturnType<typeof mountPayments<{ user: string }>>;
  seenIntents: PaymentsRouteIntent[];
}

function mount(overrides: Partial<MountPaymentsOptions<{ user: string }>> = {}): World {
  const http = fakeHttp();
  const seenIntents: PaymentsRouteIntent[] = [];
  const routes = mountPayments<{ user: string }>({
    gateway: http,
    requireAuth: (_request, intent) => {
      seenIntents.push(intent);
      return { user: 'admin' };
    },
    resolveMerchant: () => MERCHANT,
    ...overrides,
  });
  return { http, routes, seenIntents };
}

const url = 'http://payments.test/mounted';
const request = (method: string, body?: unknown): Request =>
  new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const params = (segments: string[]): { params: { segments: string[] } } => ({
  params: { segments },
});

describe('mountPayments — canonical dispatch', () => {
  it('GET config → getClientConfig(ctx)', async () => {
    const { http, routes } = mount();
    await routes.GET(request('GET'), params(['config']));
    expect(http.getClientConfig).toHaveBeenCalledWith({ merchant: MERCHANT });
  });

  it('POST charges → createCharge(request, ctx)', async () => {
    const { http, routes } = mount();
    const req = request('POST', {});
    await routes.POST(req, params(['charges']));
    expect(http.createCharge).toHaveBeenCalledWith(req, { merchant: MERCHANT });
  });

  it('GET charges/:provider/:chargeId → getCharge(ctx, provider, id)', async () => {
    const { http, routes } = mount();
    await routes.GET(request('GET'), params(['charges', 'stone', 'ch_9']));
    expect(http.getCharge).toHaveBeenCalledWith({ merchant: MERCHANT }, 'stone', 'ch_9');
  });

  it('POST webhooks/:provider → handleWebhook(request, ctx, provider)', async () => {
    const { http, routes } = mount();
    const req = request('POST', {});
    await routes.POST(req, params(['webhooks', 'stripe']));
    expect(http.handleWebhook).toHaveBeenCalledWith(req, { merchant: MERCHANT }, 'stripe');
  });

  it('GET settings → getSettings(ctx)', async () => {
    const { http, routes } = mount();
    await routes.GET(request('GET'), params(['settings']));
    expect(http.getSettings).toHaveBeenCalledWith({ merchant: MERCHANT });
  });

  it('PUT settings/priorities → setPriorities(request, ctx)', async () => {
    const { http, routes } = mount();
    const req = request('PUT', { providers: [] });
    await routes.PUT(req, params(['settings', 'priorities']));
    expect(http.setPriorities).toHaveBeenCalledWith(req, { merchant: MERCHANT });
  });

  it('PUT settings/failover-policy → setFailoverPolicy(request, ctx)', async () => {
    const { http, routes } = mount();
    const req = request('PUT', { policy: 'TECHNICAL' });
    await routes.PUT(req, params(['settings', 'failover-policy']));
    expect(http.setFailoverPolicy).toHaveBeenCalledWith(req, { merchant: MERCHANT });
  });

  it('GET settings/guides/:provider → getSetupGuide(ctx, provider)', async () => {
    const { http, routes } = mount();
    await routes.GET(request('GET'), params(['settings', 'guides', 'pagbank']));
    expect(http.getSetupGuide).toHaveBeenCalledWith({ merchant: MERCHANT }, 'pagbank');
  });

  it('PUT settings/providers/:provider → saveCredentials(request, ctx, provider)', async () => {
    const { http, routes } = mount();
    const req = request('PUT', {});
    await routes.PUT(req, params(['settings', 'providers', 'infinitepay']));
    expect(http.saveCredentials).toHaveBeenCalledWith(req, { merchant: MERCHANT }, 'infinitepay');
  });

  it('PUT settings/providers/:provider/enabled → setEnabled(request, ctx, provider)', async () => {
    const { http, routes } = mount();
    const req = request('PUT', { enabled: true });
    await routes.PUT(req, params(['settings', 'providers', 'pagbank', 'enabled']));
    expect(http.setEnabled).toHaveBeenCalledWith(req, { merchant: MERCHANT }, 'pagbank');
  });

  it('POST .../verify → verify(ctx, provider, environment) with the query env', async () => {
    const { http, routes } = mount();
    const req = new Request(`${url}?environment=PRODUCTION`, { method: 'POST' });
    await routes.POST(req, params(['settings', 'providers', 'pagbank', 'verify']));
    expect(http.verify).toHaveBeenCalledWith({ merchant: MERCHANT }, 'pagbank', 'PRODUCTION');
  });

  it('POST .../verify treats an unknown env as absent — lenient by contract', async () => {
    const { http, routes } = mount();
    const req = new Request(`${url}?environment=staging`, { method: 'POST' });
    await routes.POST(req, params(['settings', 'providers', 'pagbank', 'verify']));
    expect(http.verify).toHaveBeenCalledWith({ merchant: MERCHANT }, 'pagbank', undefined);
  });

  it('POST .../oauth/begin|complete|disconnect → the three connect handlers', async () => {
    const { http, routes } = mount();
    const req = request('POST', {});
    await routes.POST(req, params(['settings', 'providers', 'stripe', 'oauth', 'begin']));
    await routes.POST(req, params(['settings', 'providers', 'stripe', 'oauth', 'complete']));
    await routes.POST(req, params(['settings', 'providers', 'stripe', 'oauth', 'disconnect']));
    expect(http.beginOAuth).toHaveBeenCalledWith(req, { merchant: MERCHANT }, 'stripe');
    expect(http.completeOAuth).toHaveBeenCalledWith(req, { merchant: MERCHANT }, 'stripe');
    expect(http.disconnectOAuth).toHaveBeenCalledWith({ merchant: MERCHANT }, 'stripe');
  });
});

describe('mountPayments — the host keeps auth', () => {
  it('hands requireAuth the parsed intent, provider capture included', async () => {
    const { routes, seenIntents } = mount();
    await routes.PUT(request('PUT', {}), params(['settings', 'providers', 'pagbank', 'enabled']));
    expect(seenIntents).toEqual([
      expect.objectContaining({
        kind: 'setEnabled',
        method: 'PUT',
        provider: 'pagbank',
        segments: ['settings', 'providers', 'pagbank', 'enabled'],
      }),
    ]);
  });

  it('a Response from requireAuth refuses BEFORE any handler runs', async () => {
    const { http, routes } = mount({
      requireAuth: () => Response.json({ error: 'no' }, { status: 403 }),
    });
    const res = await routes.PUT(request('PUT', {}), params(['settings', 'providers', 'pagbank']));
    expect(res.status).toBe(403);
    expect(http.saveCredentials).not.toHaveBeenCalled();
  });

  it('no intent, no auth: an unmatched path never calls requireAuth', async () => {
    const { routes, seenIntents } = mount();
    const res = await routes.GET(request('GET'), params(['nope']));
    expect(res.status).toBe(404);
    expect(seenIntents).toEqual([]);
  });

  it('resolveMerchant scopes every call — the ctx is the host answer', async () => {
    const { http, routes } = mount({
      resolveMerchant: () => ({ kind: 'PLATFORM', id: 'platform' }),
    });
    await routes.GET(request('GET'), params(['settings']));
    expect(http.getSettings).toHaveBeenCalledWith({
      merchant: { kind: 'PLATFORM', id: 'platform' },
    });
  });
});

describe('mountPayments — mount shaping', () => {
  it('prefix: a mount below settings/providers matches on the remainder', async () => {
    const { http, routes } = mount({ prefix: ['settings', 'providers'] });
    const req = request('PUT', {});
    await routes.PUT(req, params(['pagbank']));
    expect(http.saveCredentials).toHaveBeenCalledWith(req, { merchant: MERCHANT }, 'pagbank');
  });

  it('exclude: an excluded built-in answers 404, not its handler', async () => {
    const { http, routes } = mount({ exclude: ['completeOAuth'] });
    const res = await routes.POST(
      request('POST', {}),
      params(['settings', 'providers', 'pagbank', 'oauth', 'complete']),
    );
    expect(res.status).toBe(404);
    expect(http.completeOAuth).not.toHaveBeenCalled();
  });

  it('extensions: a host intent rides the same parse → auth → dispatch path', async () => {
    const handler = vi.fn(ok);
    const { routes, seenIntents } = mount({
      extensions: [
        {
          kind: 'hostThing',
          method: 'POST',
          pattern: ['settings', 'providers', ':provider', 'host-thing'],
          handler,
        },
      ],
    });
    const req = request('POST', {});
    await routes.POST(req, params(['settings', 'providers', 'stone', 'host-thing']));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        request: req,
        auth: { user: 'admin' },
        merchant: MERCHANT,
        intent: expect.objectContaining({ kind: 'hostThing', provider: 'stone' }),
      }),
    );
    expect(seenIntents).toEqual([expect.objectContaining({ kind: 'hostThing' })]);
  });

  it('a wrong verb answers 405 naming the verbs that DO serve the path', async () => {
    const { routes } = mount();
    const res = await routes.GET(request('GET'), params(['settings', 'providers', 'pagbank']));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('PUT, OPTIONS');
  });

  it('the host can shape 404/405 to its own house bodies', async () => {
    const { routes } = mount({
      notFound: () => Response.json({ error: 'Not found.' }, { status: 404 }),
      methodNotAllowed: (allow) =>
        Response.json(
          { error: 'Método não permitido.' },
          { status: 405, headers: { allow: allow.join(', ') } },
        ),
    });
    const missing = await routes.GET(request('GET'), params(['nope']));
    expect(await missing.json()).toEqual({ error: 'Not found.' });
    const wrongVerb = await routes.GET(request('GET'), params(['charges']));
    expect(wrongVerb.status).toBe(405);
    expect(await wrongVerb.json()).toEqual({ error: 'Método não permitido.' });
  });

  it('an empty path segment never matches a capture — `//` stays 404', async () => {
    const { http, routes } = mount();
    const res = await routes.PUT(request('PUT', {}), params(['settings', 'providers', '']));
    expect(res.status).toBe(404);
    expect(http.saveCredentials).not.toHaveBeenCalled();
  });

  it('accepts promised params and a string segments value alike', async () => {
    const { http, routes } = mount();
    await routes.GET(request('GET'), {
      params: Promise.resolve({ segments: 'settings/guides/pagbank' }),
    });
    expect(http.getSetupGuide).toHaveBeenCalledWith({ merchant: MERCHANT }, 'pagbank');
  });
});

describe('mountPayments — the verbs answered from the table', () => {
  it('OPTIONS answers 204 with the per-path Allow, and never authenticates', async () => {
    const { routes, seenIntents } = mount();
    const res = await routes.OPTIONS(request('OPTIONS'), params(['settings', 'providers', 'pagbank']));
    expect(res.status).toBe(204);
    expect(res.headers.get('allow')).toBe('PUT, OPTIONS');
    expect(res.body).toBeNull();
    expect(seenIntents).toEqual([]);
  });

  it('OPTIONS off the table is the mount 404, not an empty 204', async () => {
    const { routes } = mount();
    const res = await routes.OPTIONS(request('OPTIONS'), params(['nope']));
    expect(res.status).toBe(404);
  });

  it('miss answers a per-path 405 on a known path and 404 off the table', async () => {
    const world = mount();
    const { miss } = world.routes;
    const known = await miss(request('DELETE'), params(['settings', 'providers', 'pagbank']));
    expect(known.status).toBe(405);
    expect(known.headers.get('allow')).toBe('PUT, OPTIONS');
    const unknown = await miss(request('DELETE'), params(['nope']));
    expect(unknown.status).toBe(404);
    expect(world.seenIntents).toEqual([]);
  });

  it('preflight is null for a dispatchable pair and the static answer otherwise', async () => {
    const world = mount();
    const { preflight } = world.routes;
    const dispatchable = await preflight('PUT', params(['settings', 'providers', 'pagbank']));
    expect(dispatchable).toBeNull();
    const wrongVerb = await preflight('GET', params(['settings', 'providers', 'pagbank']));
    expect(wrongVerb?.status).toBe(405);
    const offTable = await preflight('GET', params(['nope']));
    expect(offTable?.status).toBe(404);
    // Resolution alone must never reach a handler.
    expect(world.http.saveCredentials).not.toHaveBeenCalled();
  });
});
