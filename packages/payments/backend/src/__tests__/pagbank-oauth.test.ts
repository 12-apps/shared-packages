import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedCredentials } from '../core/types';
import { pagbankOAuth } from '../providers/pagbank-oauth';

/**
 * Wire-format contract for PagBank Connect.
 *
 * These pin the three things that are NOT the OAuth2 defaults and that silently
 * broke the exchange in production when written the conventional way: the
 * application's credentials travel in `X_CLIENT_ID` / `X_CLIENT_SECRET`
 * headers rather than HTTP Basic, the token body is JSON rather than form
 * encoded, and the partner's account token rides along in
 * `Authorization: Bearer` — required ON TOP OF the id/secret pair.
 *
 * That last one was absent for the life of this adapter, and an assertion here
 * held it in place: a guard written against Basic auth asserted `Authorization`
 * was *undefined*, which forbade the very header PagBank requires. The lesson
 * is in the shape of the assertion — pin the header's VALUE, never its absence.
 *
 * A regression here surfaces to a merchant only as a dead
 * `connectError=exchange_failed` after they have already authorized, so it is
 * worth pinning explicitly.
 */

const APP: ResolvedCredentials = {
  environment: 'SANDBOX',
  fields: { clientId: 'cid_123', clientSecret: 'csec_456', accountToken: 'acct_sbx' },
};

const APP_PROD: ResolvedCredentials = {
  environment: 'PRODUCTION',
  fields: { clientId: 'cid_live', clientSecret: 'csec_live', accountToken: 'acct_live' },
};

function mockFetch(response: unknown, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank OAuth — authorize URL', () => {
  it('points at the sandbox consent host and round-trips the state', async () => {
    const req = await pagbankOAuth.buildAuthorizeUrl(APP, {
      state: 'st_abc',
      redirectUri: 'https://example.com/api/payments/oauth/callback/pagbank',
    });
    expect(req.url).toContain('https://connect.sandbox.pagbank.com.br/oauth2/authorize?');
    expect(req.state).toBe('st_abc');
  });

  it('joins scopes with + as PagBank requires, not %20', async () => {
    const req = await pagbankOAuth.buildAuthorizeUrl(APP, {
      state: 'st_abc',
      redirectUri: 'https://example.com/cb',
    });
    expect(req.url).toContain('scope=payments.read+payments.create+payments.refund');
    expect(req.url).not.toContain('%20');
  });

  it('uses the production consent host for a live application', async () => {
    const req = await pagbankOAuth.buildAuthorizeUrl(APP_PROD, {
      state: 's',
      redirectUri: 'https://example.com/cb',
    });
    expect(req.url).toContain('https://connect.pagbank.com.br/oauth2/authorize?');
    // The legacy PagSeguro host bounces to an error page before consent.
    expect(req.url).not.toContain('pagseguro.uol.com.br');
  });
});

