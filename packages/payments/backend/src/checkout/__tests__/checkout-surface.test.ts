import { describe, expect, it } from 'vitest';

import { attemptReference, baseReference, ownsReference } from '../../core/reference';

import { call, request, setupCheckoutWorld, testAdapter } from './harness';

/**
 * THE SURFACE the mount publishes, and the two guarantees that are properties
 * of the TABLE rather than of any handler: which verbs each path serves, and
 * who may reach it.
 */
describe('createPaymentFlowsBE — the surface', () => {
  it('serves all six kinds at their canonical paths', async () => {
    const { routes } = setupCheckoutWorld();
    expect(routes.layout.map((row) => `${row.method} /${row.pattern.join('/')}`)).toEqual([
      'GET /config',
      'GET /cards',
      'POST /',
      'POST /charge',
      'GET /status',
      'POST /refresh-key',
    ]);
  });

  it('404s an unknown sub-path and 405s a wrong verb with the right Allow', async () => {
    const { routes } = setupCheckoutWorld();

    const unknown = await call(routes, 'GET', '/nope');
    expect(unknown.status).toBe(404);

    // `/charge` exists at POST only, so GET must be a 405 that SAYS so.
    const built = request('GET', '/charge');
    const wrongVerb = await routes.GET(built.request, built.context);
    expect(wrongVerb.status).toBe(405);
    expect(wrongVerb.headers.get('allow')).toBe('POST, OPTIONS');

    const options = await routes.OPTIONS(...Object.values(request('GET', '/status')) as [Request, { params: { segments: string[] } }]);
    expect(options.status).toBe(204);
    expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('excludes a row from the table without changing the others', async () => {
    const { routes } = setupCheckoutWorld({ config: { exclude: ['refreshBrowserKey'] } });
    expect(routes.layout.some((row) => row.kind === 'refreshBrowserKey')).toBe(false);
    expect((await call(routes, 'POST', '/refresh-key', { orderId: 'inv_2024_0043' })).status).toBe(
      404,
    );
  });

  /**
   * PRINCIPAL INVERSION — the mitigation that has to ship with the design.
   *
   * A host that folds six routes into one `requireAuth` can write a
   * `switch (intent.kind)` that defaults the wrong way and makes the SETTLING
   * poll anonymous. Here `requireAuth` refuses everything, and `/config` still
   * answers 200: anonymity is a property of the row, so the worst a host
   * mistake can do is over-authenticate a page load.
   */
  it('never calls requireAuth for a PUBLIC row, and always for a BUYER row', async () => {
    const seen: string[] = [];
    const { routes } = setupCheckoutWorld({
      config: {
        requireAuth: (_request, intent) => {
          seen.push(intent.kind);
          return new Response('nope', { status: 401 });
        },
      },
    });

    expect((await call(routes, 'GET', '/config')).status).toBe(200);
    expect(seen).toEqual([]);

    for (const path of ['/cards', '/status?orderId=inv_2024_0043'] as const) {
      expect((await call(routes, 'GET', path)).status).toBe(401);
    }
    for (const path of ['/', '/charge', '/refresh-key'] as const) {
      expect((await call(routes, 'POST', path, {})).status).toBe(401);
    }
    expect(seen).toEqual([
      'listInstruments',
      'getStatus',
      'createCheckout',
      'chargeInstrument',
      'refreshBrowserKey',
    ]);
  });

  it('mounts one handler per kind, dispatching by kind rather than by path', async () => {
    const { routes } = setupCheckoutWorld();
    // The shape a host with a file-per-URL router uses. No segments are given,
    // because the file already decided which row this is.
    const answer = await routes.handlers.getCheckoutConfig(
      new Request('https://shop.example/api/checkout/config'),
    );
    expect(answer.status).toBe(200);
  });
});

describe('the checkout config read', () => {
  it('publishes the whole chain, its method union, and no credential', async () => {
    const { routes } = setupCheckoutWorld({
      chain: [
        { name: 'alpha', adapter: testAdapter('alpha', { tokenization: 'REDIRECT' }) },
        { name: 'beta', adapter: testAdapter('beta') },
      ],
    });
    const { body } = await call(routes, 'GET', '/config');
    const data = body.data as Record<string, unknown>;

    // The head fields are DERIVED from chain[0] — they cannot disagree with
    // "the first provider a charge will be attempted on".
    expect(data.provider).toBe('alpha');
    expect(data.tokenization).toBe('REDIRECT');
    expect((data.chain as unknown[]).length).toBe(2);
    expect(data.methods).toEqual(['PIX', 'CARD']);
    expect(JSON.stringify(data)).not.toContain('secretKey');
  });

  it('answers a merchant with no connected provider without inventing one', async () => {
    const { routes, credentials } = setupCheckoutWorld();
    credentials.clear();
    const { body } = await call(routes, 'GET', '/config');
    expect(body.data).toMatchObject({ provider: null, methods: [], chain: [] });
  });

  it('fails closed when the host cannot attribute a merchant', async () => {
    const { routes } = setupCheckoutWorld({ config: { resolveMerchant: () => null } });
    const { status, body } = await call(routes, 'GET', '/config');
    expect(status).toBe(409);
    expect(body.code).toBe('PAYMENT_NOT_CONFIGURED');
  });
});

describe('the saved-instrument list', () => {
  it('is scoped to the merchant, and is EMPTY when nothing is chargeable there', async () => {
    const world = setupCheckoutWorld();
    expect((await call(world.routes, 'GET', '/cards')).body.data).toHaveLength(1);

    // FUT-697: no chain means no provider could charge any instrument, so
    // offering one would only produce a decline that blames the buyer's card.
    world.credentials.clear();
    expect((await call(world.routes, 'GET', '/cards')).body.data).toEqual([]);
  });
});

/**
 * THE ON-DISK COMPATIBILITY PIN.
 *
 * These two assertions guard rows already written. `attemptReference(x, 0) === x`
 * is what keeps every charge stored before the convention findable, and
 * exact-or-suffix is what stops a lookup reaching a DIFFERENT payable whose
 * handle merely starts with the same characters.
 */
describe('the `--` attempt-reference convention', () => {
  it('leaves attempt 0 as the bare handle', () => {
    expect(attemptReference('abc', 0)).toBe('abc');
    expect(attemptReference('abc', 1)).toBe('abc--1');
    expect(baseReference('abc--7')).toBe('abc');
  });

  it('claims its own attempts and refuses a neighbour that merely shares a prefix', () => {
    expect(ownsReference('abc', 'abc')).toBe(true);
    expect(ownsReference('abc', 'abc--1')).toBe(true);
    expect(ownsReference('abc', 'abcd')).toBe(false);
    expect(ownsReference('abc', 'abcd--1')).toBe(false);
  });
});
