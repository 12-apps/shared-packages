import { afterEach, describe, expect, it, vi } from 'vitest';

import { infinitePayProvider } from '../providers/infinitepay';
import { PT_BR_INFINITEPAY_COPY } from '../providers/pt-BR';

/**
 * "Testar conexão" for InfinitePay, which has no API key: the probe asks
 * `payment_check` about a reference that cannot exist and reads the STATUS.
 *
 * It used to treat 404 as "the handle resolved, the reference simply is not
 * there" — so every string an owner could type passed, including a typo. That
 * is the one thing this probe exists to catch: the InfiniteTag decides which
 * account receives the store's money, and a wrong one pays a stranger with no
 * way back.
 *
 * Measured against the live API, which distinguishes them cleanly:
 *   real handle   200 {"success":false}
 *   bogus handle  404 {"success":false,"message":"Not found"}
 */
describe('infinitepay verifyCredentials', () => {
  const CREDS = { environment: 'PRODUCTION' as const, fields: { handle: '$loja' }, stub: false };

  const answerWith = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  afterEach(() => vi.unstubAllGlobals());

  it('passes when the handle resolves (200, no such payment)', async () => {
    answerWith(200, { success: false });
    await expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials(CREDS)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('FAILS on 404 — that is InfinitePay saying the handle does not exist', async () => {
    answerWith(404, { success: false, message: 'Not found' });
    const result = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials(CREDS);
    expect(result.ok).toBe(false);
    // Named, because "não foi possível conectar" would send an owner auditing
    // a connection whose only problem is a mistyped @.
    expect(result.message).toMatch(/InfiniteTag/i);
  });

  it('still passes on 422 — the handle resolved, only the reference was refused', async () => {
    answerWith(422, { success: false });
    await expect(infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials(CREDS)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('fails a rejected handle (401/403) without claiming it is unknown', async () => {
    answerWith(403, { success: false });
    const result = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials(CREDS);
    expect(result.ok).toBe(false);
  });

  /**
   * The two failures that look identical and mean opposite things.
   *
   * `fetch` rejects with a `TypeError` when the network is down, and a bug in
   * this package throws a `TypeError` too — `providerFetch` only wraps a
   * RESPONSE, so neither arrives as a `ProviderRequestError` and neither has an
   * HTTP status. Classifying on the absence of a status therefore called both
   * of them UNREACHABLE, and UNREACHABLE is the one verdict `runVerify`
   * deliberately does NOT store: a bug of ours became an unrecorded, permanent
   * "a InfinitePay está fora do ar, tente em instantes".
   *
   * What separates them is the `cause.code` undici attaches and our own throws
   * do not.
   */
  it('a real network failure is UNREACHABLE — the tag is not called into question', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    const result = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials(CREDS);
    expect(result).toMatchObject({ ok: false, fault: 'UNREACHABLE' });
  });

  it('a bug in OUR code is not reported as InfinitePay being unreachable', async () => {
    // No `cause.code`: nothing about the network, everything about us.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'handle')");
    });
    const result = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials(CREDS);
    expect(result.ok).toBe(false);
    // Anything but UNREACHABLE, because UNREACHABLE is the verdict that is
    // never written down — and a fault nobody records is a fault nobody fixes.
    expect(result.fault).not.toBe('UNREACHABLE');
    expect(result.fault).toBe('REFUSED');
  });

  it('reports missing credentials without calling the provider at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await infinitePayProvider(PT_BR_INFINITEPAY_COPY).verifyCredentials({ ...CREDS, fields: {} });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