describe('pagbank OAuth — token exchange', () => {
  it('authenticates with X_CLIENT_* headers, a Bearer account token, and a JSON body', async () => {
    const spy = mockFetch({ access_token: 'at_1', refresh_token: 'rt_1', expires_in: 3600 });
    await pagbankOAuth.exchangeCode('code_xyz', APP, { redirectUri: 'https://example.com/cb' });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.api.pagseguro.com/oauth2/token');

    const headers = init.headers as Record<string, string>;
    expect(headers['X_CLIENT_ID']).toBe('cid_123');
    expect(headers['X_CLIENT_SECRET']).toBe('csec_456');
    expect(headers['Content-Type']).toBe('application/json');
    // All three credentials, not two. Omitting the Bearer is answered with
    // `401 invalid_token`, which reads as a bad id/secret and is not.
    expect(headers['Authorization']).toBe('Bearer acct_sbx');
    // Still never Basic — that is the shape PagBank rejects.
    expect(headers['Authorization']).not.toContain('Basic');

    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: 'authorization_code',
      code: 'code_xyz',
      redirect_uri: 'https://example.com/cb',
    });
  });

  it('maps the token response onto the fields the charge path already reads', async () => {
    mockFetch({
      access_token: 'at_1',
      refresh_token: 'rt_1',
      account_id: 'acc_9',
      scope: 'payments.read',
      expires_in: 7200,
    });
    const tokens = await pagbankOAuth.exchangeCode('c', APP, { redirectUri: 'https://e/cb' });

    // `token` — not `access_token` — is what the charge path reads, so an
    // OAuth store and a token-pasting store share one code path from here.
    expect(tokens.fields['token']).toBe('at_1');
    expect(tokens.fields['refreshToken']).toBe('rt_1');
    expect(tokens.fields['accountId']).toBe('acc_9');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it('refuses a response carrying no access token', async () => {
    mockFetch({ refresh_token: 'rt_only' });
    await expect(
      pagbankOAuth.exchangeCode('c', APP, { redirectUri: 'https://e/cb' }),
    ).rejects.toThrow(/no access token/i);
  });

  it('hits the production token host for a live application', async () => {
    const spy = mockFetch({ access_token: 'at' });
    await pagbankOAuth.exchangeCode('c', APP_PROD, { redirectUri: 'https://e/cb' });
    expect(spy.mock.calls[0]?.[0]).toBe('https://api.pagseguro.com/oauth2/token');
  });

  it('carries the live account token for a production application', async () => {
    const spy = mockFetch({ access_token: 'at' });
    await pagbankOAuth.exchangeCode('c', APP_PROD, { redirectUri: 'https://e/cb' });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer acct_live');
  });

  /**
   * Named rather than left to PagBank, whose answer is `401 invalid_token` —
   * indistinguishable from a wrong client id/secret, and the reason this took
   * an afternoon to find. The request is not sent at all.
   */
  it('names the missing account token instead of failing as invalid_token', async () => {
    const spy = mockFetch({ access_token: 'at' });
    const noToken = { environment: 'SANDBOX' as const, fields: { clientId: 'c', clientSecret: 's' } };

    await expect(
      pagbankOAuth.exchangeCode('c', noToken, { redirectUri: 'https://e/cb' }),
    ).rejects.toThrow(/account token/i);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('pagbank OAuth — refresh', () => {
  /**
   * The endpoint IS the bug. Posting `grant_type=refresh_token` to
   * `/oauth2/token` answers `41005 unsupported_grant_type`, which was read as
   * "PagBank cannot refresh" — the opposite of that code's published meaning
   * ("only `authorization_code` and `refresh_token` are supported"). Renewal
   * has its own endpoint, and until it was used no grant could ever be renewed.
   */
  it('renews at /oauth2/refresh, not the token endpoint', async () => {
    const spy = mockFetch({ access_token: 'at_2', refresh_token: 'rt_2', expires_in: 3600 });
    await pagbankOAuth.refresh(
      { environment: 'SANDBOX', fields: { token: 'old', refreshToken: 'rt_1' } },
      APP,
    );

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/oauth2\/refresh$/);
    expect(url).not.toMatch(/\/oauth2\/token$/);

    const headers = init.headers as Record<string, string>;
    expect(headers['X_CLIENT_ID']).toBe('cid_123');
    expect(headers['Authorization']).toBe('Bearer acct_sbx');
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt_1',
    });
  });

  it('carries the rotated refresh token forward', async () => {
    mockFetch({ access_token: 'at_2', refresh_token: 'rt_2' });
    const tokens = await pagbankOAuth.refresh(
      { environment: 'SANDBOX', fields: { token: 'old', refreshToken: 'rt_1' } },
      APP,
    );
    expect(tokens.fields['refreshToken']).toBe('rt_2');
  });

  /**
   * Keeping the old one — which this used to do — holds a token PagBank has
   * already invalidated, so the connection looks healthy and dies at the NEXT
   * renewal, far from the cause. Failing here marks it for reauthorization now.
   */
  it('refuses a renewal that returns no new refresh token', async () => {
    mockFetch({ access_token: 'at_2' });
    await expect(
      pagbankOAuth.refresh(
        { environment: 'SANDBOX', fields: { token: 'old', refreshToken: 'rt_1' } },
        APP,
      ),
    ).rejects.toThrow(/reauthorized/i);
  });

  it('fails closed when the connection has no refresh token', async () => {
    await expect(
      pagbankOAuth.refresh({ environment: 'SANDBOX', fields: { token: 'only' } }, APP),
    ).rejects.toThrow(/no refresh token/i);
  });
});

/**
 * Disconnect has to actually disconnect. The adapter shipped with no `revoke`
 * at all, so `disconnectConnect` skipped revocation and cleared only our own
 * row — the grant stayed live at PagBank while the UI told the merchant it had
 * been revoked and their store could no longer charge.
 */
describe('pagbank OAuth — revoke', () => {
  it('revokes BOTH token types at /oauth2/revoke', async () => {
    const spy = mockFetch({});
    await pagbankOAuth.revoke?.(
      { environment: 'SANDBOX', fields: { token: 'at_1', refreshToken: 'rt_1' } },
      APP,
    );

    expect(spy).toHaveBeenCalledTimes(2);
    const calls = spy.mock.calls as [string, RequestInit][];
    for (const [url] of calls) expect(url).toMatch(/\/oauth2\/revoke$/);

    // A surviving refresh token can mint a new access token, so revoking only
    // the access token would leave the connection alive.
    expect(calls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { token_type_hint: 'access_token', token: 'at_1' },
      { token_type_hint: 'refresh_token', token: 'rt_1' },
    ]);
  });

  it('carries the same bespoke Connect headers', async () => {
    const spy = mockFetch({});
    await pagbankOAuth.revoke?.({ environment: 'SANDBOX', fields: { token: 'at_1' } }, APP);

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer acct_sbx');
    expect(headers['X_CLIENT_ID']).toBe('cid_123');
    expect(headers['X_CLIENT_SECRET']).toBe('csec_456');
  });

  /** Nothing stored for a type means nothing to revoke — not an empty call. */
  it('skips a token type the connection does not hold', async () => {
    const spy = mockFetch({});
    await pagbankOAuth.revoke?.({ environment: 'SANDBOX', fields: { token: 'at_1' } }, APP);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * A partial revocation is the worst outcome available, so one failure must
   * not stop the rest — and the caller still has to hear that it happened.
   */
  it('attempts every token even when one fails, then reports', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request', text: async () => '{}', json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', text: async () => '', json: async () => ({}) });
    vi.stubGlobal('fetch', spy);

    await expect(
      pagbankOAuth.revoke?.(
        { environment: 'SANDBOX', fields: { token: 'at_1', refreshToken: 'rt_1' } },
        APP,
      ),
    ).rejects.toThrow(/did not revoke every token/i);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

/**
 * The table is only worth having if the explanation reaches whoever is
 * debugging. `ProviderRequestError.message` is what the OAuth callback reads
 * into its failure detail and what lands in the log, so the meaning has to ride
 * there — not merely exist in a lookup nobody calls.
 */
describe('pagbank OAuth — error codes are explained', () => {
  it('names what 41008 actually means on a failed exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => '{"error":"invalid_token","code":41008}',
        json: async () => ({ error: 'invalid_token', code: 41008 }),
      }),
    );

    const failure = await pagbankOAuth
      .exchangeCode('code_1', APP, { redirectUri: 'https://host.test/cb' })
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

    // The raw body survives — it is the evidence — with the meaning appended.
    expect(failure).toContain('invalid_token');
    // The gloss is English now (FUT-760); what it must steer away from is not.
    expect(failure).toMatch(/PLATFORM ACCOUNT TOKEN/);
  });

  /** An unrecognised failure is passed through untouched, not decorated. */
  it('leaves an unknown failure exactly as PagBank sent it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'upstream exploded',
        json: async () => ({}),
      }),
    );

    const failure = await pagbankOAuth
      .exchangeCode('code_1', APP, { redirectUri: 'https://host.test/cb' })
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

    expect(failure).toContain('upstream exploded');
    expect(failure).not.toContain('[');
  });
});
